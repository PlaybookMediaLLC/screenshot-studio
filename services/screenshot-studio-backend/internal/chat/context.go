package chat

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/ent"
)

// RequestContext is the Mastra RequestContext the copilot controller fills
// (ChannelsContext): the integrations the user picked, the organization and
// whether a UI renders the answer.
type RequestContext struct {
	Integrations json.RawMessage
	Organization *ent.Organization
	// UI is the 'ui' value: "true" in the app, "false" on MCP, "" when unset.
	UI string
}

// SelfHostedInstance is a self-hosted Postiz an MCP connection is relayed to.
type SelfHostedInstance struct {
	ID     string `json:"id,omitempty"`
	MCPURL string `json:"mcpUrl"`
	APIKey string `json:"apiKey"`
}

// callContext is async.storage's Ctx: who calls the tools.
type callContext struct {
	requestID string
	// auth is the organization of an MCP connection (getAuth()).
	auth *ent.Organization
	// relay is set on a self-hosted connection: tool calls run there.
	relay *SelfHostedInstance
	rc    *RequestContext
}

type ctxKey struct{}

// RunWithContext is runWithContext: the MCP server attaches the connection's
// organization (or relay) to every tool call made under ctx.
func RunWithContext(ctx context.Context, requestID string, auth *ent.Organization, relay *SelfHostedInstance) context.Context {
	return context.WithValue(ctx, ctxKey{}, &callContext{requestID: requestID, auth: auth, relay: relay})
}

// WithRequestContext attaches the agent's request context.
func WithRequestContext(ctx context.Context, rc *RequestContext) context.Context {
	current := getContext(ctx)
	next := &callContext{rc: rc}
	if current != nil {
		next.requestID, next.auth, next.relay = current.requestID, current.auth, current.relay
	}
	return context.WithValue(ctx, ctxKey{}, next)
}

func getContext(ctx context.Context) *callContext {
	c, _ := ctx.Value(ctxKey{}).(*callContext)
	return c
}

// GetAuth is getAuth().
func GetAuth(ctx context.Context) *ent.Organization {
	if c := getContext(ctx); c != nil {
		return c.auth
	}
	return nil
}

// GetRelay is getRelay().
func GetRelay(ctx context.Context) *SelfHostedInstance {
	if c := getContext(ctx); c != nil {
		return c.relay
	}
	return nil
}

// GetRequestID is getRequestId().
func GetRequestID(ctx context.Context) string {
	if c := getContext(ctx); c != nil {
		return c.requestID
	}
	return ""
}

var errNoOrganization = errors.New(`"undefined" is not valid JSON`)

// organization is checkAuth followed by
// JSON.parse(requestContext.get('organization')): an MCP connection's
// organization wins over the agent request context.
func organization(ctx context.Context) (*ent.Organization, error) {
	if org := GetAuth(ctx); org != nil {
		return org, nil
	}
	if c := getContext(ctx); c != nil && c.rc != nil && c.rc.Organization != nil {
		return c.rc.Organization, nil
	}
	return nil, errNoOrganization
}
