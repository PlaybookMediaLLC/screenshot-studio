package copilot

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
)

// builtInAgent is the runtime's BuiltInAgent (dist/agent/index) for the model
// OpenAIAdapter exposes: one streamText step over the conversation and the
// frontend tools, converted to AG-UI events.
type builtInAgent struct {
	model string
}

func (a builtInAgent) Run(ctx context.Context, input RunAgentInput) (<-chan json.RawMessage, error) {
	ch := make(chan json.RawMessage, 16)
	go func() {
		defer close(ch)
		a.run(ctx, input, func(v any) { ch <- marshal(v) })
	}()
	return ch, nil
}

type runEvent struct {
	Type         string          `json:"type"`
	Message      *string         `json:"message,omitempty"`
	Code         string          `json:"code,omitempty"`
	ThreadID     string          `json:"threadId,omitempty"`
	RunID        string          `json:"runId,omitempty"`
	FinishReason string          `json:"finishReason,omitempty"`
	Usage        []tokenUsage    `json:"usage,omitempty"`
	Outcome      json.RawMessage `json:"outcome,omitempty"`
}

type tokenUsage struct {
	Provider          string `json:"provider"`
	Model             string `json:"model"`
	InputTokens       *int64 `json:"inputTokens,omitempty"`
	OutputTokens      *int64 `json:"outputTokens,omitempty"`
	TotalTokens       *int64 `json:"totalTokens,omitempty"`
	ReasoningTokens   *int64 `json:"reasoningTokens,omitempty"`
	CachedInputTokens *int64 `json:"cachedInputTokens,omitempty"`
}

type toolCallState struct {
	id, name, args      string
	hasArgsDelta, ended bool
}

func (a builtInAgent) run(ctx context.Context, input RunAgentInput, emit func(any)) {
	emit(runEvent{Type: "RUN_STARTED", ThreadID: input.ThreadID, RunID: input.RunID})
	runError := func(msg string) {
		emit(runEvent{Type: "RUN_ERROR", Message: &msg, ThreadID: input.ThreadID, RunID: input.RunID})
	}
	aborted := func() {
		emit(runEvent{Type: "RUN_FINISHED", ThreadID: input.ThreadID, RunID: input.RunID})
	}

	body, err := a.request(input)
	if err != nil {
		// Thrown while setting up the run: the runner's finalizeRunEvents closes it.
		msg := err.Error()
		emit(runEvent{Type: "RUN_ERROR", Message: &msg, Code: "INCOMPLETE_STREAM"})
		return
	}
	resp, err := postChatCompletions(ctx, body)
	if ctx.Err() != nil {
		aborted()
		return
	}
	if err != nil {
		runError(err.Error())
		return
	}
	defer resp.Body.Close()

	messageID := uuid.NewString()
	textStarted := false
	var calls []*toolCallState
	byIndex := map[int]*toolCallState{}
	finishReason := "other"
	var usage *chatUsage

	finishTool := func(tc *toolCallState) {
		if !tc.hasArgsDelta {
			args := tc.args
			if strings.TrimSpace(args) == "" {
				args = "{}"
			}
			emit(synth{Type: "TOOL_CALL_ARGS", ToolCallID: tc.id, Delta: marshal(args)})
			tc.hasArgsDelta = true
		}
		tc.ended = true
		emit(synth{Type: "TOOL_CALL_END", ToolCallID: tc.id})
		executeStateTool(tc, emit)
	}

	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 64<<10), 16<<20)
	for scanner.Scan() {
		data, ok := strings.CutPrefix(scanner.Text(), "data:")
		data = strings.TrimSpace(data)
		if !ok || data == "" {
			continue
		}
		if data == "[DONE]" {
			break
		}
		var chunk chatChunk
		if err := json.Unmarshal([]byte(data), &chunk); err != nil {
			runError(err.Error())
			return
		}
		if chunk.Error != nil {
			runError(chunk.Error.Message)
			return
		}
		if chunk.Usage != nil {
			usage = chunk.Usage
		}
		if len(chunk.Choices) == 0 {
			continue
		}
		choice := chunk.Choices[0]
		if choice.FinishReason != nil {
			finishReason = mapFinishReason(*choice.FinishReason)
		}
		if content := choice.Delta.Content; content != nil {
			if !textStarted {
				// text-start: the provider id "0" is replaced by a fresh UUID
				textStarted, messageID = true, uuid.NewString()
			}
			if *content != "" {
				emit(struct {
					Type      string `json:"type"`
					Role      string `json:"role"`
					MessageID string `json:"messageId"`
					Delta     string `json:"delta"`
				}{"TEXT_MESSAGE_CHUNK", "assistant", messageID, *content})
			}
		}
		for _, d := range choice.Delta.ToolCalls {
			tc, ok := byIndex[d.Index]
			if !ok {
				if d.ID == "" || d.Function.Name == "" {
					continue
				}
				tc = &toolCallState{id: d.ID, name: d.Function.Name}
				byIndex[d.Index] = tc
				calls = append(calls, tc)
				emit(synth{Type: "TOOL_CALL_START", ParentMessageID: &messageID, ToolCallID: tc.id, ToolCallName: tc.name})
			} else if tc.ended {
				continue
			}
			if d.Function.Arguments != "" {
				tc.args += d.Function.Arguments
				tc.hasArgsDelta = true
				emit(synth{Type: "TOOL_CALL_ARGS", ToolCallID: tc.id, Delta: marshal(d.Function.Arguments)})
			}
			// The provider finishes a tool call as soon as its arguments parse.
			if json.Valid([]byte(tc.args)) {
				finishTool(tc)
			}
		}
	}
	if ctx.Err() != nil {
		aborted()
		return
	}
	if err := scanner.Err(); err != nil {
		runError(err.Error())
		return
	}
	for _, tc := range calls {
		if !tc.ended {
			finishTool(tc)
		}
	}

	finished := runEvent{Type: "RUN_FINISHED", ThreadID: input.ThreadID, RunID: input.RunID, FinishReason: finishReason}
	if u := usage.tokens(a.model); u != nil {
		finished.Usage = []tokenUsage{*u}
	}
	emit(finished)
}

