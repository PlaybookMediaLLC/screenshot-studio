// Package videos is Postiz's videos/* folder: the VideoManager registry
// (what the @Video decorator collects) and the image-text-slides and
// seedance providers.
package videos

import (
	"context"
	"encoding/json"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/httpx"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/openai"
)

// Tool is one {functionName, output} entry of a video's tools.
type Tool struct {
	FunctionName string `json:"functionName"`
	Output       string `json:"output"`
}

// Params is the @Video decorator metadata. Available is computed from the
// environment when read. DTOName is the params class name the agent looks
// its JSON schema up by; Schema is that class-validator-jsonschema schema.
type Params struct {
	Identifier  string          `json:"identifier"`
	Title       string          `json:"title"`
	Tools       []Tool          `json:"tools"`
	Description string          `json:"description"`
	Placement   string          `json:"placement"` // text-to-image | image-to-video | video-to-video
	Trial       bool            `json:"trial"`
	Available   bool            `json:"-"`
	DTOName     string          `json:"-"`
	Schema      json.RawMessage `json:"-"`
}

// Function is a method exposed with @ExposeVideoFunction.
type Function func(ctx context.Context, data json.RawMessage) (any, error)

// Video is VideoAbstract.
type Video interface {
	Params() Params
	// Validate is processAndValidate's ValidationPipe over the params DTO:
	// the class-validator messages, empty when valid.
	Validate(customParams json.RawMessage) []string
	Process(ctx context.Context, output string, customParams json.RawMessage) (string, error)
	// Functions are the @ExposeVideoFunction methods, by name.
	Functions() map[string]Function
}

// ProcessAndValidate rejects invalid params with the ValidationPipe's 400.
func ProcessAndValidate(v Video, customParams json.RawMessage) error {
	if messages := v.Validate(customParams); len(messages) > 0 {
		return httpx.BadRequest(messages)
	}
	return nil
}

// Registered is getVideoByName's result: the metadata plus the instance.
type Registered struct {
	Params
	Instance Video
}

// Manager is VideoManager.
type Manager struct {
	videos []Video
}

// NewManager registers every provider in VideoModule order.
func NewManager(openaiService *openai.Service, falService *openai.FalService) *Manager {
	return &Manager{videos: []Video{NewImagesSlides(openaiService, falService), NewSeedance()}}
}

// All is the metadata of every registered provider, available or not.
func All() []Params {
	return []Params{imagesSlidesParams(), seedanceParams()}
}

// AvailableIdentifiers lists the identifiers of the available providers
// (the VideoDto type validator).
func AvailableIdentifiers() []string {
	ids := []string{}
	for _, p := range All() {
		if p.Available {
			ids = append(ids, p.Identifier)
		}
	}
	return ids
}

// GetAllVideos lists the available providers. JSON-encoded, it leaves out
// the target and dto classes.
func (m *Manager) GetAllVideos() []Params {
	out := []Params{}
	for _, v := range m.videos {
		if p := v.Params(); p.Available {
			out = append(out, p)
		}
	}
	return out
}

// CheckAvailableVideoFunction keeps the TS meaning: it is true when the
// function is NOT exposed on the video.
func (m *Manager) CheckAvailableVideoFunction(v Video, functionName string) bool {
	_, ok := v.Functions()[functionName]
	return !ok
}

// GetVideoByName returns the provider, available or not; nil when unknown.
func (m *Manager) GetVideoByName(identifier string) *Registered {
	for _, v := range m.videos {
		if p := v.Params(); p.Identifier == identifier {
			return &Registered{Params: p, Instance: v}
		}
	}
	return nil
}

// decodeParams reads customParams as an object; anything else is empty.
func decodeParams(customParams json.RawMessage) map[string]any {
	var m map[string]any
	_ = json.Unmarshal(customParams, &m)
	if m == nil {
		m = map[string]any{}
	}
	return m
}

// isString is @IsString after enableImplicitConversion: every value but
// null/undefined is converted to a string, so only those fail.
func isString(m map[string]any, key string) bool {
	v, ok := m[key]
	return ok && v != nil
}
