package agent

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/chat/llm"
)

// The classifier's model: ChatOpenAI gpt-4o-2024-08-06 at 0.
const (
	insertModel       = "gpt-4o-2024-08-06"
	insertTemperature = 0
)

var (
	insertCategorySchema = strictObject(`"category":{"type":"string","description":"The category for the post"}`, "category")
	insertTopicSchema    = strictObject(`"topic":{"type":"string","description":"The topic of the post"}`, "topic")
	insertHookSchema     = strictObject(`"hook":{"type":"string","description":"The hook of the post"}`, "hook")
)

// InsertService is AgentGraphInsertService: it classifies a popular post
// (category, topic, hook) and saves it.
type InsertService struct {
	posts PostsService
}

func NewInsertService(posts PostsService) *InsertService { return &InsertService{posts: posts} }

func classify(ctx context.Context, prompt string, schema json.RawMessage, out any) error {
	return llm.Structured(ctx, insertModel, insertTemperature, prompt, schema, out)
}

// NewPost runs find-category -> find-topic -> find-hook -> save-post.
func (s *InsertService) NewPost(ctx context.Context, post string) error {
	var category struct {
		Category string `json:"category"`
	}
	if err := classify(ctx, fromTemplate("\nYou are an assistant that get a social media post and categorize it into to one from the following categories:\n{categories}\nHere is the post:\n{post}\n    ",
		map[string]any{"post": post, "categories": strings.Join(agentCategories, ", ")}), insertCategorySchema, &category); err != nil {
		return err
	}
	var topic struct {
		Topic string `json:"topic"`
	}
	if err := classify(ctx, fromTemplate("\nYou are an assistant that get a social media post and categorize it into one of the following topics:\n{topics}\nHere is the post:\n{post}\n    ",
		map[string]any{"post": post, "topics": strings.Join(agentTopics, ", ")}), insertTopicSchema, &topic); err != nil {
		return err
	}
	var hook struct {
		Hook string `json:"hook"`
	}
	if err := classify(ctx, fromTemplate("\nYou are an assistant that get a social media post and extract the hook, the hook is usually the first or second of both sentence of the post, but can be in a different place, make sure you don't change the wording of the post use the exact text:\n{post}\n    ",
		map[string]any{"post": post}), insertHookSchema, &hook); err != nil {
		return err
	}
	_, err := s.posts.CreatePopularPosts(ctx, PopularPost{Category: category.Category, Topic: topic.Topic, Hook: hook.Hook, Content: post})
	return err
}
