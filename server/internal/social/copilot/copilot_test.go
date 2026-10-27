package copilot

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/httpx"
)

// The request/response pairs below are derived from @copilotkit/runtime
// 1.72.0 (single-route endpoint, InMemoryAgentRunner, BuiltInAgent) and the
// @copilotkit/core 1.72.0 ProxiedCopilotRuntimeAgent that sends them.

type fakeRunner struct {
	events []string
	block  bool // keep the run open until ctx is cancelled
	got    chan RunAgentInput
}

func (f *fakeRunner) Run(ctx context.Context, input RunAgentInput) (<-chan json.RawMessage, error) {
	if f.got != nil {
		f.got <- input
	}
	ch := make(chan json.RawMessage)
	go func() {
		defer close(ch)
		for _, e := range f.events {
			ch <- json.RawMessage(e)
		}
		if f.block {
			<-ctx.Done()
		}
	}()
	return ch, nil
}

func newServer(t *testing.T, agent AgentRunner) *httptest.Server {
	t.Helper()
	t.Setenv("OPENAI_API_KEY", "sk-test")
	t.Setenv("FRONTEND_URL", "http://app.test")
	t.Setenv("MAIN_URL", "")
	t.Setenv("NOT_SECURED", "")
	t.Setenv("COPILOTKIT_TELEMETRY_DISABLED", "")
	t.Setenv("DO_NOT_TRACK", "")
	threads.Lock()
	threads.m = map[string]*thread{} // the store is process-wide
	threads.Unlock()
	rt := New(agent)
	r := httpx.NewRouter()
	r.Use(func(c *httpx.Ctx) error {
		c.Org = &ent.Organization{ID: "org-1"}
		return nil
	})
	g := r.Group("/copilot")
	g.Post("/chat", rt.Chat, httpx.Raw())
	g.Post("/agent", rt.Agent, httpx.Raw())
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)
	return srv
}

func post(t *testing.T, url, body string) (*http.Response, string) {
	t.Helper()
	req, _ := http.NewRequest(http.MethodPost, url, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "http://app.test")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	return resp, string(data)
}

var uuidRe = regexp.MustCompile(`[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}`)

// sse returns the data frames of an AG-UI SSE body, UUIDs replaced by <uuid>.
func sse(t *testing.T, resp *http.Response, body string) []string {
	t.Helper()
	if ct := resp.Header.Get("Content-Type"); ct != "text/event-stream" {
		t.Fatalf("content-type %q, body %s", ct, body)
	}
	var out []string
	for _, frame := range strings.Split(body, "\n\n") {
		if frame == "" {
			continue
		}
		data, ok := strings.CutPrefix(frame, "data: ")
		if !ok {
			t.Fatalf("bad frame %q", frame)
		}
		out = append(out, uuidRe.ReplaceAllString(data, "<uuid>"))
	}
	return out
}

func equalEvents(t *testing.T, got, want []string) {
	t.Helper()
	if strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Fatalf("events:\n%s\nwant:\n%s", strings.Join(got, "\n"), strings.Join(want, "\n"))
	}
}

const noThreadEndpoints = `{"list":false,"inspect":false,"mutations":false,"realtimeMetadata":false}`

func TestInfoDiscovery(t *testing.T) {
	srv := newServer(t, &fakeRunner{})
	tail := `"audioFileTranscriptionEnabled":false,"mode":"sse","threadEndpoints":` + noThreadEndpoints +
		`,"singleRoute":{"resourceOperations":true,"threadEndpoints":` + noThreadEndpoints +
		`},"suggestions":true,"a2uiEnabled":false,"openGenerativeUIEnabled":false,"telemetryDisabled":false}`

	for _, tc := range []struct{ path, agents string }{
		{"/copilot/chat", `{"default":{"name":"default","description":"","className":"BuiltInAgent","capabilities":{"tools":{"supported":true,"clientProvided":true},"transport":{"streaming":true},"humanInTheLoop":{"interrupts":true}}}}`},
		{"/copilot/agent", `{"social":{"name":"social","description":"","className":"e"}}`},
	} {
		resp, body := post(t, srv.URL+tc.path, `{"method":"info"}`)
		if resp.StatusCode != 200 || body != `{"version":"1.72.0","agents":`+tc.agents+`,`+tail {
			t.Fatalf("%s: %d %s", tc.path, resp.StatusCode, body)
		}
		if resp.Header.Get("Access-Control-Allow-Origin") != "http://app.test" || resp.Header.Get("Access-Control-Allow-Credentials") != "true" || resp.Header.Get("Vary") != "Origin" {
			t.Fatalf("%s: cors headers %v", tc.path, resp.Header)
		}
	}
}

