package content

import (
	"fmt"
	"log/slog"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/auth"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/copilot"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/database/subscriptions"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/httpx"
)

type copilotController struct {
	subscriptions *subscriptions.Service
	memory        AgentMemory
}

type threadSummary struct {
	ID    string `json:"id"`
	Title string `json:"title"`
}

// RegisterCopilotController registers CopilotController (/copilot) behind the
// auth middleware. runner is the Mastra 'postiz' agent behind /copilot/agent.
func RegisterCopilotController(r *httpx.Router, authMiddleware httpx.Middleware, perms *auth.PermissionsService,
	subscriptionService *subscriptions.Service, runner copilot.AgentRunner, memory AgentMemory) {
	h := &copilotController{subscriptions: subscriptionService, memory: memory}
	rt := copilot.New(runner)
	ai := perms.CheckPolicies(auth.Policy(auth.ActionCreate, auth.SectionAI))

	g := r.Group("/copilot", authMiddleware)
	g.Post("/chat", rt.Chat, httpx.Raw())
	g.Post("/agent", rt.Agent, ai, httpx.Raw())
	g.Get("/credits", h.calculateCredits)
	g.Get("/:thread/list", h.getMessagesList, ai)
	g.Get("/list", h.getList, ai)
}

func (h *copilotController) calculateCredits(c *httpx.Ctx) (any, error) {
	typ := c.Query("type")
	if typ == "" {
		typ = "ai_images"
	}
	return nullable(h.subscriptions.CheckCredits(c.R.Context(), c.Org, typ))
}

func (h *copilotController) getMessagesList(c *httpx.Ctx) (any, error) {
	threadID := c.Param("thread")
	messages, err := h.memory.Recall(c.R.Context(), c.Org.ID, threadID)
	if err != nil {
		slog.Warn(fmt.Sprintf("Could not recall messages for thread %s: %v", threadID, err))
		return map[string]any{"messages": []any{}}, nil
	}
	return messages, nil
}

func (h *copilotController) getList(c *httpx.Ctx) (any, error) {
	list, err := h.memory.ListThreads(c.R.Context(), c.Org.ID)
	if err != nil {
		return nil, err
	}
	threads := make([]threadSummary, 0, len(list))
	for _, p := range list {
		threads = append(threads, threadSummary{ID: p.ID, Title: p.Title})
	}
	return map[string]any{"threads": threads}, nil
}
