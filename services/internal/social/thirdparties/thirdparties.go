// Package thirdparties is Postiz's 3rdparties/* folder: the ThirdPartyManager
// registry (what the @ThirdParty decorator collects) and the HeyGen and
// Reel.Farm providers.
package thirdparties

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/openai"
)

// Field is one entry of a provider's fields.
type Field struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Type        string `json:"type"`
	Placeholder string `json:"placeholder"`
	Validation  string `json:"validation,omitempty"`
}

// Params is the @ThirdParty decorator metadata.
type Params struct {
	Identifier  string  `json:"identifier"`
	Title       string  `json:"title"`
	Description string  `json:"description"`
	Position    string  `json:"position"` // media | media-library | webhook
	Fields      []Field `json:"fields"`
}

// Connection is checkConnection's successful result (false is nil).
type Connection struct {
	Name     string `json:"name"`
	Username string `json:"username"`
	ID       string `json:"id"`
}

// Function is a provider method callable by name through
// POST /third-party/function/:id/:functionName.
type Function func(ctx context.Context, apiKey string, data json.RawMessage) (any, error)

// Provider is ThirdPartyAbstract.
type Provider interface {
	Params() Params
	CheckConnection(ctx context.Context, apiKey string) (*Connection, error)
	SendData(ctx context.Context, apiKey string, data json.RawMessage) (string, error)
	// Functions are every method of the class by its TS name (the abstract
	// class's [key: string] index signature).
	Functions() map[string]Function
}

// Registered is getThirdPartyByName's result: the metadata plus the instance.
type Registered struct {
	Params
	Instance Provider
}

// ThirdPartyService is the part of database/thirdparty's Service the
// manager wraps.
type ThirdPartyService interface {
	DeleteIntegration(ctx context.Context, org, id string) (*ent.ThirdParty, error)
	GetIntegrationByID(ctx context.Context, org, id string) (*ent.ThirdParty, error)
	GetAllThirdPartiesByOrganization(ctx context.Context, org string) ([]*ent.ThirdParty, error)
	SaveIntegration(ctx context.Context, org, identifier, apiKey string, data Connection) (*ent.ThirdParty, error)
}

// Manager is ThirdPartyManager.
type Manager struct {
	providers         []Provider
	thirdPartyService ThirdPartyService
}

// NewManager registers every provider in ThirdPartyModule order.
func NewManager(thirdPartyService ThirdPartyService, openaiService *openai.Service) *Manager {
	return &Manager{
		providers:         []Provider{NewHeygenProvider(openaiService), NewReelFarmProvider()},
		thirdPartyService: thirdPartyService,
	}
}

// ListItem is one getAllThirdParties entry.
type ListItem struct {
	Identifier  string  `json:"identifier"`
	Title       string  `json:"title"`
	Description string  `json:"description"`
	Fields      []Field `json:"fields"`
}

func (m *Manager) GetAllThirdParties() []ListItem {
	out := make([]ListItem, 0, len(m.providers))
	for _, p := range m.providers {
		params := p.Params()
		fields := params.Fields
		if fields == nil {
			fields = []Field{}
		}
		out = append(out, ListItem{Identifier: params.Identifier, Title: params.Title, Description: params.Description, Fields: fields})
	}
	return out
}

// GetThirdPartyByName returns nil for an unknown identifier.
func (m *Manager) GetThirdPartyByName(identifier string) *Registered {
	for _, p := range m.providers {
		if params := p.Params(); params.Identifier == identifier {
			return &Registered{Params: params, Instance: p}
		}
	}
	return nil
}

func (m *Manager) DeleteIntegration(ctx context.Context, org, id string) (*ent.ThirdParty, error) {
	return m.thirdPartyService.DeleteIntegration(ctx, org, id)
}

func (m *Manager) GetIntegrationByID(ctx context.Context, org, id string) (*ent.ThirdParty, error) {
	return m.thirdPartyService.GetIntegrationByID(ctx, org, id)
}

func (m *Manager) GetAllThirdPartiesByOrganization(ctx context.Context, org string) ([]*ent.ThirdParty, error) {
	return m.thirdPartyService.GetAllThirdPartiesByOrganization(ctx, org)
}

func (m *Manager) SaveIntegration(ctx context.Context, org, identifier, apiKey string, data Connection) (*ent.ThirdParty, error) {
	return m.thirdPartyService.SaveIntegration(ctx, org, identifier, apiKey, data)
}

// truthy is JavaScript truthiness of a decoded JSON value.
func truthy(v any) bool {
	switch t := v.(type) {
	case nil:
		return false
	case bool:
		return t
	case float64:
		return t != 0
	case string:
		return t != ""
	}
	return true
}

// or is a || b || ... over decoded JSON values.
func or(values ...any) any {
	for _, v := range values[:len(values)-1] {
		if truthy(v) {
			return v
		}
	}
	return values[len(values)-1]
}

// jsString is String(v).
func jsString(v any) string {
	switch t := v.(type) {
	case nil:
		return "undefined"
	case string:
		return t
	case float64:
		return strconv.FormatFloat(t, 'f', -1, 64)
	}
	return fmt.Sprint(v)
}
