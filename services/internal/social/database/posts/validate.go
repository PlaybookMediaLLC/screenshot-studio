package posts

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	dtos "github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/dtos/posts"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/helpers"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/httpx"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations"
)

// settingsMessages validates settings against the provider's settings DTO:
// the DTO's Validate() []string when it has one, else its validate tags.
// nil when the provider has no DTO or the settings are valid.
func settingsMessages(provider integrations.Provider, settings json.RawMessage) []string {
	dto := provider.SettingsDTO()
	if dto == nil {
		return nil
	}
	if len(settings) == 0 || string(settings) == "null" {
		settings = json.RawMessage("{}")
	}
	if err := json.Unmarshal(settings, dto); err != nil {
		var typeErr *json.UnmarshalTypeError
		if errors.As(err, &typeErr) {
			return []string{typeErr.Field + " has an invalid value"}
		}
		return []string{err.Error()}
	}
	if v, ok := dto.(interface{ Validate() []string }); ok {
		return v.Validate()
	}
	err := httpx.Validate(dto)
	var he *httpx.Error
	if !errors.As(err, &he) {
		return nil
	}
	if list := he.Messages(); list != nil {
		return list
	}
	return []string{fmt.Sprint(he.Body)}
}

// MapTypeToPost resolves every post's provider into settings.__type, sets the
// post type (schedule when replaceDraft) and runs the CreatePostDto
// validation (ValidationPipe), answering 400 with its messages.
func (s *Service) MapTypeToPost(ctx context.Context, body *dtos.CreatePostDto, organization string, replaceDraft bool) (*dtos.CreatePostDto, error) {
	if body == nil || body.Posts == nil {
		return nil, httpx.BadRequest("All posts must have an integration id")
	}
	for _, p := range body.Posts {
		if p.Integration.ID == "" {
			return nil, httpx.BadRequest("All posts must have an integration id")
		}
	}

	postType := body.Type
	if replaceDraft {
		postType = "schedule"
	}
	mapped := *body
	mapped.Type = postType
	mapped.Posts = make([]dtos.Post, len(body.Posts))
	for i, p := range body.Posts {
		integration, err := s.integrationService.GetIntegrationByID(ctx, organization, p.Integration.ID)
		if err != nil {
			return nil, err
		}
		if integration == nil {
			return nil, httpx.BadRequest(fmt.Sprintf("Integration with id %s not found", p.Integration.ID))
		}

		if p.Type == "" {
			p.Type = postType
		}
		if p.Settings, err = dtos.WithSettingsType(p.Settings, integration.ProviderIdentifier); err != nil {
			return nil, httpx.BadRequest([]string{fmt.Sprintf("posts.%d.settings nested property settings must be either object or array", i)})
		}
		// @Transform(sanitizePostContent) runs before validation
		values := make([]dtos.PostContent, len(p.Value))
		for j, v := range p.Value {
			v.Content = helpers.SanitizePostContent(v.Content)
			values[j] = v
		}
		if p.Value != nil {
			p.Value = values
		}
		mapped.Posts[i] = p
	}

	messages := mapped.Validate(func(p *dtos.Post) []string {
		provider := s.integrationManager.GetSocialIntegration(p.SettingsType())
		if provider == nil {
			return nil
		}
		return settingsMessages(provider, p.Settings)
	})
	if len(messages) > 0 {
		return nil, httpx.BadRequest(messages)
	}
	return &mapped, nil
}

// PostValidation is validatePosts's result for one channel. Errors is true
// when the media is valid, otherwise the provider's message.
type PostValidation struct {
	ID                string `json:"id"`
	Identifier        string `json:"identifier"`
	Name              string `json:"name"`
	Valid             bool   `json:"valid"`
	SettingsError     string `json:"settingsError"`
	Errors            any    `json:"errors"`
	EmptyContent      bool   `json:"emptyContent"`
	TooLong           bool   `json:"tooLong"`
	MaximumCharacters int    `json:"maximumCharacters"`
}

// ValidatePosts is the server-side validation that used to live on the
// client (`checkValidity` + the manage modal loop). Runs the provider's
// settings DTO validation, the provider `checkValidity` (media rules) and the
// empty-content / too-long character checks. Returns one result per post so
// the frontend can show the same toasts it did before — and so `/posts` can
// refuse to create invalid posts.
func (s *Service) ValidatePosts(ctx context.Context, orgID string, posts []dtos.Post) ([]PostValidation, error) {
	out := make([]PostValidation, 0, len(posts))
	for _, p := range posts {
		integration, err := s.integrationService.GetIntegrationByID(ctx, orgID, p.Integration.ID)
		if err != nil {
			return nil, err
		}
		if integration == nil {
			return nil, httpx.BadRequest(fmt.Sprintf("Integration with id %s not found", orDefault(p.Integration.ID, "undefined")))
		}

		provider := s.integrationManager.GetSocialIntegration(integration.ProviderIdentifier)
		if provider == nil {
			return nil, fmt.Errorf("provider %s is not registered", integration.ProviderIdentifier)
		}

		additionalSettings := []integrations.AdditionalSetting{}
		if err := json.Unmarshal([]byte(orDefault(deref(integration.AdditionalSettings), "[]")), &additionalSettings); err != nil || additionalSettings == nil {
			additionalSettings = []integrations.AdditionalSetting{}
		}

		settings := p.Settings
		if len(settings) == 0 || string(settings) == "null" {
			settings = json.RawMessage("{}")
		}
		media := make([][]integrations.ValidityMedia, 0, len(p.Value))
		for _, v := range p.Value {
			images := []integrations.ValidityMedia{}
			for _, image := range v.Image {
				images = append(images, integrations.ValidityMedia{Path: image.Path, Thumbnail: image.Thumbnail})
			}
			media = append(media, images)
		}

		// Settings DTO validation — mirrors the client `form.trigger()`.
		valid := true
		settingsError := ""
		if provider.SettingsDTO() != nil {
			messages := settingsMessages(provider, settings)
			if len(messages) > 0 {
				settingsError = messages[0]
			}
			valid = len(messages) == 0
		}

		// Provider-specific media validation (the old client `checkValidity`).
		var mediaErrors any = true
		if message, err := provider.CheckValidity(ctx, media, settings, additionalSettings); err != nil {
			mediaErrors = orDefault(err.Error(), "Invalid media")
		} else if message != "" {
			mediaErrors = message
		}

		maximumCharacters := provider.MaxLength(additionalSettings, settings)
		limit := maximumCharacters
		if limit == 0 {
			limit = 1000000
		}

		emptyContent, tooLong := false, false
		for _, v := range p.Value {
			strip := helpers.StripHTMLValidation("normal", v.Content, helpers.StripOptions{ReplaceBold: true})
			length := helpers.CountLength(integration.ProviderIdentifier, strip)
			if length == 0 && len(v.Image) == 0 {
				emptyContent = true
			}
			if length > limit {
				tooLong = true
			}
		}

		out = append(out, PostValidation{
			ID:                integration.ID,
			Identifier:        integration.ProviderIdentifier,
			Name:              integration.Name,
			Valid:             valid,
			SettingsError:     settingsError,
			Errors:            mediaErrors,
			EmptyContent:      emptyContent,
			TooLong:           tooLong,
			MaximumCharacters: maximumCharacters,
		})
	}
	return out, nil
}
