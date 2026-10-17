// Package platformai calls the platform's language models from Go. It uses
// OpenRouter, as the web does (lib/ai/models), with the same role catalog and
// overrides, and asks for JSON that matches a schema. Usage accounting
// returns each call's cost, which the caller charges to AI credits.
package platformai

import (
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
)

// Role names the kind of work a call does; lib/ai/models/catalog.ts maps the
// same roles to the same models.
type Role string

const (
	RoleFast     Role = "fast"
	RoleDrafting Role = "drafting"
	RoleDeep     Role = "deep"
	RoleNano     Role = "nano"
)

var defaultModels = map[Role]string{
	RoleDeep: "anthropic/claude-opus-5.5", RoleDrafting: "anthropic/claude-sonnet-5.5",
	RoleFast: "anthropic/claude-haiku-4.5", RoleNano: "anthropic/claude-haiku-4.5",
}

var modelEnv = map[Role]string{
	RoleFast: "PLATFORM_AI_MODEL_FAST", RoleDeep: "PLATFORM_AI_MODEL_DEEP",
	RoleNano: "PLATFORM_AI_MODEL_NANO", RoleDrafting: "PLATFORM_AI_MODEL_DRAFTING",
}

const defaultBaseURL = "https://openrouter.ai/api/v1"

// Client calls OpenRouter's chat completions API.
type Client struct {
	APIKey  string
	BaseURL string
	HTTP    *http.Client
	Models  map[Role]string
}

// FromEnvironment reads OPENROUTER_API_KEY and the PLATFORM_AI_MODEL_*
// overrides. OPENROUTER_BASE_URL points calls at a fake provider in tests
// and is ignored when NODE_ENV=production (docs/rfcs/036). It returns nil
// without a key, so callers degrade instead of calling a model.
func FromEnvironment() *Client {
	key := strings.TrimSpace(os.Getenv("OPENROUTER_API_KEY"))
	if key == "" {
		return nil
	}
	base := defaultBaseURL
	if override := strings.TrimRight(strings.TrimSpace(os.Getenv("OPENROUTER_BASE_URL")), "/"); override != "" && os.Getenv("NODE_ENV") != "production" {
		base = override
	}
	models := map[Role]string{}
	for role, model := range defaultModels {
		models[role] = model
		if override := strings.TrimSpace(os.Getenv(modelEnv[role])); override != "" {
			models[role] = override
		}
	}
	return &Client{APIKey: key, BaseURL: base, HTTP: &http.Client{Timeout: 2 * time.Minute}, Models: models}
}

// Request is one schema-constrained call. Prompt holds the user turn; untrusted
// content belongs there, fenced, never in System.
type Request struct {
	MaxTokens  int
	Prompt     string
	Role       Role
	Schema     json.RawMessage
	SchemaName string
	System     string
}

// Usage is what one call consumed.
type Usage struct {
	CostUSD      float64 `json:"costUsd"`
	InputTokens  int     `json:"inputTokens"`
	OutputTokens int     `json:"outputTokens"`
}

// Tokens is the call's total token count, which run budgets are kept in.
func (u Usage) Tokens() int { return u.InputTokens + u.OutputTokens }

// Error is a provider failure. Retryable is true for rate limits, server
// errors, and network failures; false for a request the provider refused.
type Error struct {
	Retryable bool
	Status    int
	message   string
}

func (e *Error) Error() string { return e.message }

// ErrSchema reports a reply that was not JSON matching the schema.
var ErrSchema = errors.New("the model reply did not match the schema")

// Structured sends the request and decodes the reply into out.
func (c *Client) Structured(ctx context.Context, request Request, out any) (Usage, error) {
	model := c.Models[request.Role]
	if model == "" {
		model = defaultModels[RoleFast]
	}
	maxTokens := request.MaxTokens
	if maxTokens <= 0 {
		maxTokens = 4_000
	}
	body, err := json.Marshal(map[string]any{
		"max_tokens": maxTokens,
		"messages": []map[string]string{
			{"content": request.System, "role": "system"},
			{"content": request.Prompt, "role": "user"},
		},
		"model": model,
		"response_format": map[string]any{"type": "json_schema", "json_schema": map[string]any{
			"name": request.SchemaName, "schema": request.Schema, "strict": true}},
		"temperature": 0,
		"usage":       map[string]bool{"include": true},
	})
	if err != nil {
		return Usage{}, err
	}
	httpRequest, err := http.NewRequestWithContext(ctx, http.MethodPost, c.BaseURL+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return Usage{}, err
	}
	httpRequest.Header.Set("Authorization", "Bearer "+c.APIKey)
	httpRequest.Header.Set("Content-Type", "application/json")
	response, err := c.HTTP.Do(httpRequest)
	if err != nil {
		return Usage{}, &Error{Retryable: true, message: "the model provider is unreachable"}
	}
	defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, 4<<20))
	if err != nil {
		return Usage{}, &Error{Retryable: true, message: "the model reply was cut off"}
	}
	if response.StatusCode != http.StatusOK {
		retryable := response.StatusCode == http.StatusTooManyRequests || response.StatusCode >= 500
		return Usage{}, &Error{Retryable: retryable, Status: response.StatusCode, message: fmt.Sprintf("the model provider returned %d", response.StatusCode)}
	}
	var reply struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
		Usage struct {
			CompletionTokens int     `json:"completion_tokens"`
			Cost             float64 `json:"cost"`
			PromptTokens     int     `json:"prompt_tokens"`
		} `json:"usage"`
	}
	if err := json.Unmarshal(data, &reply); err != nil || len(reply.Choices) == 0 {
		return Usage{}, ErrSchema
	}
	usage := Usage{CostUSD: reply.Usage.Cost, InputTokens: reply.Usage.PromptTokens, OutputTokens: reply.Usage.CompletionTokens}
	content := strings.TrimSpace(reply.Choices[0].Message.Content)
	content = strings.TrimSuffix(strings.TrimPrefix(strings.TrimPrefix(content, "```json"), "```"), "```")
	if err := json.Unmarshal([]byte(strings.TrimSpace(content)), out); err != nil {
		return usage, ErrSchema
	}
	return usage, nil
}

// Credits converts a call's cost to AI credits, rounded up: one credit is
// $0.01 at list price (docs/rfcs/035-pricing-and-unit-economics.md).
func Credits(costUSD float64) int {
	if costUSD <= 0 {
		return 0
	}
	cents := costUSD * 100
	credits := int(cents)
	if float64(credits) < cents {
		credits++
	}
	return credits
}
