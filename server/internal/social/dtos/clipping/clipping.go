// Package clipping holds dtos/clipping.
package clipping

type ClippingDto struct {
	URL string `json:"url" validate:"http_url"`
	// channels to create the draft posts for; without any, the clips only land in the media library
	Integrations []string `json:"integrations,omitempty" validate:"omitempty,max=20"`
	Clips        *int     `json:"clips,omitempty" validate:"omitempty,min=1,max=10"`
	// how the 16:9 picture lands on the vertical canvas: "blur" keeps all of it over a
	// blurred copy of itself, "crop" fills the canvas and cuts the sides
	Fit string `json:"fit,omitempty" validate:"omitempty,oneof=crop blur"`
}