// executeStateTool runs the server-side AGUISendStateSnapshot/AGUISendStateDelta
// tools BuiltInAgent always registers.
// ponytail: state events pass through as the model sent them, without createStateEventNormalizer; the original app never sends agent state.
func executeStateTool(tc *toolCallState, emit func(any)) {
	if tc.name != "AGUISendStateSnapshot" && tc.name != "AGUISendStateDelta" {
		return
	}
	var args map[string]json.RawMessage
	if strings.TrimSpace(tc.args) == "" {
		args = map[string]json.RawMessage{}
	} else if err := json.Unmarshal([]byte(tc.args), &args); err != nil {
		return
	}
	var result any
	if tc.name == "AGUISendStateSnapshot" {
		snapshot := args["snapshot"]
		result = struct {
			Success  bool            `json:"success"`
			Snapshot json.RawMessage `json:"snapshot,omitempty"`
		}{true, snapshot}
		if snapshot != nil {
			emit(struct {
				Type     string          `json:"type"`
				Snapshot json.RawMessage `json:"snapshot"`
			}{"STATE_SNAPSHOT", snapshot})
		}
	} else {
		var delta []json.RawMessage
		if json.Unmarshal(args["delta"], &delta) != nil || delta == nil {
			return
		}
		result = struct {
			Success bool            `json:"success"`
			Delta   json.RawMessage `json:"delta"`
		}{true, args["delta"]}
		emit(struct {
			Type  string          `json:"type"`
			Delta json.RawMessage `json:"delta"`
		}{"STATE_DELTA", args["delta"]})
	}
	emit(struct {
		Type       string `json:"type"`
		Role       string `json:"role"`
		MessageID  string `json:"messageId"`
		ToolCallID string `json:"toolCallId"`
		Content    string `json:"content"`
	}{"TOOL_CALL_RESULT", "tool", uuid.NewString(), tc.id, string(marshal(result))})
}

