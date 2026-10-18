// Package signature holds Postiz's dtos/signature.
package signature

type SignatureDto struct {
	Content string `json:"content" validate:"required"`
	AutoAdd *bool  `json:"autoAdd" validate:"required"`
}
