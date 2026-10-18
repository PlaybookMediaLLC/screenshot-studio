// Package chat is the chat agent: the Mastra
// "postiz" agent (instructions, tools, Postgres memory) run through an
// OpenAI chat-completions tool loop and streamed as AG-UI events the way
// @ag-ui/mastra emits them. The MCP server lives in chat/mcp.
package chat

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"regexp"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/chat/llm"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/copilot"
)

const (
	AgentName        = "postiz"
	AgentDescription = "Agent that helps schedule and list social media posts for users"
	// maxSteps is Mastra's default step limit for agent.stream/generate.
	maxSteps = 5
)

// The CopilotKit runtime runs the agent behind /copilot/agent.
var _ copilot.AgentRunner = (*Agent)(nil)

// Model is openai('gpt-5.2').
var Model = "gpt-5.2"

// Instructions is the agent's instructions for the 'ui' request context
// value (rendered with dayjs().format('YYYY-MM-DD HH:mm:ss')).
func Instructions(ui string, now time.Time) string {
	renderArray := ""
	if ui != "" {
		renderArray = "- If the user confirm, ask if they would like to get a modal with populated content without scheduling the post yet or if they want to schedule it right away."
	}
	return "\n      Global information:\n        - Date (UTC): " + now.UTC().Format("2006-01-02 15:04:05") + "\n\n      You are an agent that helps manage and schedule social media posts for users, you can:\n        - Schedule posts into the future, or now, adding texts, images and videos\n        - List the posts scheduled between two dates (postsListTool)\n        - Update the settings of a scheduled post or draft that was not published yet (postSettingsTool)\n        - Generate pictures for posts\n        - Generate videos for posts\n        - Generate text for posts\n        - Show global analytics about socials\n        - List integrations (channels)\n        - List groups (customers) and filter the channels by a group\n\n      - We schedule posts to different integration like facebook, instagram, etc. but to the user we don't say integrations we say channels as integration is the technical name\n      - When scheduling a post, you must follow the social media rules and best practices.\n      - When scheduling a post, you can pass an array for list of posts for a social media platform, But it has different behavior depending on the platform.\n        - For platforms like Threads, Bluesky and X (Twitter), each post in the array will be a separate post in the thread.\n        - For platforms like LinkedIn and Facebook, second part of the array will be added as \"comments\" to the first post.\n        - If the social media platform has the concept of \"threads\", we need to ask the user if they want to create a thread or one long post.\n        - For X, if you don't have Premium, don't suggest a long post because it won't work.\n        - Platform format will also be passed can be \"normal\", \"markdown\", \"html\", make sure you use the correct format for each platform.\n      \n      - Sometimes 'integrationSchema' will return rules, make sure you follow them (these rules are set in stone, even if the user asks to ignore them)\n      - Each socials media platform has different settings and rules, you can get them by using the integrationSchema tool.\n      - Always make sure you use this tool before you schedule any post.\n      - In every message I will send you the list of needed social medias (id and platform), if you already have the information use it, if not, use the integrationSchema tool to get it.\n      - Make sure you always take the last information I give you about the socials, it might have changed.\n      - Before scheduling a post, always make sure you ask the user confirmation by providing all the details of the post (text, images, videos, date, time, social media platform, account).\n      - To reuse media that was already uploaded, use mediaListTool (search by filename) and pass the returned path as the attachment, instead of asking the user for a URL or uploading it again.\n      - To find or inspect existing posts, use postsListTool with a UTC start and end date - it returns every post scheduled in that window. To cover \"all my upcoming posts\", pass a wide window starting now.\n      - To change the provider settings of an existing post that was not published yet (scheduled or draft), first find it with postsListTool, then use postSettingsTool with the post's id. It only updates the settings - the content and the publish date stay as they are - and only the keys you pass are changed (get them with the integrationSchema tool). Show the user which post and which settings will change and get their confirmation first.\n      - Never open the \"modal with populated content\" to edit an existing post - that modal only CREATES a new post, so using it to edit would duplicate the post. It is only for brand new posts.\n      - You can create, schedule and update posts, but you CANNOT delete posts - there is no delete capability. Never offer to delete a post. If the user asks you to delete one, tell them deletion is a destructive action and they should delete it themselves in the Postiz app (the calendar).\n      - Between tools, we will reference things like: [output:name] and [input:name] to set the information right.\n      - When outputting a date for the user, make sure it's human readable with time\n      - The content of the post, HTML, Each line must be wrapped in <p> here is the possible tags: h1, h2, h3, u, strong, li, ul, p (you can't have u and strong together), don't use a \"code\" box\n      " + renderArray + "\n"
}