func TestEnvelopeErrors(t *testing.T) {
	srv := newServer(t, &fakeRunner{})
	run := `{"threadId":"t","runId":"r","messages":[],"tools":[],"context":[]}`
	for _, tc := range []struct {
		body   string
		status int
		want   string
	}{
		{`{}`, 400, `{"error":"invalid_request","message":"Missing method field"}`},
		{`{"method":"agent/nope"}`, 400, `{"error":"invalid_request","message":"Unsupported method 'agent/nope'"}`},
		{`{"method":"agent/run","body":` + run + `}`, 400, `{"error":"invalid_request","message":"Missing or invalid parameter 'agentId'"}`},
		{`{"method":"agent/run","params":{"agentId":"social"}}`, 400, `{"error":"invalid_request","message":"Missing request body for JSON handler"}`},
		{`{"method":"agent/run","params":{"agentId":"default"},"body":` + run + `}`, 404, `{"error":"Agent not found","message":"Agent 'default' does not exist"}`},
		{`{"method":"agent/stop","params":{"agentId":"social","threadId":"idle"}}`, 200, `{"stopped":false,"message":"No active run for thread 'idle'."}`},
	} {
		resp, body := post(t, srv.URL+"/copilot/agent", tc.body)
		if resp.StatusCode != tc.status || body != tc.want {
			t.Fatalf("%s: %d %s", tc.body, resp.StatusCode, body)
		}
	}

	resp, body := post(t, srv.URL+"/copilot/agent", `{"method":"agent/run","params":{"agentId":"social"},"body":{"runId":"r","messages":[],"tools":[],"context":[]}}`)
	if resp.StatusCode != 400 || !strings.Contains(body, `"error":"Invalid request body"`) || !strings.Contains(body, `\"threadId\"`) {
		t.Fatalf("invalid body: %d %s", resp.StatusCode, body)
	}
}

func TestChatTurnStreamsOpenAIText(t *testing.T) {
	var sent map[string]any
	openai := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" || r.Header.Get("Authorization") != "Bearer sk-test" {
			t.Errorf("request %s %s", r.URL.Path, r.Header.Get("Authorization"))
		}
		_ = json.NewDecoder(r.Body).Decode(&sent)
		w.Header().Set("Content-Type", "text/event-stream")
		for _, chunk := range []string{
			`{"choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}`,
			`{"choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}`,
			`{"choices":[{"index":0,"delta":{"content":" <world>"},"finish_reason":null}]}`,
			`{"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}`,
			`{"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":2,"total_tokens":12,"prompt_tokens_details":{"cached_tokens":0},"completion_tokens_details":{"reasoning_tokens":0}}}`,
			`[DONE]`,
		} {
			_, _ = io.WriteString(w, "data: "+chunk+"\n\n")
		}
	}))
	defer openai.Close()
	srv := newServer(t, &fakeRunner{})
	t.Setenv("OPENAI_BASE_URL", openai.URL+"/v1")

	input := `{"threadId":"t-chat","runId":"r1","state":{},"messages":[{"id":"s1","role":"system","content":"ignored"},{"id":"u1","role":"user","content":"Hi"}],` +
		`"tools":[{"name":"setTime","description":"Set the time","parameters":{"type":"object","properties":{"time":{"type":"string"}},"required":["time"]}}],` +
		`"context":[{"description":"Current date","value":"2026-10-11"}],"forwardedProps":{}}`
	resp, body := post(t, srv.URL+"/copilot/chat", `{"method":"agent/run","params":{"agentId":"default"},"body":`+input+`}`)

	equalEvents(t, sse(t, resp, body), []string{
		`{"type":"RUN_STARTED","threadId":"t-chat","runId":"r1","input":{"threadId":"t-chat","runId":"r1","state":{},"messages":[{"id":"s1","role":"system","content":"ignored"},{"id":"u1","role":"user","content":"Hi"}],"tools":[{"name":"setTime","description":"Set the time","parameters":{"type":"object","properties":{"time":{"type":"string"}},"required":["time"]}}],"context":[{"description":"Current date","value":"2026-10-11"}],"forwardedProps":{}}}`,
		`{"type":"TEXT_MESSAGE_START","messageId":"<uuid>","role":"assistant"}`,
		`{"type":"TEXT_MESSAGE_CONTENT","messageId":"<uuid>","delta":"Hello"}`,
		`{"type":"TEXT_MESSAGE_CONTENT","messageId":"<uuid>","delta":" <world>"}`,
		`{"type":"TEXT_MESSAGE_END","messageId":"<uuid>"}`,
		`{"type":"RUN_FINISHED","threadId":"t-chat","runId":"r1","finishReason":"stop","usage":[{"provider":"openai.chat","model":"gpt-4.1","inputTokens":10,"outputTokens":2,"totalTokens":12,"reasoningTokens":0,"cachedInputTokens":0}]}`,
	})

	// The OpenAI request: system prompt from the readable context, system
	// messages not forwarded, frontend tools followed by the state tools.
	messages, _ := json.Marshal(sent["messages"])
	if string(messages) != `[{"content":"\n## Context from the application\nCurrent date:\n2026-10-11\n","role":"system"},{"content":"Hi","role":"user"}]` {
		t.Fatalf("messages %s", messages)
	}
	var names []string
	for _, tool := range sent["tools"].([]any) {
		names = append(names, tool.(map[string]any)["function"].(map[string]any)["name"].(string))
	}
	if sent["model"] != "gpt-4.1" || sent["stream"] != true || strings.Join(names, ",") != "setTime,AGUISendStateSnapshot,AGUISendStateDelta" {
		t.Fatalf("request %v", sent)
	}
}

