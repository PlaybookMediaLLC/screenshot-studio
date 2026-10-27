package chat

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
)

// Annotations are a tool's MCP annotations (mcp.annotations).
type Annotations struct {
	Title           string `json:"title,omitempty"`
	ReadOnlyHint    bool   `json:"readOnlyHint"`
	DestructiveHint bool   `json:"destructiveHint"`
	IdempotentHint  bool   `json:"idempotentHint"`
	OpenWorldHint   bool   `json:"openWorldHint"`
}

// Tool is a Mastra createTool: Name is the key the agent and the MCP server
// expose it under (AgentToolInterface.name), ID the createTool id.
type Tool struct {
	Name         string
	ID           string
	Description  string
	InputSchema  *Schema
	OutputSchema *Schema
	Annotations  *Annotations
	// Meta is mcp._meta (MCP Apps widget links and visibility).
	Meta map[string]any
	// MCPOnly tools need an MCP host (ui:// widgets); the in-app agent skips them.
	MCPOnly bool
	// Available reports whether the feature behind the tool is configured;
	// nil means always.
	Available func() bool
	// refine adds the zod .refine() checks the JSON schema can't express.
	refine  func(input any) []Issue
	Execute func(ctx context.Context, input json.RawMessage) (any, error)
}

// Issue is one zod validation issue.
type Issue struct {
	Path    string
	Message string
}

// ValidationError is Mastra's { error: true, message } answer to input that
// fails the tool's schema; the model (or MCP client) sees it and can retry.
type ValidationError struct {
	Error   bool   `json:"error"`
	Message string `json:"message"`
}

// Call validates the input like Mastra's validateToolInput and executes.
func (t *Tool) Call(ctx context.Context, input json.RawMessage) (any, error) {
	if len(input) == 0 || string(input) == "null" {
		input = json.RawMessage("{}")
	}
	var value any
	if err := json.Unmarshal(input, &value); err != nil {
		return nil, fmt.Errorf("invalid tool arguments: %w", err)
	}
	if issues := t.Issues(value); len(issues) > 0 {
		lines := make([]string, len(issues))
		for i, issue := range issues {
			path := issue.Path
			if path == "" {
				path = "root"
			}
			lines[i] = fmt.Sprintf("- %s: %s", path, issue.Message)
		}
		return &ValidationError{Error: true, Message: fmt.Sprintf(
			"Tool input validation failed for %s. Please fix the following errors and try again:\n%s\n\nProvided arguments: %s",
			t.ID, strings.Join(lines, "\n"), string(input))}, nil
	}
	return t.Execute(ctx, input)
}

// Issues returns the zod issues of a decoded input (schema and refinements).
func (t *Tool) Issues(value any) []Issue {
	issues := t.InputSchema.Check(value, "")
	if t.refine != nil {
		issues = append(issues, t.refine(value)...)
	}
	return issues
}