// Agent is the Mastra Agent "postiz" with its Memory.
type Agent struct {
	tools  []*Tool
	memory *Memory
	wm     *Tool
	// now is the clock the instructions render; tests pin it.
	now func() time.Time
}

// NewAgent builds the agent from the whole toolList (it keeps the
// non-mcpOnly, available tools, like LoadToolsService.agent()).
func NewAgent(tools []*Tool, memory *Memory) *Agent {
	return &Agent{tools: LoadTools(tools, false), memory: memory, wm: updateWorkingMemoryTool(memory), now: time.Now}
}

// ListTools is agent.listTools(): the agent's own tools (memory tools aside).
func (a *Agent) ListTools() []*Tool { return a.tools }

// Recall is memory.recall({ resourceId, threadId }) behind GET
// /copilot/:thread/list (the controller answers { messages: [] } on error).
func (a *Agent) Recall(ctx context.Context, resourceID, threadID string) (*RecallResult, error) {
	return a.memory.Recall(ctx, resourceID, threadID)
}

// ListThreads is GET /copilot/list's { threads: [{ id, title }] }.
func (a *Agent) ListThreads(ctx context.Context, resourceID string) (*ThreadList, error) {
	return a.memory.ListThreads(ctx, resourceID)
}

func mustJSON(v any) json.RawMessage {
	data, _ := json.Marshal(v)
	return data
}

// Event structs keep @ag-ui/core's key order.
type runStarted struct {
	Type     string `json:"type"`
	ThreadID string `json:"threadId"`
	RunID    string `json:"runId"`
}

type runError struct {
	Type    string `json:"type"`
	Message string `json:"message"`
}

type textChunk struct {
	Type      string `json:"type"`
	Role      string `json:"role"`
	MessageID string `json:"messageId"`
	Delta     string `json:"delta"`
}

type toolCallStart struct {
	Type            string `json:"type"`
	ParentMessageID string `json:"parentMessageId"`
	ToolCallID      string `json:"toolCallId"`
	ToolCallName    string `json:"toolCallName"`
}

type toolCallArgs struct {
	Type       string `json:"type"`
	ToolCallID string `json:"toolCallId"`
	Delta      string `json:"delta"`
}

type toolCallEnd struct {
	Type       string `json:"type"`
	ToolCallID string `json:"toolCallId"`
}

type toolCallResult struct {
	Type       string `json:"type"`
	ToolCallID string `json:"toolCallId"`
	Content    string `json:"content"`
	MessageID  string `json:"messageId"`
	Role       string `json:"role"`
}

type stateSnapshot struct {
	Type     string `json:"type"`
	Snapshot any    `json:"snapshot"`
}

var (
	continuationPattern = regexp.MustCompile(`^(.+)-agui-text(?:-\d+)?$`)
	modelSafeID         = regexp.MustCompile(`[^A-Za-z0-9_-]`)
)

// toModelSafeMessageId keeps client ids valid as OpenAI input ids.
func toModelSafeMessageID(id string) string { return modelSafeID.ReplaceAllString(id, "-") }

func messageText(raw json.RawMessage) string {
	var s string
	if json.Unmarshal(raw, &s) == nil {
		return s
	}
	var parts []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	}
	if json.Unmarshal(raw, &parts) != nil {
		return ""
	}
	var texts []string
	for _, p := range parts {
		if p.Type == "text" && strings.TrimSpace(p.Text) != "" {
			texts = append(texts, strings.TrimSpace(p.Text))
		}
	}
	return strings.Join(texts, "\n")
}