type chatChunk struct {
	Choices []struct {
		Delta struct {
			Content   *string `json:"content"`
			ToolCalls []struct {
				Index    int    `json:"index"`
				ID       string `json:"id"`
				Function struct {
					Name      string `json:"name"`
					Arguments string `json:"arguments"`
				} `json:"function"`
			} `json:"tool_calls"`
		} `json:"delta"`
		FinishReason *string `json:"finish_reason"`
	} `json:"choices"`
	Usage *chatUsage `json:"usage"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error"`
}

type chatUsage struct {
	PromptTokens        *int64 `json:"prompt_tokens"`
	CompletionTokens    *int64 `json:"completion_tokens"`
	PromptTokensDetails *struct {
		CachedTokens *int64 `json:"cached_tokens"`
	} `json:"prompt_tokens_details"`
	CompletionTokensDetails *struct {
		ReasoningTokens *int64 `json:"reasoning_tokens"`
	} `json:"completion_tokens_details"`
}

// tokens is getAISDKRunFinishedDetails' usage entry, nil without any count.
func (u *chatUsage) tokens(model string) *tokenUsage {
	if u == nil {
		return nil
	}
	t := tokenUsage{Provider: "openai.chat", Model: model, InputTokens: u.PromptTokens, OutputTokens: u.CompletionTokens}
	if u.PromptTokens != nil && u.CompletionTokens != nil {
		total := *u.PromptTokens + *u.CompletionTokens
		t.TotalTokens = &total
	}
	if u.CompletionTokensDetails != nil {
		t.ReasoningTokens = u.CompletionTokensDetails.ReasoningTokens
	}
	if u.PromptTokensDetails != nil {
		t.CachedInputTokens = u.PromptTokensDetails.CachedTokens
	}
	if t.InputTokens == nil && t.OutputTokens == nil && t.ReasoningTokens == nil && t.CachedInputTokens == nil {
		return nil
	}
	return &t
}

func mapFinishReason(reason string) string {
	switch reason {
	case "stop":
		return "stop"
	case "length":
		return "length"
	case "content_filter":
		return "content-filter"
	case "function_call", "tool_calls":
		return "tool-calls"
	}
	return "other"
}

type chatMessage struct {
	Role       string         `json:"role"`
	Content    any            `json:"content"`
	ToolCalls  []chatToolCall `json:"tool_calls,omitempty"`
	ToolCallID string         `json:"tool_call_id,omitempty"`
}

type chatToolCall struct {
	ID       string `json:"id"`
	Type     string `json:"type"`
	Function struct {
		Name      string `json:"name"`
		Arguments string `json:"arguments"`
	} `json:"function"`
}

type chatTool struct {
	Type     string `json:"type"`
	Function struct {
		Name        string          `json:"name"`
		Description string          `json:"description"`
		Parameters  json.RawMessage `json:"parameters"`
	} `json:"function"`
}

// The server tools BuiltInAgent adds to every run, as their zod schemas serialize.
var stateTools = []struct{ name, description, parameters string }{
	{"AGUISendStateSnapshot", "Replace the entire application state with a new snapshot",
		`{"type":"object","properties":{"snapshot":{"description":"The complete new state object"}},"additionalProperties":false,"$schema":"http://json-schema.org/draft-07/schema#"}`},
	{"AGUISendStateDelta", "Apply incremental updates to application state using JSON Patch operations",
		`{"type":"object","properties":{"delta":{"type":"array","items":{"type":"object","properties":{"op":{"type":"string","enum":["add","replace","remove"],"description":"The operation to perform"},"path":{"type":"string","description":"JSON Pointer path (e.g., '/foo/bar')"},"value":{"description":"The value to set. Required for 'add' and 'replace' operations, ignored for 'remove'."}},"required":["op","path"],"additionalProperties":false},"description":"Array of JSON Patch operations"}},"required":["delta"],"additionalProperties":false,"$schema":"http://json-schema.org/draft-07/schema#"}`},
}

