// Package integrations holds the dtos/integrations request bodies.
package integrations

import (
	"encoding/json"
	"unicode/utf8"
)

// APIKeyDto is ApiKeyDto. Its MinLength message is custom, so it is checked
// by Validate instead of a tag.
type APIKeyDto struct {
	API string `json:"api"`
}

func (d *APIKeyDto) Validate() []string {
	if utf8.RuneCountInString(d.API) < 4 {
		return []string{"Must be at least 4 characters"}
	}
	return nil
}

type ConnectIntegrationDto struct {
	State    string `json:"state" validate:"required"`
	Code     string `json:"code" validate:"required"`
	Timezone string `json:"timezone" validate:"required"`
	Refresh  string `json:"refresh,omitempty"`
}

type CustomerNameDto struct {
	Name string `json:"name" validate:"min=1"`
}

type IntegrationFunctionDto struct {
	Name string          `json:"name" validate:"required"`
	ID   string          `json:"id" validate:"required"`
	Data json.RawMessage `json:"data"`
}

type IntegrationNameDto struct {
	Name string `json:"name" validate:"required"`
}

type IntegrationValidateTimeDto struct {
	Time *float64 `json:"time" validate:"required"`
}

type IntegrationTimeDto struct {
	Time []IntegrationValidateTimeDto `json:"time" validate:"required,dive"`
}