func parseContent(raw json.RawMessage) MessageContent {
	var c MessageContent
	_ = json.Unmarshal(raw, &c)
	return c
}

// Run is MastraAgent.run for the "postiz" agent: it implements
// copilot.AgentRunner. resourceId is the organization id, the request
// context carries the organization, the forwarded integrations and ui=true.
func (a *Agent) Run(ctx context.Context, input copilot.RunAgentInput) (<-chan json.RawMessage, error) {
	out := make(chan json.RawMessage, 64)
	go func() {
		defer close(out)
		emit := func(v any) bool {
			select {
			case out <- mustJSON(v):
				return true
			case <-ctx.Done():
				return false
			}
		}
		if !emit(runStarted{"RUN_STARTED", input.ThreadID, input.RunID}) {
			return
		}
		if err := a.run(ctx, input, emit); err != nil {
			// a cancelled run is settled silently, like the abort listener
			if ctx.Err() != nil {
				return
			}
			emit(runError{"RUN_ERROR", err.Error()})
		}
	}()
	return out, nil
}

func (a *Agent) run(ctx context.Context, input copilot.RunAgentInput, emit func(any) bool) error {
	resourceID := input.ThreadID
	if input.Organization != nil {
		resourceID = input.Organization.ID
	}
	var forwarded struct {
		Integrations json.RawMessage `json:"integrations"`
	}
	_ = json.Unmarshal(input.ForwardedProps, &forwarded)
	if len(forwarded.Integrations) == 0 {
		forwarded.Integrations = json.RawMessage("[]")
	}
	rc := &RequestContext{Integrations: forwarded.Integrations, Organization: input.Organization, UI: "true"}
	ctx = WithRequestContext(ctx, rc)
	ctx = context.WithValue(ctx, runInfoKey{}, &runInfo{threadID: input.ThreadID, resourceID: resourceID})

	thread, err := a.memory.GetThreadByID(ctx, input.ThreadID)
	if err != nil {
		return err
	}
	if thread != nil && thread.ResourceID != resourceID {
		return fmt.Errorf("Thread with id %s is for resource with id %s but resource %s was queried.", input.ThreadID, thread.ResourceID, resourceID)
	}
	if err := syncInputState(ctx, a.memory, resourceID, input.State); err != nil {
		return err
	}

	// AG-UI clients re-send the whole conversation every turn; only the
	// messages Mastra has not stored yet are new.
	stored := map[string]bool{}
	if thread != nil {
		all, err := a.memory.recall(ctx, resourceID, input.ThreadID, 0)
		if err != nil {
			return err
		}
		for _, m := range all.Messages {
			stored[m.ID] = true
		}
	}
	isStored := func(id string) bool {
		if stored[id] {
			return true
		}
		match := continuationPattern.FindStringSubmatch(id)
		return match != nil && stored[match[1]]
	}
	var fresh []copilot.Message
	for _, m := range input.Messages {
		if m.Role == "developer" || m.ID == "" || !isStored(m.ID) {
			fresh = append(fresh, m)
		}
	}
	if len(fresh) == 0 {
		fresh = input.Messages
	}

	if thread == nil {
		if thread, err = a.memory.CreateThread(ctx, input.ThreadID, resourceID); err != nil {
			return err
		}
	}

	saved, results, systems := a.convertInput(input.ThreadID, resourceID, fresh)
	if len(results) > 0 {
		updated, err := a.applyToolResults(ctx, input.ThreadID, results)
		if err != nil {
			return err
		}
		saved = append(saved, updated...)
	}
	if err := a.memory.SaveMessages(ctx, saved); err != nil {
		return err
	}
	history, err := a.memory.recall(ctx, resourceID, input.ThreadID, lastMessages+len(saved))
	if err != nil {
		return err
	}

	workingMemory, err := a.memory.GetWorkingMemory(ctx, resourceID)
	if err != nil {
		return err
	}
	messages := []llm.Message{llm.Text("system", Instructions(rc.UI, a.now())), llm.Text("system", workingMemoryInstruction(workingMemory))}
	for _, s := range systems {
		messages = append(messages, llm.Text("system", s))
	}
	messages = append(messages, toModelMessages(history.Messages)...)

	messageID := uuid.NewString()
	parts, err := a.loop(ctx, messages, input.Tools, messageID, emit)
	if len(parts) > 0 {
		reply := DBMessage{ID: messageID, Role: "assistant", CreatedAt: JSDate(time.Now()), ThreadID: input.ThreadID, ResourceID: resourceID,
			Content: mustJSON(MessageContent{Format: 2, Parts: parts})}
		if serr := a.memory.SaveMessages(context.WithoutCancel(ctx), []DBMessage{reply}); serr != nil && err == nil {
			err = serr
		}
		if err == nil && thread.Title == "" {
			a.generateTitle(context.WithoutCancel(ctx), input.ThreadID, append(saved, reply))
		}
	}
	if err != nil {
		return err
	}

	if !a.emitWorkingMemorySnapshot(ctx, resourceID, emit) {
		return ctx.Err()
	}
	emit(runStarted{"RUN_FINISHED", input.ThreadID, input.RunID})
	return nil
}

