// Package copilot ports the CopilotKit runtime Postiz mounts with
// copilotRuntimeNodeHttpEndpoint (@copilotkit/runtime 1.72.0) on
// POST /copilot/chat and POST /copilot/agent.
//
// The 1.72 runtime no longer speaks GraphQL: copilotRuntimeNodeHttpEndpoint
// builds a single-route endpoint (v2/runtime/endpoints/hono-single) that takes
// a JSON envelope {method, params, body} and answers either JSON ("info",
// "agent/stop") or an AG-UI SSE stream ("agent/run", "agent/connect",
// "agent/suggest") of `data: <event json>\n\n` frames.
package copilot

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"mime"
	"net/http"
	"os"
	"slices"
	"strings"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/httpx"
)

// version is the runtime VERSION reported by "info" (the package version).
const version = "1.72.0"

// AgentRunner runs one AG-UI agent turn. The channel yields AG-UI event JSON
// objects (RUN_STARTED, TEXT_MESSAGE_*, TOOL_CALL_*, STATE_SNAPSHOT,
// RUN_FINISHED, RUN_ERROR...) and is closed when the run ends. Cancelling ctx
// aborts the run (agent/stop); the runtime always drains the channel.
type AgentRunner interface {
	Run(ctx context.Context, input RunAgentInput) (<-chan json.RawMessage, error)
}

// RunAgentInput is the AG-UI RunAgentInput (@ag-ui/core RunAgentInputSchema).
type RunAgentInput struct {
	ThreadID       string          `json:"threadId"`
	RunID          string          `json:"runId"`
	ParentRunID    string          `json:"parentRunId,omitempty"`
	State          json.RawMessage `json:"state,omitempty"`
	Messages       []Message       `json:"messages"`
	Tools          []Tool          `json:"tools"`
	Context        []Context       `json:"context"`
	ForwardedProps json.RawMessage `json:"forwardedProps,omitempty"`
	Resume         json.RawMessage `json:"resume,omitempty"`

	// Organization is the caller's organization on /copilot/agent: the
	// controller passes it to the Mastra agent as resourceId (organization.id)
	// and as the "organization" request context entry. Nil on /copilot/chat.
	Organization *ent.Organization `json:"-"`
}

// Message is an AG-UI message. Content is a string, or for user messages an
// array of input parts. Messages re-marshal to the exact JSON received.
type Message struct {
	ID         string          `json:"id"`
	Role       string          `json:"role"`
	Content    json.RawMessage `json:"content,omitempty"`
	Name       string          `json:"name,omitempty"`
	ToolCalls  []ToolCall      `json:"toolCalls,omitempty"`
	ToolCallID string          `json:"toolCallId,omitempty"`
	Error      string          `json:"error,omitempty"`

	raw json.RawMessage
}

type plainMessage Message

func (m *Message) UnmarshalJSON(b []byte) error {
	if err := json.Unmarshal(b, (*plainMessage)(m)); err != nil {
		return err
	}
	m.raw = append(json.RawMessage(nil), b...)
	return nil
}

func (m Message) MarshalJSON() ([]byte, error) {
	if m.raw != nil {
		return m.raw, nil
	}
	return json.Marshal(plainMessage(m))
}

// Text is the message text: the string content, or the user text parts joined.
func (m Message) Text() string {
	var s string
	if json.Unmarshal(m.Content, &s) == nil {
		return s
	}
	var parts []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	}
	_ = json.Unmarshal(m.Content, &parts)
	var b strings.Builder
	for _, p := range parts {
		if p.Type == "text" {
			b.WriteString(p.Text)
		}
	}
	return b.String()
}

// ToolCall is an assistant message tool call.
type ToolCall struct {
	ID       string `json:"id"`
	Type     string `json:"type"`
	Function struct {
		Name      string `json:"name"`
		Arguments string `json:"arguments"`
	} `json:"function"`
}

// Tool is a frontend tool (useCopilotAction) the agent may call.
type Tool struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	Parameters  json.RawMessage `json:"parameters,omitempty"`
	Metadata    json.RawMessage `json:"metadata,omitempty"`
}

// Context is a readable (useCopilotReadable) context entry.
type Context struct {
	Description string `json:"description"`
	Value       string `json:"value"`
}