var jsonSchemaTypes = []string{"object", "string", "number", "integer", "boolean", "array"}

// request builds the chat completions body streamText sends for the run.
func (a builtInAgent) request(input RunAgentInput) ([]byte, error) {
	var tools []chatTool
	for _, t := range input.Tools {
		var schema map[string]any
		if json.Unmarshal(t.Parameters, &schema) != nil || schema == nil {
			return nil, fmt.Errorf("Invalid JSON schema for tool %s", t.Name)
		}
		if typ, _ := schema["type"].(string); len(schema) > 0 && !contains(jsonSchemaTypes, typ) {
			return nil, fmt.Errorf("Invalid JSON schema for tool %s", t.Name)
		}
		tools = append(tools, newChatTool(t.Name, t.Description, t.Parameters))
	}
	for _, t := range stateTools {
		tools = append(tools, newChatTool(t.name, t.description, json.RawMessage(t.parameters)))
	}

	var messages []chatMessage
	if prompt := systemPrompt(input); prompt != "" {
		messages = append(messages, chatMessage{Role: "system", Content: prompt})
	}
	for _, m := range input.Messages {
		switch m.Role {
		case "assistant":
			msg := chatMessage{Role: "assistant", Content: m.Text()}
			for _, tc := range m.ToolCalls {
				call := chatToolCall{ID: tc.ID, Type: "function"}
				call.Function.Name, call.Function.Arguments = tc.Function.Name, string(marshal(safeParseToolArgs(tc.Function.Arguments)))
				msg.ToolCalls = append(msg.ToolCalls, call)
			}
			messages = append(messages, msg)
		case "user":
			messages = append(messages, chatMessage{Role: "user", Content: userContent(m.Content)})
		case "tool":
			messages = append(messages, chatMessage{Role: "tool", ToolCallID: m.ToolCallID, Content: m.Text()})
		}
		// system/developer messages are not forwarded (forwardSystemMessages is
		// off); activity and reasoning messages have no model representation.
	}
	if messages == nil {
		messages = []chatMessage{}
	}

	return marshal(map[string]any{
		"model":          a.model,
		"messages":       messages,
		"tools":          tools,
		"stream":         true,
		"stream_options": map[string]any{"include_usage": true},
	}), nil
}

func newChatTool(name, description string, parameters json.RawMessage) chatTool {
	t := chatTool{Type: "function"}
	t.Function.Name, t.Function.Description, t.Function.Parameters = name, description, parameters
	return t
}

// systemPrompt joins the readable context and the application state.
func systemPrompt(input RunAgentInput) string {
	var parts []string
	if len(input.Context) > 0 {
		parts = append(parts, "\n## Context from the application\n")
		for _, c := range input.Context {
			parts = append(parts, c.Description+":\n"+c.Value+"\n")
		}
	}
	if hasState(input.State) {
		var compact, indented bytes.Buffer
		_ = json.Compact(&compact, input.State)
		_ = json.Indent(&indented, compact.Bytes(), "", "  ")
		parts = append(parts, "\n## Application State\nThis is state from the application that you can edit by calling AGUISendStateSnapshot or AGUISendStateDelta.\n```json\n"+indented.String()+"\n```\n")
	}
	return strings.Join(parts, "")
}

func hasState(state json.RawMessage) bool {
	s := strings.TrimSpace(string(state))
	if s == "" || s == "null" {
		return false
	}
	var obj map[string]json.RawMessage
	if json.Unmarshal(state, &obj) == nil {
		return len(obj) > 0
	}
	var arr []json.RawMessage
	if json.Unmarshal(state, &arr) == nil {
		return len(arr) > 0
	}
	return true
}

func safeParseToolArgs(raw string) any {
	var parsed map[string]json.RawMessage
	if json.Unmarshal([]byte(raw), &parsed) != nil || parsed == nil {
		return map[string]any{}
	}
	return json.RawMessage(raw)
}