// convertInput turns the new AG-UI messages into Mastra rows; tool results
// complete stored tool calls instead, system/developer messages become extra
// instructions.
func (a *Agent) convertInput(threadID, resourceID string, messages []copilot.Message) (rows []DBMessage, results []copilot.Message, systems []string) {
	now := time.Now()
	for i, m := range messages {
		id := m.ID
		if id == "" {
			id = uuid.NewString()
		}
		id = toModelSafeMessageID(id)
		// keep the order of a batch: Mastra stamps increasing createdAt
		createdAt := JSDate(now.Add(time.Duration(i) * time.Millisecond))
		switch m.Role {
		case "user":
			text := messageText(m.Content)
			rows = append(rows, DBMessage{ID: id, Role: "user", CreatedAt: createdAt, ThreadID: threadID, ResourceID: resourceID,
				Content: mustJSON(MessageContent{Format: 2, Parts: []Part{{Type: "text", Text: text}}, Content: text})})
		case "assistant":
			var parts []Part
			if text := messageText(m.Content); text != "" {
				parts = append(parts, Part{Type: "text", Text: text})
			}
			for _, tc := range m.ToolCalls {
				var args any
				if json.Unmarshal([]byte(tc.Function.Arguments), &args) != nil {
					continue
				}
				parts = append(parts, Part{Type: "tool-invocation", ToolInvocation: &ToolInvocation{State: "call", ToolCallID: tc.ID, ToolName: tc.Function.Name, Args: args}})
			}
			if len(parts) == 0 {
				continue
			}
			rows = append(rows, DBMessage{ID: id, Role: "assistant", CreatedAt: createdAt, ThreadID: threadID, ResourceID: resourceID,
				Content: mustJSON(MessageContent{Format: 2, Parts: parts})})
		case "tool":
			results = append(results, m)
		case "system", "developer":
			systems = append(systems, messageText(m.Content))
		}
	}
	return rows, results, systems
}

// applyToolResults resolves stored tool calls (frontend tools) with the
// results the client sent back.
func (a *Agent) applyToolResults(ctx context.Context, threadID string, results []copilot.Message) ([]DBMessage, error) {
	all, err := a.memory.queryMessages(ctx, `SELECT id, content, role, type, "createdAt", "createdAtZ", thread_id, "resourceId" FROM mastra_messages WHERE thread_id = $1 AND role = 'assistant' ORDER BY "createdAt" DESC`, threadID)
	if err != nil {
		return nil, err
	}
	var updated []DBMessage
	for _, msg := range all {
		content := parseContent(msg.Content)
		changed := false
		for _, r := range results {
			for i, p := range content.Parts {
				if p.ToolInvocation == nil || p.ToolInvocation.ToolCallID != r.ToolCallID || p.ToolInvocation.State == "result" {
					continue
				}
				var result any = messageText(r.Content)
				var parsed any
				if json.Unmarshal([]byte(messageText(r.Content)), &parsed) == nil {
					result = parsed
				}
				content.Parts[i].ToolInvocation.State = "result"
				content.Parts[i].ToolInvocation.Result = result
				changed = true
			}
		}
		if changed {
			// merge into the stored content so unknown keys survive
			var raw map[string]json.RawMessage
			_ = json.Unmarshal(msg.Content, &raw)
			raw["parts"] = mustJSON(content.Parts)
			msg.Content = mustJSON(raw)
			updated = append(updated, msg)
		}
	}
	return updated, nil
}