type agentInfo struct {
	Name         string          `json:"name"`
	Description  string          `json:"description"`
	ClassName    string          `json:"className"`
	Capabilities json.RawMessage `json:"capabilities,omitempty"`
}

type agentEntry struct {
	runner AgentRunner
	info   agentInfo
}

// builtInCapabilities is BuiltInAgent.getCapabilities() without config overrides.
var builtInCapabilities = json.RawMessage(`{"tools":{"supported":true,"clientProvided":true},"transport":{"streaming":true},"humanInTheLoop":{"interrupts":true}}`)

// Runtime serves the two CopilotKit endpoints of CopilotController.
type Runtime struct {
	postiz AgentRunner
}

// New returns the runtime; postiz runs the Mastra "postiz" agent behind /copilot/agent.
func New(postiz AgentRunner) *Runtime {
	return &Runtime{postiz: postiz}
}

// Chat is POST /copilot/chat (register with httpx.Raw()): a CopilotRuntime
// with no agents and OpenAIAdapter({model: 'gpt-4.1'}), which the runtime turns
// into a "default" BuiltInAgent.
func (rt *Runtime) Chat(c *httpx.Ctx) (any, error) {
	return serve(c, map[string]agentEntry{
		"default": {runner: builtInAgent{model: "gpt-4.1"}, info: agentInfo{Name: "default", ClassName: "BuiltInAgent", Capabilities: builtInCapabilities}},
	})
}

// Agent is POST /copilot/agent (register with httpx.Raw() behind
// CheckPolicies([Create, AI])): MastraAgent.getLocalAgents exposes the Mastra
// "postiz" agent for the caller's organization.
func (rt *Runtime) Agent(c *httpx.Ctx) (any, error) {
	return serve(c, map[string]agentEntry{
		// className is constructor.name of MastraAgent in the @ag-ui/mastra 1.1.4
		// CJS bundle Postiz loads, where the class is minified to "e".
		"postiz": {runner: orgRunner{rt.postiz, c.Org}, info: agentInfo{Name: "postiz", ClassName: "e"}},
	})
}

type orgRunner struct {
	AgentRunner
	org *ent.Organization
}

func (o orgRunner) Run(ctx context.Context, input RunAgentInput) (<-chan json.RawMessage, error) {
	input.Organization = o.org
	return o.AgentRunner.Run(ctx, input)
}

// envelope is the single-route request body (single-route-helpers parseMethodCall).
type envelope struct {
	Method any                        `json:"method"`
	Params map[string]json.RawMessage `json:"params"`
	Body   json.RawMessage            `json:"body"`
}

var methodNames = []string{"agent/run", "agent/suggest", "agent/connect", "agent/stop", "info", "inspector/metadata", "inspector/learning", "transcribe", "resource/request"}