func TestChatToolCallAndOpenAIError(t *testing.T) {
	fail := false
	openai := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if fail {
			w.WriteHeader(http.StatusBadRequest)
			_, _ = io.WriteString(w, `{"error":{"message":"Invalid schema for function 'setTime'","type":"invalid_request_error"}}`)
			return
		}
		for _, chunk := range []string{
			`{"choices":[{"index":0,"delta":{"role":"assistant","content":null,"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"setTime","arguments":""}}]},"finish_reason":null}]}`,
			`{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\"time\":"}}]},"finish_reason":null}]}`,
			`{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\"10:00\"}"}}]},"finish_reason":null}]}`,
			`{"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}`,
			`[DONE]`,
		} {
			_, _ = io.WriteString(w, "data: "+chunk+"\n\n")
		}
	}))
	defer openai.Close()
	srv := newServer(t, &fakeRunner{})
	t.Setenv("OPENAI_BASE_URL", openai.URL)

	run := func(thread string) []string {
		input := `{"threadId":"` + thread + `","runId":"r1","messages":[{"id":"u1","role":"user","content":"Set 10am"}],"tools":[],"context":[]}`
		resp, body := post(t, srv.URL+"/copilot/chat", `{"method":"agent/run","params":{"agentId":"default"},"body":`+input+`}`)
		events := sse(t, resp, body)
		return events[1:] // RUN_STARTED is covered above
	}
	equalEvents(t, run("t-tool"), []string{
		`{"type":"TOOL_CALL_START","toolCallId":"call_1","toolCallName":"setTime","parentMessageId":"<uuid>"}`,
		`{"type":"TOOL_CALL_ARGS","toolCallId":"call_1","delta":"{\"time\":"}`,
		`{"type":"TOOL_CALL_ARGS","toolCallId":"call_1","delta":"\"10:00\"}"}`,
		`{"type":"TOOL_CALL_END","toolCallId":"call_1"}`,
		`{"type":"RUN_FINISHED","threadId":"t-tool","runId":"r1","finishReason":"tool-calls"}`,
	})

	fail = true
	equalEvents(t, run("t-error"), []string{
		`{"type":"RUN_ERROR","message":"Invalid schema for function 'setTime'","threadId":"t-error","runId":"r1"}`,
	})
}