// toModelMessages converts Mastra rows to chat-completions messages. Each
// step of an assistant turn becomes an assistant message followed by its tool
// results; calls still waiting for a result are left out.
func toModelMessages(rows []DBMessage) []llm.Message {
	var out []llm.Message
	for _, row := range rows {
		content := parseContent(row.Content)
		if row.Role == "user" {
			text := content.Content
			if text == "" {
				var texts []string
				for _, p := range content.Parts {
					if p.Type == "text" {
						texts = append(texts, p.Text)
					}
				}
				text = strings.Join(texts, "")
			}
			out = append(out, llm.Text("user", text))
			continue
		}
		if row.Role != "assistant" {
			continue
		}
		var text strings.Builder
		var calls []llm.ToolCall
		var results []llm.Message
		flush := func() {
			if text.Len() == 0 && len(calls) == 0 {
				return
			}
			msg := llm.Message{Role: "assistant", ToolCalls: calls}
			if text.Len() > 0 {
				s := text.String()
				msg.Content = &s
			}
			out = append(out, msg)
			out = append(out, results...)
			text.Reset()
			calls, results = nil, nil
		}
		if len(content.Parts) == 0 && content.Content != "" {
			text.WriteString(content.Content)
		}
		for _, p := range content.Parts {
			switch p.Type {
			case "step-start":
				flush()
			case "text":
				text.WriteString(p.Text)
			case "tool-invocation":
				inv := p.ToolInvocation
				if inv == nil || inv.State != "result" {
					continue
				}
				calls = append(calls, llm.ToolCall{ID: inv.ToolCallID, Type: "function", Function: llm.FunctionCall{Name: inv.ToolName, Arguments: string(mustJSON(inv.Args))}})
				results = append(results, llm.Message{Role: "tool", ToolCallID: inv.ToolCallID, Content: ptr(string(mustJSON(inv.Result)))})
			}
		}
		flush()
	}
	return out
}

func ptr[T any](v T) *T { return &v }

