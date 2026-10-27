// Package videos holds the original app's dtos/videos.
package videos

import (
	"encoding/json"
	"strings"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/videos"
)

// VideoDto is the body of POST /media/generate-video.
type VideoDto struct {
	Type         string          `json:"type"`
	Output       string          `json:"output"` // vertical | horizontal
	CustomParams json.RawMessage `json:"customParams"`
}

// Validate returns the class-validator messages in declaration order: type
// must be an available video identifier (ValidIn), output vertical or
// horizontal.
func (d *VideoDto) Validate() []string {
	messages := []string{}
	valid := videos.AvailableIdentifiers()
	found := false
	for _, id := range valid {
		found = found || id == d.Type
	}
	if !found {
		messages = append(messages, "type must be any of: "+strings.Join(valid, ", "))
	}
	if d.Output != "vertical" && d.Output != "horizontal" {
		messages = append(messages, "output must be one of the following values: vertical, horizontal")
	}
	return messages
}

// VideoFunctionDto is the body of POST /media/video/function.
type VideoFunctionDto struct {
	Identifier   *string         `json:"identifier"`
	FunctionName *string         `json:"functionName"`
	Params       json.RawMessage `json:"params"`
}

// Validate returns the @IsString messages for missing or null values (a
// non-string already fails JSON decoding).
func (d *VideoFunctionDto) Validate() []string {
	messages := []string{}
	if d.Identifier == nil {
		messages = append(messages, "identifier must be a string")
	}
	if d.FunctionName == nil {
		messages = append(messages, "functionName must be a string")
	}
	return messages
}