func serve(c *httpx.Ctx, agents map[string]agentEntry) (any, error) {
	if os.Getenv("OPENAI_API_KEY") == "" {
		slog.Warn("OpenAI API key not set, chat functionality will not work")
		// The Nest handler returns without touching @Res(), so the request is
		// never answered; hold it until the client gives up.
		<-c.R.Context().Done()
		return nil, nil
	}

	// main.ts mounts json({limit: '50mb'}) on /copilot; a body Express does not
	// parse as JSON reaches the runtime as {}.
	c.BodyLimit(50 << 20)
	var env envelope
	if mt, _, _ := mime.ParseMediaType(c.Header("Content-Type")); mt == "application/json" || strings.HasSuffix(mt, "+json") {
		if err := c.Decode(&env); err != nil {
			return nil, err
		}
	}

	w := c.W
	setCORS(w, c.Header("Origin"))

	method, _ := env.Method.(string)
	if !truthy(env.Method) {
		writeJSON(w, http.StatusBadRequest, invalidRequest("Missing method field"))
		return nil, nil
	}
	if !slices.Contains(methodNames, method) {
		writeJSON(w, http.StatusBadRequest, invalidRequest(fmt.Sprintf("Unsupported method '%v'", jsString(env.Method))))
		return nil, nil
	}

	switch method {
	case "info":
		writeJSON(w, http.StatusOK, info(agents))
	case "inspector/metadata":
		w.Header().Set("Cache-Control", "no-store, private")
		w.WriteHeader(http.StatusNoContent)
	case "agent/stop":
		agentID, ok := expectString(w, env.Params, "agentId")
		if !ok {
			return nil, nil
		}
		threadID, ok := expectString(w, env.Params, "threadId")
		if !ok {
			return nil, nil
		}
		if _, ok := agents[agentID]; !ok {
			writeJSON(w, http.StatusNotFound, agentNotFound(agentID))
			return nil, nil
		}
		if !stopThread(threadID) {
			writeJSON(w, http.StatusOK, struct {
				Stopped bool   `json:"stopped"`
				Message string `json:"message"`
			}{false, fmt.Sprintf("No active run for thread '%s'.", threadID)})
			return nil, nil
		}
		writeJSON(w, http.StatusOK, json.RawMessage(`{"stopped":true,"interrupt":{"type":"RUN_ERROR","message":"Run stopped by user","code":"STOPPED"}}`))
	case "agent/run", "agent/suggest", "agent/connect":
		agentID, ok := expectString(w, env.Params, "agentId")
		if !ok {
			return nil, nil
		}
		if len(env.Body) == 0 || string(env.Body) == "null" {
			writeJSON(w, http.StatusBadRequest, invalidRequest("Missing request body for JSON handler"))
			return nil, nil
		}
		agent, ok := agents[agentID]
		if !ok {
			writeJSON(w, http.StatusNotFound, agentNotFound(agentID))
			return nil, nil
		}
		input, details := parseRunInput(env.Body)
		if details != "" {
			slog.Error("Invalid run request body", "details", details)
			writeJSON(w, http.StatusBadRequest, errorBody{Error: "Invalid request body", Details: details})
			return nil, nil
		}
		switch method {
		case "agent/run":
			runThread(w, c.R, agent.runner, input)
		case "agent/connect":
			connectThread(w, c.R, input.ThreadID)
		default:
			suggest(w, c.R, agent.runner, input)
		}
	default:
		// inspector/learning, transcribe and resource/request need CopilotKit
		// Intelligence or a transcription service, neither of which Postiz configures.
		writeJSON(w, http.StatusNotFound, errorBody{Error: "Not found"})
	}
	return nil, nil
}

// setCORS applies copilotCors() the way the runtime's addCorsHeaders does: an
// origin allow-list echoing the request origin, credentials unless NOT_SECURED.
func setCORS(w http.ResponseWriter, origin string) {
	allowed := []string{os.Getenv("FRONTEND_URL"), "http://localhost:6274"}
	if mainURL := os.Getenv("MAIN_URL"); mainURL != "" {
		allowed = append(allowed, mainURL)
	}
	if origin == "" || !slices.Contains(allowed, origin) {
		return
	}
	h := w.Header()
	h.Set("Access-Control-Allow-Origin", origin)
	if os.Getenv("NOT_SECURED") == "" {
		h.Set("Access-Control-Allow-Credentials", "true")
	}
	h.Set("Vary", "Origin")
}

type threadEndpoints struct {
	List             bool `json:"list"`
	Inspect          bool `json:"inspect"`
	Mutations        bool `json:"mutations"`
	RealtimeMetadata bool `json:"realtimeMetadata"`
}

type runtimeInfo struct {
	Version                       string               `json:"version"`
	Agents                        map[string]agentInfo `json:"agents"`
	AudioFileTranscriptionEnabled bool                 `json:"audioFileTranscriptionEnabled"`
	Mode                          string               `json:"mode"`
	ThreadEndpoints               threadEndpoints      `json:"threadEndpoints"`
	SingleRoute                   struct {
		ResourceOperations bool            `json:"resourceOperations"`
		ThreadEndpoints    threadEndpoints `json:"threadEndpoints"`
	} `json:"singleRoute"`
	Suggestions             bool `json:"suggestions"`
	A2UIEnabled             bool `json:"a2uiEnabled"`
	OpenGenerativeUIEnabled bool `json:"openGenerativeUIEnabled"`
	TelemetryDisabled       bool `json:"telemetryDisabled"`
}