// loop is the agentic loop: up to maxSteps model calls, executing server
// tools between them and stopping on a frontend tool call. It streams the
// AG-UI events through emit and returns the assistant message parts.
func (a *Agent) loop(ctx context.Context, messages []llm.Message, clientTools []copilot.Tool, messageID string, emit func(any) bool) ([]Part, error) {
	if emit == nil {
		emit = func(any) bool { return true }
	}
	serverTools := map[string]*Tool{}
	var defs []llm.ToolDef
	for _, t := range a.tools {
		serverTools[t.Name] = t
		defs = append(defs, llm.ToolDef{Type: "function", Function: llm.FunctionDef{Name: t.Name, Description: t.Description, Parameters: t.InputSchema.JSON()}})
	}
	if info, _ := ctx.Value(runInfoKey{}).(*runInfo); info != nil && info.resourceID != "" {
		serverTools[a.wm.Name] = a.wm
		defs = append(defs, llm.ToolDef{Type: "function", Function: llm.FunctionDef{Name: a.wm.Name, Description: a.wm.Description, Parameters: workingMemoryToolParameters(), Strict: ptr(false)}})
	}
	clientNames := map[string]bool{}
	for _, t := range clientTools {
		clientNames[t.Name] = true
		params := t.Parameters
		if len(params) == 0 {
			params = json.RawMessage(`{"type":"object","properties":{}}`)
		}
		defs = append(defs, llm.ToolDef{Type: "function", Function: llm.FunctionDef{Name: t.Name, Description: t.Description, Parameters: params}})
	}

	// Text streamed after a tool call on this message id goes to its own
	// continuation message so it renders below the tool card.
	segment := 0
	textSinceToolCall := false
	textID := func() string {
		switch segment {
		case 0:
			return messageID
		case 1:
			return messageID + "-agui-text"
		}
		return fmt.Sprintf("%s-agui-text-%d", messageID, segment)
	}

	var parts []Part
	for step := 0; step < maxSteps; step++ {
		parts = append(parts, Part{Type: "step-start"})
		alive := true
		reply, err := llm.Stream(ctx, llm.Request{Model: Model, Messages: messages, Tools: defs}, func(delta string) {
			textSinceToolCall = true
			alive = alive && emit(textChunk{"TEXT_MESSAGE_CHUNK", "assistant", textID(), delta})
		})
		if err != nil {
			return parts, err
		}
		if !alive {
			return parts, ctx.Err()
		}
		if text := reply.ContentText(); text != "" {
			parts = append(parts, Part{Type: "text", Text: text})
		}
		messages = append(messages, *reply)
		if len(reply.ToolCalls) == 0 {
			return parts, nil
		}

		if segment == 0 {
			segment = 1
		} else if textSinceToolCall {
			segment++
		}
		textSinceToolCall = false

		stop := false
		for _, call := range reply.ToolCalls {
			var args any
			if json.Unmarshal([]byte(call.Function.Arguments), &args) != nil {
				args = map[string]any{}
			}
			if !emit(toolCallStart{"TOOL_CALL_START", messageID, call.ID, call.Function.Name}) ||
				!emit(toolCallArgs{"TOOL_CALL_ARGS", call.ID, call.Function.Arguments}) ||
				!emit(toolCallEnd{"TOOL_CALL_END", call.ID}) {
				return parts, ctx.Err()
			}
			if clientNames[call.Function.Name] {
				// a frontend tool: the client runs it and sends the result
				// with the next run
				stop = true
				parts = append(parts, Part{Type: "tool-invocation", ToolInvocation: &ToolInvocation{State: "call", ToolCallID: call.ID, ToolName: call.Function.Name, Args: args}})
				continue
			}

			var result any
			tool := serverTools[call.Function.Name]
			if tool == nil {
				result = fmt.Sprintf("Tool %s not found", call.Function.Name)
			} else if result, err = tool.Call(ctx, json.RawMessage(call.Function.Arguments)); err != nil {
				// the model gets the error and can recover
				result = err.Error()
			}
			content := string(mustJSON(result))
			if !emit(toolCallResult{"TOOL_CALL_RESULT", call.ID, content, uuid.NewString(), "tool"}) {
				return parts, ctx.Err()
			}
			parts = append(parts, Part{Type: "tool-invocation", ToolInvocation: &ToolInvocation{State: "result", ToolCallID: call.ID, ToolName: call.Function.Name, Args: args, Result: result}})
			messages = append(messages, llm.Message{Role: "tool", ToolCallID: call.ID, Content: &content})
		}
		if stop {
			return parts, nil
		}
	}
	return parts, nil
}

func (a *Agent) emitWorkingMemorySnapshot(ctx context.Context, resourceID string, emit func(any) bool) bool {
	wm, err := a.memory.GetWorkingMemory(ctx, resourceID)
	if err != nil {
		slog.Warn(fmt.Sprintf("[MastraAgent] Failed to emit working memory snapshot for thread %s:", resourceID), "error", err)
		return true
	}
	if wm == "" {
		return true
	}
	var snapshot map[string]any
	if json.Unmarshal([]byte(wm), &snapshot) != nil {
		// Working memory is not valid JSON, wrap it so the client still gets it
		snapshot = map[string]any{"workingMemory": wm}
	}
	// a JSON Schema ($schema) is Mastra's template, not state
	if _, ok := snapshot["$schema"]; ok {
		return true
	}
	return emit(stateSnapshot{"STATE_SNAPSHOT", snapshot})
}