type inputPart struct {
	Type   string `json:"type"`
	Text   string `json:"text"`
	Source *struct {
		Type     string `json:"type"`
		Value    string `json:"value"`
		MimeType string `json:"mimeType"`
	} `json:"source"`
	MimeType string `json:"mimeType"`
	Data     string `json:"data"`
	URL      string `json:"url"`
}

// userContent converts AG-UI user content to the chat completions content.
// ponytail: text and image parts only; audio/video/document parts are dropped.
func userContent(content json.RawMessage) any {
	var s string
	if json.Unmarshal(content, &s) == nil {
		return s
	}
	var parts []inputPart
	_ = json.Unmarshal(content, &parts)
	var out []map[string]any
	image := func(url string) {
		out = append(out, map[string]any{"type": "image_url", "image_url": map[string]any{"url": url}})
	}
	dataURL := func(mime, data string) string {
		if mime == "" || mime == "image/*" {
			mime = "image/jpeg"
		}
		return "data:" + mime + ";base64," + data
	}
	for _, p := range parts {
		switch {
		case p.Type == "text" && p.Text != "":
			out = append(out, map[string]any{"type": "text", "text": p.Text})
		case p.Type == "image" && p.Source != nil && p.Source.Type == "data":
			image(dataURL(p.Source.MimeType, p.Source.Value))
		case p.Type == "image" && p.Source != nil && p.Source.Type == "url":
			image(p.Source.Value)
		case p.Type == "binary" && strings.HasPrefix(p.MimeType, "image/") && p.Data != "":
			image(dataURL(p.MimeType, p.Data))
		case p.Type == "binary" && strings.HasPrefix(p.MimeType, "image/") && p.URL != "":
			image(p.URL)
		}
	}
	if len(out) == 0 {
		return ""
	}
	if len(out) == 1 && out[0]["type"] == "text" {
		return out[0]["text"]
	}
	return out
}

// postChatCompletions calls OpenAI with the AI SDK's retry policy: two retries
// with exponential backoff (2s, 4s) on network errors, 408, 409, 429 and 5xx.
// ponytail: retry-after headers are not honored; add if OpenAI rate limits bite.
func postChatCompletions(ctx context.Context, body []byte) (*http.Response, error) {
	baseURL := os.Getenv("OPENAI_BASE_URL")
	if baseURL == "" {
		baseURL = "https://api.openai.com/v1"
	}
	for attempt := 0; ; attempt++ {
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimSuffix(baseURL, "/")+"/chat/completions", bytes.NewReader(body))
		if err != nil {
			return nil, err
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+os.Getenv("OPENAI_API_KEY"))
		if org := os.Getenv("OPENAI_ORG_ID"); org != "" {
			req.Header.Set("OpenAI-Organization", org)
		}
		if project := os.Getenv("OPENAI_PROJECT_ID"); project != "" {
			req.Header.Set("OpenAI-Project", project)
		}
		resp, err := http.DefaultClient.Do(req)
		if err == nil && resp.StatusCode < 300 {
			return resp, nil
		}
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		retryable, message := true, ""
		if err != nil {
			message = "Cannot connect to API: " + err.Error()
		} else {
			retryable, message = apiError(resp)
		}
		if !retryable {
			if attempt == 0 {
				return nil, errors.New(message)
			}
			return nil, fmt.Errorf("Failed after %d attempts with non-retryable error: '%s'", attempt+1, message)
		}
		if attempt == 2 {
			return nil, fmt.Errorf("Failed after 3 attempts. Last error: %s", message)
		}
		select {
		case <-time.After(2 * time.Second << attempt):
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
}

func apiError(resp *http.Response) (retryable bool, message string) {
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	var body struct {
		Error struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	message = strings.TrimPrefix(resp.Status, fmt.Sprintf("%d ", resp.StatusCode))
	if json.Unmarshal(data, &body) == nil && body.Error.Message != "" {
		message = body.Error.Message
	}
	code := resp.StatusCode
	return code == 408 || code == 409 || code == 429 || code >= 500, message
}
