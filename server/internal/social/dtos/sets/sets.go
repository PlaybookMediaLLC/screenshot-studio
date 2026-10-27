// Package sets holds the original app's dtos/sets.
package sets

type SetsDto struct {
	ID      string `json:"id,omitempty"`
	Name    string `json:"name" validate:"required"`
	Content string `json:"content" validate:"required"`
}

type UpdateSetsDto struct {
	ID      string `json:"id" validate:"required"`
	Name    string `json:"name" validate:"required"`
	Content string `json:"content" validate:"required"`
}