func TestAgentRunWithToolCallThenConnectReplays(t *testing.T) {
	runner := &fakeRunner{got: make(chan RunAgentInput, 2), events: []string{
		`{"type":"RUN_STARTED","threadId":"t-agent","runId":"r1"}`,
		`{"type":"TEXT_MESSAGE_CHUNK","messageId":"m1","role":"assistant","delta":"Scheduling"}`,
		`{"type":"TOOL_CALL_CHUNK","toolCallId":"tc1","toolCallName":"schedulePost","parentMessageId":"m1","delta":"{\"date\":"}`,
		`{"type":"TOOL_CALL_CHUNK","delta":"\"2026-10-12\"}"}`,
		`{"type":"RUN_FINISHED","threadId":"t-agent","runId":"r1"}`,
	}}
	srv := newServer(t, runner)

	input := `{"threadId":"t-agent","runId":"r1","messages":[{"id":"u1","role":"user","content":"Post tomorrow"}],"tools":[],"context":[],"forwardedProps":{"integrations":[{"id":"i1"}]}}`
	resp, body := post(t, srv.URL+"/copilot/agent", `{"method":"agent/run","params":{"agentId":"social"},"body":`+input+`}`)
	want := []string{
		`{"type":"RUN_STARTED","threadId":"t-agent","runId":"r1","input":` + input + `}`,
		`{"type":"TEXT_MESSAGE_START","messageId":"m1","role":"assistant"}`,
		`{"type":"TEXT_MESSAGE_CONTENT","messageId":"m1","delta":"Scheduling"}`,
		`{"type":"TEXT_MESSAGE_END","messageId":"m1"}`,
		`{"type":"TOOL_CALL_START","toolCallId":"tc1","toolCallName":"schedulePost","parentMessageId":"m1"}`,
		`{"type":"TOOL_CALL_ARGS","toolCallId":"tc1","delta":"{\"date\":"}`,
		`{"type":"TOOL_CALL_ARGS","toolCallId":"tc1","delta":"\"2026-10-12\"}"}`,
		`{"type":"TOOL_CALL_END","toolCallId":"tc1"}`,
		`{"type":"RUN_FINISHED","threadId":"t-agent","runId":"r1"}`,
	}
	equalEvents(t, sse(t, resp, body), want)
	got := <-runner.got
	if got.Organization == nil || got.Organization.ID != "org-1" || string(got.ForwardedProps) != `{"integrations":[{"id":"i1"}]}` || got.Messages[0].Text() != "Post tomorrow" {
		t.Fatalf("runner input %+v", got)
	}

	// agent/connect replays the thread history.
	resp, body = post(t, srv.URL+"/copilot/agent", `{"method":"agent/connect","params":{"agentId":"social"},"body":{"threadId":"t-agent","runId":"c1","messages":[],"tools":[],"context":[]}}`)
	equalEvents(t, sse(t, resp, body), want)

	// The next run's RUN_STARTED input carries only messages new to the thread.
	next := `{"threadId":"t-agent","runId":"r2","messages":[{"id":"u1","role":"user","content":"Post tomorrow"},{"id":"m1","role":"assistant","content":"Scheduling"},{"id":"u2","role":"user","content":"Thanks"}],"tools":[],"context":[]}`
	runner.events[0] = `{"type":"RUN_STARTED","threadId":"t-agent","runId":"r2"}`
	runner.events = runner.events[:1]
	resp, body = post(t, srv.URL+"/copilot/agent", `{"method":"agent/run","params":{"agentId":"social"},"body":`+next+`}`)
	equalEvents(t, sse(t, resp, body), []string{
		`{"type":"RUN_STARTED","threadId":"t-agent","runId":"r2","input":{"threadId":"t-agent","runId":"r2","messages":[{"id":"u2","role":"user","content":"Thanks"}],"tools":[],"context":[]}}`,
		`{"type":"RUN_ERROR","message":"Run ended without emitting a terminal event","code":"INCOMPLETE_STREAM"}`,
	})
}

func TestAgentStop(t *testing.T) {
	runner := &fakeRunner{block: true, events: []string{
		`{"type":"RUN_STARTED","threadId":"t-stop","runId":"r1"}`,
		`{"type":"TOOL_CALL_START","toolCallId":"tc1","toolCallName":"generateImage"}`,
	}}
	srv := newServer(t, runner)
	input := `{"threadId":"t-stop","runId":"r1","messages":[],"tools":[],"context":[]}`

	done := make(chan []string)
	go func() {
		resp, body := post(t, srv.URL+"/copilot/agent", `{"method":"agent/run","params":{"agentId":"social"},"body":`+input+`}`)
		done <- sse(t, resp, body)
	}()
	for deadline := time.Now().Add(5 * time.Second); ; {
		threads.Lock()
		running := threads.m["t-stop"] != nil && threads.m["t-stop"].running
		threads.Unlock()
		if running {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("run never started")
		}
		time.Sleep(10 * time.Millisecond)
	}

	// A second run on a running thread opens and closes an empty stream.
	resp, body := post(t, srv.URL+"/copilot/agent", `{"method":"agent/run","params":{"agentId":"social"},"body":`+input+`}`)
	if resp.StatusCode != 200 || body != "" {
		t.Fatalf("concurrent run: %d %q", resp.StatusCode, body)
	}

	resp, body = post(t, srv.URL+"/copilot/agent", `{"method":"agent/stop","params":{"agentId":"social","threadId":"t-stop"}}`)
	if body != `{"stopped":true,"interrupt":{"type":"RUN_ERROR","message":"Run stopped by user","code":"STOPPED"}}` {
		t.Fatalf("stop: %s", body)
	}
	equalEvents(t, (<-done)[1:], []string{
		`{"type":"TOOL_CALL_START","toolCallId":"tc1","toolCallName":"generateImage"}`,
		`{"type":"TOOL_CALL_END","toolCallId":"tc1"}`,
		`{"type":"TOOL_CALL_RESULT","toolCallId":"tc1","messageId":"tc1-result","role":"tool","content":"{\"status\":\"stopped\",\"reason\":\"stop_requested\",\"message\":\"Run stopped by user\"}"}`,
		`{"type":"RUN_FINISHED"}`,
	})
}
