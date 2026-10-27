package chat

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/chat/llm"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/copilot"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/database/dbtest"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent"
)

var update = flag.Bool("update", false, "rewrite golden files")

type fakeIntegrations struct{ IntegrationService }

func (fakeIntegrations) Customers(context.Context, string) ([]*ent.Customer, error) {
	return []*ent.Customer{{ID: "c1", Name: "Acme"}}, nil
}

// The tool names, ids, descriptions and schemas are the contract with the
// model and with MCP clients: any change must be deliberate.
func TestToolSchemasSnapshot(t *testing.T) {
	tools := NewTools(Services{})
	type snap struct {
		Name         string          `json:"name"`
		ID           string          `json:"id"`
		MCPOnly      bool            `json:"mcpOnly"`
		Description  string          `json:"description"`
		InputSchema  json.RawMessage `json:"inputSchema"`
		OutputSchema json.RawMessage `json:"outputSchema,omitempty"`
		Annotations  *Annotations    `json:"annotations"`
		Meta         map[string]any  `json:"meta,omitempty"`
	}
	var all []snap
	for _, tool := range tools {
		s := snap{Name: tool.Name, ID: tool.ID, MCPOnly: tool.MCPOnly, Description: tool.Description, InputSchema: tool.InputSchema.JSON(), Annotations: tool.Annotations, Meta: tool.Meta}
		if tool.OutputSchema != nil {
			s.OutputSchema = tool.OutputSchema.JSON()
		}
		all = append(all, s)
	}
	got, _ := json.MarshalIndent(all, "", "  ")
	golden := "testdata/tools.golden.json"
	if *update {
		_ = os.MkdirAll("testdata", 0o755)
		if err := os.WriteFile(golden, got, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	want, err := os.ReadFile(golden)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != string(want) {
		t.Errorf("tool schemas changed, run go test -update and review testdata/tools.golden.json")
	}

	if len(tools) != 20 {
		t.Fatalf("toolList has %d tools", len(tools))
	}
	if n := len(LoadTools(tools, true)); n != 3 {
		t.Errorf("mcpOnly tools: %d", n)
	}
	core := CoreToolNames(tools)
	for _, name := range []string{"integrationList", "integrationSchedulePostTool", "postsListTool"} {
		if !strings.Contains(strings.Join(core, ","), name) {
			t.Errorf("core tools miss %s", name)
		}
	}
}

func TestSchemaValidation(t *testing.T) {
	tool := integrationSchedulePostTool(Services{})
	var value any
	_ = json.Unmarshal([]byte(`{"socialPost":[{"integrationId":"i","isPremium":false,"date":"d","shortLink":false,"type":"later","postsAndComments":[{"content":"x","attachments":["https://a.b/c.txt"]}],"settings":[{"key":"a"}]}]}`), &value)
	issues := tool.Issues(value)
	want := []string{
		"socialPost.0.type: Invalid enum value. Expected 'draft' | 'schedule' | 'now', received 'later'",
		"socialPost.0.postsAndComments.0.attachments.0: File must have a valid extension: .png, .jpg, .jpeg, .gif, .webp, or .mp4",
	}
	var got []string
	for _, i := range issues {
		got = append(got, i.Path+": "+i.Message)
	}
	if strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Errorf("issues:\n%s", strings.Join(got, "\n"))
	}
	if issues := tool.Issues(map[string]any{}); len(issues) != 1 || issues[0].Message != "Required" {
		t.Errorf("missing socialPost: %v", issues)
	}
}

// fakeOpenAI answers chat completions from a script: streamed requests take
// the next scripted step, non-streamed ones (the title) a fixed title.
type fakeOpenAI struct {
	mu       sync.Mutex
	steps    []string // SSE bodies
	requests []map[string]any
}

func (f *fakeOpenAI) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)
	var req map[string]any
	_ = json.Unmarshal(body, &req)
	f.mu.Lock()
	f.requests = append(f.requests, req)
	step := ""
	if req["stream"] == true && len(f.steps) > 0 {
		step, f.steps = f.steps[0], f.steps[1:]
	}
	f.mu.Unlock()
	if req["stream"] != true {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"choices":[{"message":{"role":"assistant","content":"<think>x</think> Groups overview"}}]}`)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	fmt.Fprint(w, step)
}

func sse(chunks ...string) string {
	var b strings.Builder
	for _, c := range chunks {
		b.WriteString("data: " + c + "\n\n")
	}
	b.WriteString("data: [DONE]\n\n")
	return b.String()
}

func TestAgentRunEmitsAGUIEventsAndStoresMemory(t *testing.T) {
	client := dbtest.Open(t)
	ctx := context.Background()
	fake := &fakeOpenAI{steps: []string{
		sse(`{"choices":[{"delta":{"content":"Let me check."}}]}`,
			`{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"groupList","arguments":""}}]}}]}`,
			`{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{}"}}]}}]}`),
		sse(`{"choices":[{"delta":{"content":"You have "}}]}`, `{"choices":[{"delta":{"content":"one group: Acme."}}]}`),
	}}
	server := httptest.NewServer(fake)
	defer server.Close()
	llm.BaseURL = server.URL

	agent := NewAgent(NewTools(Services{Integrations: fakeIntegrations{}}), NewMemory(client))
	agent.now = func() time.Time { return time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC) }
	org := &ent.Organization{ID: "org1", Name: "Acme"}
	events, err := agent.Run(ctx, copilot.RunAgentInput{
		ThreadID: "thread1", RunID: "run1", Organization: org,
		Messages: []copilot.Message{{ID: "m1", Role: "user", Content: json.RawMessage(`"Which groups do I have?"`)}},
	})
	if err != nil {
		t.Fatal(err)
	}
	var types []string
	var all []map[string]any
	for raw := range events {
		var e map[string]any
		_ = json.Unmarshal(raw, &e)
		types = append(types, e["type"].(string))
		all = append(all, e)
	}
	want := "RUN_STARTED,TEXT_MESSAGE_CHUNK,TOOL_CALL_START,TOOL_CALL_ARGS,TOOL_CALL_END,TOOL_CALL_RESULT,TEXT_MESSAGE_CHUNK,TEXT_MESSAGE_CHUNK,RUN_FINISHED"
	if strings.Join(types, ",") != want {
		t.Fatalf("events:\n%s\nwant\n%s\n%v", strings.Join(types, ","), want, all)
	}
	base := all[1]["messageId"].(string)
	if all[2]["parentMessageId"] != base || all[2]["toolCallName"] != "groupList" {
		t.Errorf("tool call start: %v", all[2])
	}
	if all[5]["content"] != `{"output":[{"id":"c1","name":"Acme"}]}` {
		t.Errorf("tool result: %v", all[5])
	}
	// text after a tool call goes to a continuation message
	if all[6]["messageId"] != base+"-agui-text" {
		t.Errorf("continuation id: %v", all[6]["messageId"])
	}

	// the second model call saw the tool result and the instructions
	second := fake.requests[1]
	msgs := second["messages"].([]any)
	if !strings.Contains(msgs[0].(map[string]any)["content"].(string), "Date (UTC): 2026-01-02 03:04:05") {
		t.Errorf("instructions: %v", msgs[0])
	}
	last := msgs[len(msgs)-1].(map[string]any)
	if last["role"] != "tool" || last["tool_call_id"] != "call_1" {
		t.Errorf("last message: %v", last)
	}

	recall, err := agent.Recall(ctx, "org1", "thread1")
	if err != nil {
		t.Fatal(err)
	}
	if len(recall.Messages) != 2 || recall.Messages[0].Role != "user" || recall.Messages[1].ID != base {
		t.Fatalf("recall: %+v", recall)
	}
	content := parseContent(recall.Messages[1].Content)
	if len(content.Parts) != 5 || content.Parts[2].ToolInvocation == nil || content.Parts[4].Text != "You have one group: Acme." {
		t.Errorf("stored assistant: %s", recall.Messages[1].Content)
	}
	data, _ := json.Marshal(recall)
	if !strings.Contains(string(data), `"content":{"format":2,"parts":[{"type":"text","text":"Which groups do I have?"}],"content":"Which groups do I have?"}`) {
		t.Errorf("recall json: %s", data)
	}
	threads, err := agent.ListThreads(ctx, "org1")
	if err != nil {
		t.Fatal(err)
	}
	if len(threads.Threads) != 1 || threads.Threads[0].Title != "Groups overview" {
		t.Errorf("threads: %+v", threads)
	}
	if _, err := agent.Recall(ctx, "other", "thread1"); err == nil {
		t.Error("recall of another resource must fail")
	}

	// a second turn re-sends the history: only the new message is stored
	fake.steps = []string{sse(`{"choices":[{"delta":{"content":"Bye"}}]}`)}
	events, _ = agent.Run(ctx, copilot.RunAgentInput{
		ThreadID: "thread1", RunID: "run2", Organization: org,
		Messages: []copilot.Message{
			{ID: "m1", Role: "user", Content: json.RawMessage(`"Which groups do I have?"`)},
			{ID: base + "-agui-text", Role: "assistant", Content: json.RawMessage(`"You have one group: Acme."`)},
			{ID: "m2", Role: "user", Content: json.RawMessage(`[{"type":"text","text":"thanks"}]`)},
		},
	})
	for range events {
	}
	recall, _ = agent.Recall(ctx, "org1", "thread1")
	if len(recall.Messages) != 4 {
		t.Fatalf("second turn stored %d messages", len(recall.Messages))
	}
}

func TestWorkingMemoryTool(t *testing.T) {
	client := dbtest.Open(t)
	memory := NewMemory(client)
	ctx := context.WithValue(context.Background(), runInfoKey{}, &runInfo{threadID: "t", resourceID: "r"})
	tool := updateWorkingMemoryTool(memory)
	if _, err := tool.Execute(ctx, json.RawMessage(`{"memory":{"proverbs":["a"],"x":1}}`)); err != nil {
		t.Fatal(err)
	}
	if _, err := tool.Execute(ctx, json.RawMessage(`{"memory":"{\"x\":null}"}`)); err != nil {
		t.Fatal(err)
	}
	got, _ := memory.GetWorkingMemory(ctx, "r")
	if got != `{"proverbs":["a"]}` {
		t.Errorf("working memory: %s", got)
	}
}
