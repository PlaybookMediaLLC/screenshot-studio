// Package announcements holds Postiz's dtos/announcements.
package announcements

type AnnouncementDto struct {
	Title       string `json:"title" validate:"required"`
	Description string `json:"description" validate:"required"`
	Color       string `json:"color,omitempty" validate:"omitempty,oneof=INFO WARNING ERROR"`
}
