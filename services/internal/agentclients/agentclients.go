// Package agentclients reads the OAuth clients registered with the MCP
// authorization server, the social backend's OAuthApp table, for the agent
// consent screen (RFC 038). Both backends share the database.
package agentclients

import (
	"context"
	"database/sql"
	"encoding/json"

	"entgo.io/ent/dialect"
	entsql "entgo.io/ent/dialect/sql"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/product"
	social "github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent/oauthapp"
)

// Registry implements product.AgentClients.
type Registry struct{ client *social.Client }

// New reads clients through db, the shared PostgreSQL database.
func New(db *sql.DB) *Registry {
	return &Registry{client: social.NewClient(social.Driver(entsql.OpenDB(dialect.Postgres, db)))}
}

// FindAgentClient returns the live client with clientID, or nil.
func (r *Registry) FindAgentClient(ctx context.Context, clientID string) (*product.AgentClient, error) {
	app, err := r.client.OAuthApp.Query().Where(oauthapp.ClientID(clientID), oauthapp.DeletedAtIsNil()).First(ctx)
	if social.IsNotFound(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var redirects []string
	if app.RedirectUris != nil && *app.RedirectUris != "" {
		if err := json.Unmarshal([]byte(*app.RedirectUris), &redirects); err != nil {
			return nil, err
		}
	}
	public := app.Dynamic && app.TokenEndpointAuthMethod != nil && *app.TokenEndpointAuthMethod == "none"
	return &product.AgentClient{ClientID: app.ClientID, Name: app.Name, RedirectURIs: redirects,
		RedirectURL: app.RedirectURL, Dynamic: app.Dynamic, Public: public}, nil
}
