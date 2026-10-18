// Package plugs holds dtos/plugs.
package plugs

type FieldsDto struct {
	Name  string `json:"name" validate:"required"`
	Value string `json:"value" validate:"required"`
}

type PlugDto struct {
	Func   string      `json:"func" validate:"required"`
	Fields []FieldsDto `json:"fields" validate:"required,dive"`
}
