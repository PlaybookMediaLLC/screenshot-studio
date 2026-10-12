package chat

import (
	"context"
	"encoding/json"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/ent"
	postsdto "github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/dtos/posts"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/integrations"
)

// The services the tools call, as the consumer sees them.

// IntegrationService is the part of integration.Service the tools use.
type IntegrationService interface {
	// GetIntegrationsList returns the organization's channels with
	// Edges.Customer loaded.
	GetIntegrationsList(ctx context.Context, orgID string) ([]*ent.Integration, error)
	Customers(ctx context.Context, orgID string) ([]*ent.Customer, error)
	GetIntegrationByID(ctx context.Context, orgID, id string) (*ent.Integration, error)
	DisconnectChannel(ctx context.Context, orgID string, integration *ent.Integration) error
}

// RefreshIntegrationService is RefreshIntegrationService.refresh: nil details
// mean the refresh failed (TypeScript `false`).
type RefreshIntegrationService interface {
	Refresh(ctx context.Context, integration *ent.Integration) (*integrations.AuthTokenDetails, error)
}

// PostValidation is one entry of PostsService.validatePosts.
type PostValidation struct {
	ID            string `json:"id"`
	Identifier    string `json:"identifier"`
	Name          string `json:"name"`
	Valid         bool   `json:"valid"`
	SettingsError string `json:"settingsError"`
	// Errors is the checkValidity message, "" when the media is valid
	// (TypeScript `true`).
	Errors            string `json:"errors"`
	EmptyContent      bool   `json:"emptyContent"`
	TooLong           bool   `json:"tooLong"`
	MaximumCharacters int    `json:"maximumCharacters"`
}

// CreatedPost is one entry of PostsService.createPost.
type CreatedPost struct {
	PostID      string `json:"postId"`
	Integration string `json:"integration"`
}

// UpdatedPostSettings is PostsService.updatePostSettings' answer.
type UpdatedPostSettings struct {
	PostID      string `json:"postId"`
	PublishDate string `json:"publishDate"`
}

// PostsService is the part of posts.Service the tools use.
type PostsService interface {
	ValidatePosts(ctx context.Context, orgID string, posts []postsdto.Post) ([]PostValidation, error)
	CreatePost(ctx context.Context, orgID string, body *postsdto.CreatePostDto, creationMethod string) ([]CreatedPost, error)
	// GetPosts returns posts with Edges.Integration loaded.
	GetPosts(ctx context.Context, orgID string, query *postsdto.GetPostsDto) ([]*ent.Post, error)
	UpdatePostSettings(ctx context.Context, orgID, postID string, settings map[string]any, creationMethod string) (*UpdatedPostSettings, error)
}

// VideoDto is the body of MediaService.startGenerateVideo.
type VideoDto struct {
	Type         string         `json:"type"`
	Output       string         `json:"output"`
	CustomParams map[string]any `json:"customParams"`
}

// VideoJob is MediaService.getGenerateVideoStatus' answer.
type VideoJob struct {
	Status string `json:"status"`
	ID     string `json:"id,omitempty"`
	Path   string `json:"path,omitempty"`
	Error  string `json:"error,omitempty"`
}

// MediaService is the part of media.Service the tools use.
type MediaService interface {
	StartGenerateVideo(ctx context.Context, org *ent.Organization, body VideoDto) (jobID string, err error)
	GetGenerateVideoStatus(ctx context.Context, org *ent.Organization, jobID string) (*VideoJob, error)
	// GenerateImage returns the base64 image.
	GenerateImage(ctx context.Context, prompt string, org *ent.Organization) (string, error)
	SaveFile(ctx context.Context, orgID, fileName, filePath string) (*ent.Media, error)
	UploadFromURL(ctx context.Context, orgID, url string) (*ent.Media, error)
	GetMedia(ctx context.Context, orgID string, page int, search string) (pages int, results []*ent.Media, err error)
	CreateUploadSession(ctx context.Context, orgID string) (string, error)
	CreateUploadTicket(ctx context.Context, orgID, sessionID string) (string, error)
	GetUploadSession(ctx context.Context, orgID, sessionID string) ([]*ent.Media, error)
}

// Credits is SubscriptionService.checkCredits' answer.
type Credits struct {
	Credits int `json:"credits"`
}

// SubscriptionService is the part of subscriptions.Service the tools use.
type SubscriptionService interface {
	CheckCredits(ctx context.Context, org *ent.Organization, checkType string) (*Credits, error)
}

// ClippingDto is the body of ClippingService.startClipping.
type ClippingDto struct {
	URL          string   `json:"url"`
	Integrations []string `json:"integrations,omitempty"`
	Clips        *int     `json:"clips,omitempty"`
	Fit          string   `json:"fit"`
}

// ClippingService is the part of clipping.Service the tools use.
type ClippingService interface {
	StartClipping(ctx context.Context, org *ent.Organization, body ClippingDto) (*ent.Clipping, error)
	// WaitForClipping returns the clipping with Edges.Clips loaded.
	WaitForClipping(ctx context.Context, orgID, id string, seconds int) (*ent.Clipping, error)
	CreateWidgetTicket(ctx context.Context, orgID, id string) (string, error)
}

// VideoTool is one @VideoFunction of a video provider.
type VideoTool struct {
	FunctionName string `json:"functionName"`
	Output       string `json:"output"`
}

// Video is one entry of VideoManager.getAllVideos. DTO is a new pointer to
// the provider's custom params DTO; Call runs one of its video functions.
type Video struct {
	Identifier string
	Title      string
	Tools      []VideoTool
	DTO        any
	Call       func(ctx context.Context, functionName string) (any, error)
}

// VideoManager is the part of videos.VideoManager the tools use.
type VideoManager interface {
	GetAllVideos() []Video
}

// Storage is the part of the upload provider the tools use.
type Storage interface {
	UploadSimple(ctx context.Context, path string) (string, error)
}

// Services are the tools' dependencies.
type Services struct {
	Integrations        IntegrationService
	RefreshIntegrations RefreshIntegrationService
	IntegrationManager  *integrations.Manager
	Posts               PostsService
	Media               MediaService
	Subscriptions       SubscriptionService
	Clipping            ClippingService
	Videos              VideoManager
	Storage             Storage
	// ClippingEnabled is UploadFactory.clippingEnabled.
	ClippingEnabled func() bool
}

func decode[T any](input json.RawMessage) (T, error) {
	var v T
	err := json.Unmarshal(input, &v)
	return v, err
}
