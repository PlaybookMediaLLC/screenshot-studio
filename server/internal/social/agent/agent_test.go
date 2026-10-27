package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/chat/llm"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/dtos/generator"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/httpx"
)

func TestFromTemplate(t *testing.T) {
	got := fromTemplate("a {text} b {list} {missing}", map[string]any{"text": "x {list}", "list": []string{"y"}})
	if got != `a x {list} b ["y"] {missing}` {
		t.Errorf("got %q", got)
	}
}

func TestGenerationError(t *testing.T) {
	err := generationError(fmt.Errorf("400 Your request was rejected by the safety system, safety_violations=[sexual]"))
	if e, ok := err.(*httpx.Error); !ok || e.Status != 422 || !strings.Contains(fmt.Sprint(e.Body), "Flagged categories: sexual.") {
		t.Errorf("safety: %v", err)
	}
	if e := generationError(fmt.Errorf("400 bad param")).(*httpx.Error); e.Status != 500 {
		t.Errorf("generic: %v", e)
	}
}

type fakePosts struct{ saved []PopularPost }

func (f *fakePosts) FindAllExistingCategories(context.Context) ([]*ent.PopularPosts, error) {
	return []*ent.PopularPosts{{Category: "Tips"}, {Category: "News"}}, nil
}
func (f *fakePosts) FindAllExistingTopicsOfCategory(context.Context, string) ([]*ent.PopularPosts, error) {
	return nil, nil
}
func (f *fakePosts) FindPopularPosts(_ context.Context, category, topic string) ([]*ent.PopularPosts, error) {
	return []*ent.PopularPosts{{Hook: "Old hook", Content: "c"}}, nil
}
func (f *fakePosts) FindFreeDateTime(context.Context, string) (string, error) {
	return "2026-01-02T10:00:00", nil
}
func (f *fakePosts) CreatePopularPosts(_ context.Context, p PopularPost) (*ent.PopularPosts, error) {
	f.saved = append(f.saved, p)
	return &ent.PopularPosts{}, nil
}

func fakeOpenAI(t *testing.T, answer func(prompt string, schema string) string) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		var req struct {
			Messages []struct {
				Content string `json:"content"`
			} `json:"messages"`
			ResponseFormat json.RawMessage `json:"response_format"`
		}
		_ = json.Unmarshal(body, &req)
		content, _ := json.Marshal(answer(req.Messages[0].Content, string(req.ResponseFormat)))
		fmt.Fprintf(w, `{"choices":[{"message":{"role":"assistant","content":%s}}]}`, content)
	}))
	t.Cleanup(server.Close)
	old := llm.BaseURL
	llm.BaseURL = server.URL
	t.Cleanup(func() { llm.BaseURL = old })
}

func TestGraphStreamsNodesAndFinalState(t *testing.T) {
	t.Setenv("TAVILY_API_KEY", "")
	fakeOpenAI(t, func(prompt, schema string) string {
		switch {
		case strings.Contains(schema, `"category"`):
			return `{"category":"Tips"}`
		case strings.Contains(schema, `"hook"`):
			if !strings.Contains(prompt, "Old hook") || !strings.Contains(prompt, "add \"\n\" between") {
				t.Errorf("hook prompt: %s", prompt)
			}
			return `{"hook":"Big hook"}`
		case strings.Contains(schema, `"content"`):
			return `{"content":{"content":"Body","website":null}}`
		}
		return "research"
	})
	g := NewGraphService(&fakePosts{}, nil, nil)
	var names []string
	var last Event
	err := g.Start(context.Background(), "org1", &generator.GeneratorDto{Research: "write about go", Format: "one_short", Tone: "personal"}, func(e Event) error {
		if e.Event == "on_chain_start" {
			names = append(names, e.Name)
		}
		last = e
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(names, ",") != "LangGraph,agent,research,save-research,find-category,find-topic,find-popular-posts,generate-hook,generate-content,generate-content-fix,post-time" {
		t.Errorf("nodes: %v", names)
	}
	out, _ := json.Marshal(last.Data["output"])
	for _, want := range []string{`"hook":"Big hook"`, `"content":[{"content":"Body"}]`, `"date":"2026-01-02T10:00:00"`, `"category":"Tips"`} {
		if !strings.Contains(string(out), want) {
			t.Errorf("final state misses %s: %s", want, out)
		}
	}
}

func TestInsertService(t *testing.T) {
	fakeOpenAI(t, func(prompt, schema string) string {
		switch {
		case strings.Contains(schema, `"category"`):
			return `{"category":"Tips"}`
		case strings.Contains(schema, `"topic"`):
			return `{"topic":"AI"}`
		}
		return `{"hook":"First line"}`
	})
	posts := &fakePosts{}
	if err := NewInsertService(posts).NewPost(context.Background(), "First line. More."); err != nil {
		t.Fatal(err)
	}
	if len(posts.saved) != 1 || posts.saved[0] != (PopularPost{Category: "Tips", Topic: "AI", Content: "First line. More.", Hook: "First line"}) {
		t.Errorf("saved: %+v", posts.saved)
	}
}
