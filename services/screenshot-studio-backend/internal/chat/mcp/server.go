package mcp

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"

	"github.com/google/uuid"
	sdk "github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/chat"
)

func newSessionID() string { return uuid.NewString() }

func ptr[T any](v T) *T { return &v }

const resourceURIMetaKey = "ui/resourceUri"

// toolSpec is the tools/list entry Mastra's MCPServer advertises.
func toolSpec(t *chat.Tool) *sdk.Tool {
	spec := &sdk.Tool{Name: t.Name, Description: t.Description, InputSchema: t.InputSchema.JSON()}
	if t.OutputSchema != nil {
		spec.OutputSchema = t.OutputSchema.JSON()
	}
	if a := t.Annotations; a != nil {
		spec.Annotations = &sdk.ToolAnnotations{
			Title:           a.Title,
			ReadOnlyHint:    a.ReadOnlyHint,
			DestructiveHint: ptr(a.DestructiveHint),
			IdempotentHint:  a.IdempotentHint,
			OpenWorldHint:   ptr(a.OpenWorldHint),
		}
	}
	if len(t.Meta) > 0 {
		meta := sdk.Meta{}
		for k, v := range t.Meta {
			meta[k] = v
		}
		// older hosts read the legacy flat key
		if ui, ok := t.Meta["ui"].(map[string]any); ok {
			if uri, ok := ui["resourceUri"].(string); ok {
				meta[resourceURIMetaKey] = uri
			}
		}
		spec.Meta = meta
	}
	return spec
}

func textResult(text string, isError bool) *sdk.CallToolResult {
	return &sdk.CallToolResult{Content: []sdk.Content{&sdk.TextContent{Text: text}}, IsError: isError}
}

// callTool is MCPServer's tools/call handler for one tool.
func callTool(ctx context.Context, tool *chat.Tool, arguments json.RawMessage) *sdk.CallToolResult {
	if len(arguments) == 0 || string(arguments) == "null" {
		arguments = json.RawMessage("{}")
	}
	var value any
	_ = json.Unmarshal(arguments, &value)
	if issues := tool.Issues(value); len(issues) > 0 {
		lines := make([]string, len(issues))
		for i, issue := range issues {
			path := issue.Path
			if path == "" {
				path = "root"
			}
			lines[i] = fmt.Sprintf("- %s: %s", path, issue.Message)
		}
		pretty, _ := json.MarshalIndent(value, "", "  ")
		// isError so the LLM sees the error and can self-correct
		return textResult(fmt.Sprintf("Tool validation failed. Please fix the following errors and try again:\n%s\n\nProvided arguments: %s", strings.Join(lines, "\n"), pretty), true)
	}

	result, err := tool.Call(ctx, arguments)
	if err != nil {
		slog.Error("Tool execution failed", "tool", tool.Name, "error", err)
		return textResult("Error: "+err.Error(), true)
	}
	if v, ok := result.(*chat.ValidationError); ok {
		return textResult(v.Message, true)
	}
	data, _ := json.Marshal(result)
	if tool.OutputSchema != nil {
		var structured any
		_ = json.Unmarshal(data, &structured)
		if structured == nil {
			structured = map[string]any{}
		}
		return &sdk.CallToolResult{Content: []sdk.Content{&sdk.TextContent{Text: string(data)}}, StructuredContent: structured}
	}
	if text, ok := result.(string); ok {
		return textResult(text, false)
	}
	return textResult(string(data), false)
}

// build creates the MCPServer for one connection; every handler runs with
// the connection's organization (or relay) attached, as runWithContext does.
func (s *Server) build(def *serverDef, requestID string, auth *ent.Organization, relay *chat.SelfHostedInstance) *sdk.Server {
	caps := &sdk.ServerCapabilities{Tools: &sdk.ToolCapabilities{ListChanged: true}, Logging: &sdk.LoggingCapabilities{}}
	hasUI := len(def.resources) > 0
	for _, t := range def.tools {
		if ui, ok := t.Meta["ui"].(map[string]any); ok && ui["resourceUri"] != nil {
			hasUI = true
		}
	}
	if len(def.resources) > 0 {
		caps.Resources = &sdk.ResourceCapabilities{Subscribe: true, ListChanged: true}
	}
	if hasUI {
		caps.Extensions = map[string]any{"io.modelcontextprotocol/ui": map[string]any{}}
	}
	server := sdk.NewServer(&sdk.Implementation{Name: "Postiz MCP", Version: "1.0.0"}, &sdk.ServerOptions{
		Capabilities:       caps,
		SubscribeHandler:   func(context.Context, *sdk.SubscribeRequest) error { return nil },
		UnsubscribeHandler: func(context.Context, *sdk.UnsubscribeRequest) error { return nil },
	})
	attach := func(ctx context.Context) context.Context { return chat.RunWithContext(ctx, requestID, auth, relay) }

	for _, t := range def.tools {
		tool := t
		server.AddTool(toolSpec(tool), func(ctx context.Context, req *sdk.CallToolRequest) (*sdk.CallToolResult, error) {
			return callTool(attach(ctx), tool, req.Params.Arguments), nil
		})
	}
	if def.agent != nil {
		agent := def.agent
		server.AddTool(&sdk.Tool{
			Name:        "ask_" + chat.AgentName,
			Description: fmt.Sprintf("Ask agent '%s' a question. Agent description: %s", chat.AgentName, chat.AgentDescription),
			InputSchema: json.RawMessage(`{"type":"object","properties":{"message":{"type":"string","description":"The question or input for the agent."}},"required":["message"],"additionalProperties":false}`),
		}, func(ctx context.Context, req *sdk.CallToolRequest) (*sdk.CallToolResult, error) {
			var in struct {
				Message *string `json:"message"`
			}
			if json.Unmarshal(req.Params.Arguments, &in) != nil || in.Message == nil {
				pretty, _ := json.MarshalIndent(json.RawMessage(req.Params.Arguments), "", "  ")
				return textResult("Tool validation failed. Please fix the following errors and try again:\n- message: Required\n\nProvided arguments: "+string(pretty), true), nil
			}
			out, err := agent.Generate(attach(ctx), *in.Message)
			if err != nil {
				return textResult("Error: "+err.Error(), true), nil
			}
			data, _ := json.Marshal(out)
			return textResult(string(data), false), nil
		})
	}
	for _, r := range def.resources {
		resource := r
		meta := sdk.Meta{"ui": resource.meta}
		server.AddResource(&sdk.Resource{URI: resource.uri, Name: resource.name, Description: resource.description, MIMEType: resourceMIMEType, Meta: meta},
			func(ctx context.Context, req *sdk.ReadResourceRequest) (*sdk.ReadResourceResult, error) {
				// MCP Apps hosts read the UI CSP from contents[]._meta.ui.csp
				return &sdk.ReadResourceResult{Contents: []*sdk.ResourceContents{{URI: resource.uri, MIMEType: resourceMIMEType, Meta: meta, Text: resource.html}}}, nil
			})
	}
	return server
}