// info is handleGetRuntimeInfo for an SSE runtime with no transcription,
// A2UI, open generative UI or Intelligence.
func info(agents map[string]agentEntry) runtimeInfo {
	out := runtimeInfo{Version: version, Agents: map[string]agentInfo{}, Mode: "sse", Suggestions: true}
	for name, a := range agents {
		out.Agents[name] = a.info
	}
	out.SingleRoute.ResourceOperations = true
	out.TelemetryDisabled = slices.Contains([]string{"true", "1"}, os.Getenv("COPILOTKIT_TELEMETRY_DISABLED")) ||
		slices.Contains([]string{"true", "1"}, os.Getenv("DO_NOT_TRACK"))
	return out
}

// errorBody is the runtime's JSON error, keys in its order.
type errorBody struct {
	Error   string `json:"error"`
	Message string `json:"message,omitempty"`
	Details string `json:"details,omitempty"`
}

func invalidRequest(message string) errorBody {
	return errorBody{Error: "invalid_request", Message: message}
}

func agentNotFound(agentID string) errorBody {
	return errorBody{Error: "Agent not found", Message: fmt.Sprintf("Agent '%s' does not exist", agentID)}
}

func expectString(w http.ResponseWriter, params map[string]json.RawMessage, key string) (string, bool) {
	var s string
	if json.Unmarshal(params[key], &s) == nil && strings.TrimSpace(s) != "" {
		return s, true
	}
	writeJSON(w, http.StatusBadRequest, invalidRequest(fmt.Sprintf("Missing or invalid parameter '%s'", key)))
	return "", false
}

func truthy(v any) bool {
	switch v := v.(type) {
	case nil:
		return false
	case string:
		return v != ""
	case bool:
		return v
	case float64:
		return v != 0
	}
	return true
}

func jsString(v any) string {
	if f, ok := v.(float64); ok {
		return fmt.Sprint(f)
	}
	if b, ok := v.(bool); ok {
		return fmt.Sprint(b)
	}
	if s, ok := v.(string); ok {
		return s
	}
	return "[object Object]"
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write(marshal(body))
}

// marshal encodes like JSON.stringify: no HTML escaping, no trailing newline.
func marshal(v any) json.RawMessage {
	var b strings.Builder
	enc := json.NewEncoder(&b)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		panic(err)
	}
	return json.RawMessage(strings.TrimSuffix(b.String(), "\n"))
}

var messageRoles = []string{"developer", "system", "assistant", "user", "tool", "activity", "reasoning"}

// parseRunInput is RunAgentInputSchema.parse; it returns the failure details.
func parseRunInput(body json.RawMessage) (RunAgentInput, string) {
	var in RunAgentInput
	if err := json.Unmarshal(body, &in); err != nil {
		return in, err.Error()
	}
	var fields map[string]json.RawMessage
	_ = json.Unmarshal(body, &fields)
	var issues []zodIssue
	for _, f := range []struct{ name, kind string }{{"threadId", "string"}, {"runId", "string"}, {"messages", "array"}, {"tools", "array"}, {"context", "array"}} {
		if v, ok := fields[f.name]; !ok || string(v) == "null" {
			issues = append(issues, zodIssue{Code: "invalid_type", Expected: f.kind, Received: received(v, ok), Path: []any{f.name}, Message: "Required"})
		}
	}
	for i, m := range in.Messages {
		if !slices.Contains(messageRoles, m.Role) {
			issues = append(issues, zodIssue{Code: "invalid_union_discriminator", Options: messageRoles, Path: []any{"messages", i, "role"},
				Message: "Invalid discriminator value. Expected 'developer' | 'system' | 'assistant' | 'user' | 'tool' | 'activity' | 'reasoning'"})
		}
	}
	if len(issues) > 0 {
		b, _ := json.MarshalIndent(issues, "", "  ")
		return in, string(b)
	}
	// state: z.any().transform((v) => v ?? undefined)
	if string(in.State) == "null" {
		in.State = nil
	}
	return in, ""
}

// zodIssue is a ZodError issue; the error message is the issues as indented JSON.
type zodIssue struct {
	Code     string   `json:"code"`
	Expected string   `json:"expected,omitempty"`
	Received string   `json:"received,omitempty"`
	Options  []string `json:"options,omitempty"`
	Path     []any    `json:"path"`
	Message  string   `json:"message"`
}

func received(v json.RawMessage, ok bool) string {
	if !ok {
		return "undefined"
	}
	if string(v) == "null" {
		return "null"
	}
	return "unknown"
}