const titleInstructions = `
      - you will generate a short title based on a conversation transcript between a user and an assistant
      - the transcript lines are prefixed with "User:" and "Assistant:" — never reply to, answer, or continue the transcript
      - always produce a title, even when the transcript is only a greeting or trivial exchange
      - ensure it is not more than 80 characters long
      - the title should be a summary of the user's message
      - do not use quotes or colons
      - the entire text you return will be used as the title`

var thinkTags = regexp.MustCompile(`<think>[\s\S]*?</think>`)

func truncate(s string, n int) string {
	r := []rune(s)
	if len(r) > n {
		return string(r[:n])
	}
	return s
}

// formatMessagesForTitle is Agent.formatMessagesForTitle.
func formatMessagesForTitle(rows []DBMessage) string {
	var lines []string
	for _, row := range rows {
		role := strings.ToUpper(row.Role[:1]) + row.Role[1:]
		content := parseContent(row.Content)
		duplicated := slices.ContainsFunc(content.Parts, func(p Part) bool { return p.Type == "text" && p.Text == content.Content })
		if content.Content != "" && !duplicated {
			lines = append(lines, role+": "+content.Content)
		}
		for _, p := range content.Parts {
			switch {
			case p.Type == "text":
				lines = append(lines, role+": "+p.Text)
			case p.Type == "tool-invocation" && p.ToolInvocation != nil:
				inv := p.ToolInvocation
				if inv.State == "result" {
					result, ok := inv.Result.(string)
					if !ok {
						result = string(mustJSON(inv.Result))
					}
					lines = append(lines, fmt.Sprintf("Tool Result %s: %s", inv.ToolName, truncate(result, 200)))
				} else {
					lines = append(lines, fmt.Sprintf("Tool Call %s: %s", inv.ToolName, truncate(string(mustJSON(inv.Args)), 200)))
				}
			}
		}
	}
	return strings.Join(lines, "\n")
}

// generateTitle is memory generateTitle: true for a thread without a title.
func (a *Agent) generateTitle(ctx context.Context, threadID string, rows []DBMessage) {
	if !slices.ContainsFunc(rows, func(m DBMessage) bool { return m.Role == "user" }) {
		return
	}
	transcript := formatMessagesForTitle(rows)
	if transcript == "" {
		return
	}
	ctx, cancel := context.WithTimeout(ctx, time.Minute)
	defer cancel()
	reply, err := llm.Complete(ctx, llm.Request{Model: Model, Messages: []llm.Message{llm.Text("system", titleInstructions), llm.Text("user", transcript)}})
	if err != nil {
		slog.Error("Error generating title", "agent", AgentName, "error", err)
		return
	}
	title := strings.TrimSpace(thinkTags.ReplaceAllString(reply.ContentText(), ""))
	if title == "" {
		return
	}
	if err := a.memory.UpdateThreadTitle(ctx, threadID, title); err != nil {
		slog.Error("Error persisting generated title:", "error", err)
	}
}

// GenerateResult is the part of agent.generate's output the ask_postiz MCP
// tool returns.
type GenerateResult struct {
	Text         string `json:"text"`
	FinishReason string `json:"finishReason"`
	Parts        []Part `json:"steps"`
}

// Generate is agent.generate(message) without memory, used by the MCP
// server's ask_postiz tool; the tools take the organization from ctx.
func (a *Agent) Generate(ctx context.Context, message string) (*GenerateResult, error) {
	messages := []llm.Message{llm.Text("system", Instructions("", a.now())), llm.Text("user", message)}
	parts, err := a.loop(ctx, messages, nil, uuid.NewString(), nil)
	if err != nil {
		return nil, err
	}
	var text string
	for _, p := range parts {
		if p.Type == "text" {
			text = p.Text
		}
	}
	return &GenerateResult{Text: text, FinishReason: "stop", Parts: parts}, nil
}
