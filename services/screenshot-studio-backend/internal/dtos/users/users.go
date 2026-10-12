// Package users holds Postiz's dtos/users. Validate returns the
// ValidationPipe messages in class-validator order; empty means valid.
package users

import (
	"unicode/utf16"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/helpers"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/httpx"
)

// EmailNotificationsDto is email-notifications.dto.ts.
type EmailNotificationsDto struct {
	SendSuccessEmails *bool `json:"sendSuccessEmails"`
	SendFailureEmails *bool `json:"sendFailureEmails"`
	SendStreakEmails  *bool `json:"sendStreakEmails"`
}

func (d *EmailNotificationsDto) Validate() []string {
	var out []string
	for _, f := range []struct {
		name  string
		value *bool
	}{{"sendSuccessEmails", d.SendSuccessEmails}, {"sendFailureEmails", d.SendFailureEmails}, {"sendStreakEmails", d.SendStreakEmails}} {
		if f.value == nil {
			out = append(out, f.name+" must be a boolean value")
		}
	}
	return out
}

// UserDetailDto is user.details.dto.ts. Bio nil means "leave unchanged".
type UserDetailDto struct {
	Fullname string    `json:"fullname"`
	Bio      *string   `json:"bio"`
	Picture  *MediaDto `json:"picture"`
}

func (d *UserDetailDto) Validate() []string {
	var out []string
	if len(utf16.Encode([]rune(d.Fullname))) < 3 {
		out = append(out, "fullname must be longer than or equal to 3 characters")
	}
	if d.Picture != nil {
		// Nest prefixes nested messages with the parent property.
		for _, msg := range d.Picture.Validate() {
			out = append(out, "picture."+msg)
		}
	}
	return out
}

// MediaDto mirrors dtos/media/media.dto.ts (UserDetailDto.picture).
type MediaDto struct {
	ID        *string `json:"id"`
	Path      *string `json:"path"`
	Alt       *string `json:"alt,omitempty"`
	Thumbnail *string `json:"thumbnail,omitempty"`
}

func (d *MediaDto) Validate() []string {
	var out []string
	if d.ID == nil {
		out = append(out, "id should not be null or undefined", "id must be a string")
	}
	path := ""
	if d.Path == nil {
		out = append(out, "path should not be null or undefined")
	} else {
		path = *d.Path
	}
	if !helpers.ValidURLExtension(path) {
		out = append(out, helpers.ValidURLExtensionMessage)
	}
	if !helpers.IsAllowedUploadPath(path) {
		out = append(out, helpers.ValidURLPathMessage())
	}
	if d.Path == nil {
		out = append(out, "path must be a string")
	}
	if d.Thumbnail != nil && *d.Thumbnail != "" && httpx.Validator().Var(*d.Thumbnail, "url") != nil {
		out = append(out, "thumbnail must be a URL address")
	}
	return out
}
