package app

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"iter"
	"net/http"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/backend/api/content"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/backend/auth"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/ent/post"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/agent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/chat"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/database/autopost"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/database/clipping"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/database/integration"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/database/media"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/database/notifications"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/database/organizations"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/database/posts"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/database/subscriptions"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/database/thirdparty"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/deepgram"
	dtoauth "github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/dtos/auth"
	clippingdto "github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/dtos/clipping"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/dtos/generator"
	postsdto "github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/dtos/posts"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/email"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/httpx"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/integrations"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/newsletter"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/openai"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/shortlink"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/thirdparties"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/track"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/upload"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/videos"
)

// The adapters below reconcile the consumer-side interfaces each package
// declared with the concrete service they are given. They only convert
// shapes; behavior stays in the services.

// convert re-decodes v as T through JSON (the TS code passes plain objects
// between these services, so the JSON shape is the contract).
func convert[T any](v any) (T, error) {
	var out T
	data, err := json.Marshal(v)
	if err != nil {
		return out, err
	}
	err = json.Unmarshal(data, &out)
	return out, err
}

// ---- email / notifications

// notificationEmail is email.Service as notifications.EmailService (the
// started workflow run is not used).
type notificationEmail struct{ *email.Service }

func (e notificationEmail) SendEmail(ctx context.Context, to, subject, html, addTo, replyTo string) error {
	_, err := e.Service.SendEmail(ctx, to, subject, html, addTo, replyTo)
	return err
}

// integrationNotifications takes the notification type as a string; "" is
// the TS default 'success'.
type integrationNotifications struct{ *notifications.Service }

func (n integrationNotifications) InAppNotification(ctx context.Context, orgID, subject, message string, sendEmail, digest bool, notificationType string) error {
	typ := notifications.NotificationType(notificationType)
	if typ == "" {
		typ = notifications.TypeSuccess
	}
	return n.Service.InAppNotification(ctx, orgID, subject, message, sendEmail, digest, typ)
}

// authEmail is AuthService's sendEmailSync(to, subject, html) (no replyTo);
// the Go email service retries and logs, never failing the caller.
type authEmail struct{ *email.Service }

func (e authEmail) SendEmailSync(ctx context.Context, to, subject, html string) error {
	e.Service.SendEmailSync(ctx, to, subject, html, "")
	return nil
}

type authNewsletter struct{}

func (authNewsletter) Register(ctx context.Context, email string) error {
	return newsletter.Register(ctx, email)
}

// ---- organizations

// authOrganizations is organizations.Service as auth.OrganizationService.
type authOrganizations struct{ *organizations.Service }

func (o authOrganizations) CreateOrgAndUser(ctx context.Context, body auth.CreateOrgAndUserBody, ip, userAgent string) (*ent.Organization, error) {
	provider := string(body.Provider)
	return o.Service.CreateOrgAndUser(ctx, &dtoauth.CreateOrgUserDto{
		Password: &body.Password, Provider: &provider, Email: &body.Email, Company: &body.Company,
		ProviderID: body.ProviderID, DatafastVisitorID: body.DatafastVisitorID,
	}, ip, userAgent)
}

// ---- third parties

// thirdPartyService is database/thirdparty as thirdparties.ThirdPartyService.
type thirdPartyService struct{ *thirdparty.Service }

func (t thirdPartyService) GetAllThirdPartiesByOrganization(ctx context.Context, org string) ([]*ent.ThirdParty, error) {
	list, err := t.Service.GetAllThirdPartiesByOrganization(ctx, org)
	if err != nil {
		return nil, err
	}
	out := make([]*ent.ThirdParty, 0, len(list))
	for _, p := range list {
		out = append(out, &ent.ThirdParty{ID: p.ID, Name: p.Name, Identifier: p.Identifier})
	}
	return out, nil
}

func (t thirdPartyService) SaveIntegration(ctx context.Context, org, identifier, apiKey string, data thirdparties.Connection) (*ent.ThirdParty, error) {
	return t.Service.SaveIntegration(ctx, org, identifier, apiKey, thirdparty.SaveIntegrationData{Name: data.Name, Username: data.Username, ID: data.ID})
}

// ---- subscriptions

type mediaSubscriptions struct{ *subscriptions.Service }

func (s mediaSubscriptions) UseCredit(ctx context.Context, org *ent.Organization, creditType string, fn func(context.Context) (any, error)) (any, error) {
	var result any
	err := s.Service.UseCredit(ctx, org, creditType, func(ctx context.Context) error {
		var err error
		result, err = fn(ctx)
		return err
	})
	return result, err
}

func (s mediaSubscriptions) CheckCredits(ctx context.Context, org *ent.Organization, creditType string) (int, error) {
	return checkCredits(ctx, s.Service, org, creditType)
}

func checkCredits(ctx context.Context, s *subscriptions.Service, org *ent.Organization, creditType string) (int, error) {
	credits, err := s.CheckCredits(ctx, org, creditType)
	if err != nil || credits == nil {
		return 0, err
	}
	return credits.Credits, nil
}

type clippingSubscriptions struct{ *subscriptions.Service }

func (s clippingSubscriptions) CheckCredits(ctx context.Context, org *ent.Organization, creditType string) (int, error) {
	return checkCredits(ctx, s.Service, org, creditType)
}

func (s clippingSubscriptions) RefundCredits(ctx context.Context, organizationID, id string) error {
	_, err := s.Service.RefundCredits(ctx, organizationID, id)
	return err
}

// paymentSubscriptions is subscriptions.Service as payment.SubscriptionService.
// The create/update methods answer {} (what the webhook echoes on the paths
// that do not return the stored row).
type paymentSubscriptions struct{ *subscriptions.Service }

func (s paymentSubscriptions) CreateOrUpdateSubscription(ctx context.Context, provider string, isTrailing bool, identifier, customerID string, totalChannels int, billing, period string, cancelAt *int64, code, org string) (any, error) {
	if err := s.Service.CreateOrUpdateSubscription(ctx, provider, isTrailing, identifier, customerID, totalChannels, billing, period, cancelAt, code, org); err != nil {
		return nil, err
	}
	return map[string]any{}, nil
}

func (s paymentSubscriptions) CreateOrUpdateSubscriptionByOrg(ctx context.Context, isTrailing bool, organizationID, provider, identifier string, totalChannels int, billing, period string, cancelAt *int64) (any, error) {
	if err := s.Service.CreateOrUpdateSubscriptionByOrg(ctx, isTrailing, organizationID, provider, identifier, totalChannels, billing, period, cancelAt); err != nil {
		return nil, err
	}
	return map[string]any{}, nil
}

func (s paymentSubscriptions) DeleteSubscription(ctx context.Context, customerID, provider string) error {
	_, err := s.Service.DeleteSubscription(ctx, customerID, provider)
	return err
}

func (s paymentSubscriptions) DeleteSubscriptionByOrgID(ctx context.Context, organizationID, provider string) error {
	_, err := s.Service.DeleteSubscriptionByOrgID(ctx, organizationID, provider)
	return err
}

func (s paymentSubscriptions) UpdateCustomerID(ctx context.Context, organizationID, customerID string) error {
	_, err := s.Service.UpdateCustomerID(ctx, organizationID, customerID)
	return err
}

func (s paymentSubscriptions) UpdateCancelAt(ctx context.Context, organizationID string, cancelAt *int64) error {
	_, err := s.Service.UpdateCancelAt(ctx, organizationID, cancelAt)
	return err
}

// paymentOrganizations adds getTeam's users[].user include.
type paymentOrganizations struct {
	*organizations.Service
	repo *organizations.Repository
}

func (o paymentOrganizations) GetTeam(ctx context.Context, orgID string) (*ent.Organization, error) {
	members, err := o.repo.GetAllUsersOrgs(ctx, orgID)
	if err != nil || members == nil {
		return nil, err
	}
	return &ent.Organization{ID: orgID, Edges: ent.OrganizationEdges{Users: members}}, nil
}

// paymentTrack fires track() without awaiting it, like the TS.
type paymentTrack struct{ *track.Service }

func (t paymentTrack) Track(ctx context.Context, uniqueID, ip, agent string, tt int, additional map[string]any, fbclid string, user *ent.User) {
	_ = t.Service.Track(ctx, uniqueID, ip, agent, track.Enum(tt), additional, fbclid, user)
}

// ---- storage / processors

// mediaStorage adds uploadStreamToStorage to the storage. cloudMediaStorage
// keeps the presign methods visible to media's optional type assertion.
type mediaStorage struct{ upload.Provider }

func (s mediaStorage) UploadStreamToStorage(ctx context.Context, body io.Reader, declaredSize int64) (*media.UploadedStream, error) {
	return uploadStream(ctx, s.Provider, body, declaredSize)
}

type cloudMediaStorage struct{ upload.CloudProvider }

func (s cloudMediaStorage) UploadStreamToStorage(ctx context.Context, body io.Reader, declaredSize int64) (*media.UploadedStream, error) {
	return uploadStream(ctx, s.CloudProvider, body, declaredSize)
}

func uploadStream(ctx context.Context, p upload.Provider, body io.Reader, declaredSize int64) (*media.UploadedStream, error) {
	u, err := upload.UploadStreamToStorage(ctx, p, body, declaredSize)
	if err != nil {
		return nil, err
	}
	return &media.UploadedStream{Filename: u.Filename, OriginalName: u.Originalname, Path: u.Path, MimeType: u.Mimetype}, nil
}

func newMediaStorage(p upload.Provider) media.Storage {
	if cloud, ok := p.(upload.CloudProvider); ok {
		return cloudMediaStorage{cloud}
	}
	return mediaStorage{p}
}

// processor is a typed upload.MediaProcessor as media.Processor: jobs and
// results cross as JSON, like the RunPod payloads.
type processor[J, R any] struct{ p upload.MediaProcessor[J, R] }

func newProcessor[J, R any](p upload.MediaProcessor[J, R]) media.Processor {
	if p == nil {
		return nil
	}
	return processor[J, R]{p}
}

func (p processor[J, R]) Submit(ctx context.Context, job any) (string, error) {
	typed, err := convert[J](job)
	if err != nil {
		return "", err
	}
	return p.p.Submit(ctx, typed)
}

func (p processor[J, R]) Status(ctx context.Context, jobID string) (*media.ProcessorStatus, error) {
	status, err := p.p.Status(ctx, jobID)
	if err != nil {
		return nil, err
	}
	out := &media.ProcessorStatus{Status: status.Status, Error: status.Error}
	if status.Result != nil {
		if out.Result, err = json.Marshal(status.Result); err != nil {
			return nil, err
		}
	}
	return out, nil
}

// uploader is the storage plus the multer/r2 helpers the media controllers use.
type uploader struct{ upload.Provider }

// Uploader returns content.Uploader over the storage.
func (a *App) Uploader() content.Uploader { return uploader{a.Storage} }

func (u uploader) ReceiveFile(ctx context.Context, r *http.Request, field string) (*content.UploadedFile, map[string]string, error) {
	f, fields, err := upload.ReceiveFile(ctx, u.Provider, r, field)
	if err != nil || f == nil {
		return nil, fields, err
	}
	return &content.UploadedFile{Filename: f.Filename, Path: f.Path, Mimetype: f.Mimetype, Originalname: f.Originalname}, fields, nil
}

func (u uploader) HandleR2Upload(ctx context.Context, c *httpx.Ctx, endpoint string) (map[string]any, error) {
	return upload.HandleR2Upload(ctx, c, endpoint)
}

// ---- videos

// videoManager is videos.Manager as media.VideoManager.
type videoManager struct{ *videos.Manager }

func (m videoManager) GetAllVideos() any { return m.Manager.GetAllVideos() }

func (m videoManager) GetVideoByName(identifier string) media.Video {
	v := m.Manager.GetVideoByName(identifier)
	if v == nil {
		return nil
	}
	return video{v}
}

type video struct{ *videos.Registered }

func (v video) Trial() bool { return v.Params.Trial }

func (v video) ProcessAndValidate(_ context.Context, customParams json.RawMessage) error {
	return videos.ProcessAndValidate(v.Instance, customParams)
}

func (v video) Process(ctx context.Context, output string, customParams json.RawMessage) (string, error) {
	return v.Instance.Process(ctx, output, customParams)
}

func (v video) Function(name string) func(ctx context.Context, body json.RawMessage) (any, error) {
	return v.Instance.Functions()[name]
}

// ---- openai / deepgram

type postsOpenAI struct{ *openai.Service }

func (o postsOpenAI) SeparatePosts(ctx context.Context, content string, length int) ([]string, error) {
	out, err := o.Service.SeparatePosts(ctx, content, length)
	if err != nil || out == nil {
		return nil, err
	}
	return out.Posts, nil
}

type clippingOpenAI struct{ *openai.Service }

func (o clippingOpenAI) PickClips(ctx context.Context, title, language string, segments []clipping.Segment, maxClips int) ([]clipping.PickedClip, error) {
	in := make([]openai.Segment, len(segments))
	for i, s := range segments {
		in[i] = openai.Segment{Start: s.Start, End: s.End, Text: s.Text}
	}
	clips, err := o.Service.PickClips(ctx, title, language, in, maxClips)
	if err != nil {
		return nil, err
	}
	out := make([]clipping.PickedClip, len(clips))
	for i, c := range clips {
		out[i] = clipping.PickedClip{Title: c.Title, Content: c.Content, From: c.From, To: c.To}
	}
	return out, nil
}

type clippingDeepgram struct{ *deepgram.Service }

func (d clippingDeepgram) TranscribeURL(ctx context.Context, url string) (*clipping.Transcript, error) {
	t, err := d.Service.TranscribeURL(ctx, url)
	if err != nil || t == nil {
		return nil, err
	}
	out, err := convert[clipping.Transcript](t)
	return &out, err
}

// ---- shortlink

type postsShortLink struct{ *shortlink.Service }

func (s postsShortLink) GetStatistics(ctx context.Context, messages []string) (any, error) {
	return s.Service.GetStatistics(ctx, messages)
}

// ---- posts

// postsIntegrations is integration.Service as posts.IntegrationService
// (getPlugs: posts only reads id and plugFunction).
type postsIntegrations struct{ *integration.Service }

func (i postsIntegrations) GetPlugs(ctx context.Context, orgID, integrationID string) ([]*ent.Plugs, error) {
	list, err := i.Service.GetPlugs(ctx, orgID, integrationID)
	if err != nil {
		return nil, err
	}
	out := make([]*ent.Plugs, 0, len(list))
	for _, p := range list {
		out = append(out, &ent.Plugs{ID: p.ID, OrganizationID: p.OrganizationID, PlugFunction: p.PlugFunction, Data: p.Data,
			IntegrationID: p.IntegrationID, Activated: p.Activated})
	}
	return out, nil
}

// createPost is postsService.createPost(orgId, body, creationMethod) for the
// services that build the CreatePostDto as a plain object.
func createPost(ctx context.Context, s *posts.Service, orgID string, body any, creationMethod string) error {
	dto, err := convert[postsdto.CreatePostDto](body)
	if err != nil {
		return err
	}
	_, err = s.CreatePost(ctx, orgID, &dto, post.CreationMethod(creationMethod), false)
	return err
}

type autopostPosts struct{ *posts.Service }

func (p autopostPosts) CreatePost(ctx context.Context, orgID string, body autopost.CreatePostBody, creationMethod string) error {
	return createPost(ctx, p.Service, orgID, body, creationMethod)
}

type clippingPosts struct{ *posts.Service }

func (p clippingPosts) CreatePost(ctx context.Context, orgID string, body clipping.CreatePostBody, creationMethod string) error {
	return createPost(ctx, p.Service, orgID, body, creationMethod)
}

// ---- agent (LangGraph generator)

type agentPosts struct{ *posts.Service }

func (p agentPosts) FindAllExistingCategories(ctx context.Context) ([]*ent.PopularPosts, error) {
	list, err := p.Service.FindAllExistingCategories(ctx)
	out := make([]*ent.PopularPosts, len(list))
	for i, c := range list {
		out[i] = &ent.PopularPosts{Category: c.Category}
	}
	return out, err
}

func (p agentPosts) FindAllExistingTopicsOfCategory(ctx context.Context, category string) ([]*ent.PopularPosts, error) {
	list, err := p.Service.FindAllExistingTopicsOfCategory(ctx, category)
	out := make([]*ent.PopularPosts, len(list))
	for i, t := range list {
		out[i] = &ent.PopularPosts{Category: category, Topic: t.Topic}
	}
	return out, err
}

func (p agentPosts) FindPopularPosts(ctx context.Context, category, topic string) ([]*ent.PopularPosts, error) {
	list, err := p.Service.FindPopularPosts(ctx, category, topic)
	out := make([]*ent.PopularPosts, len(list))
	for i, pp := range list {
		out[i] = &ent.PopularPosts{Category: category, Topic: topic, Content: pp.Content, Hook: pp.Hook}
	}
	return out, err
}

func (p agentPosts) FindFreeDateTime(ctx context.Context, orgID string) (string, error) {
	return p.Service.FindFreeDateTime(ctx, orgID, "")
}

func (p agentPosts) CreatePopularPosts(ctx context.Context, pp agent.PopularPost) (*ent.PopularPosts, error) {
	return p.Service.CreatePopularPosts(ctx, posts.PopularPostInput{Category: pp.Category, Topic: pp.Topic, Content: pp.Content, Hook: pp.Hook})
}

type agentMedia struct{ *media.Service }

func (m agentMedia) SaveFile(ctx context.Context, orgID, fileName, filePath string) (*ent.Media, error) {
	saved, err := m.Service.SaveFile(ctx, orgID, fileName, filePath, "")
	return savedMedia(saved), err
}

func savedMedia(m *media.SavedMedia) *ent.Media {
	if m == nil {
		return nil
	}
	out := &ent.Media{ID: m.ID, Name: m.Name, OriginalName: m.OriginalName, Path: m.Path, Thumbnail: m.Thumbnail, Alt: m.Alt, Status: m.Status}
	if m.ProcessingError != nil {
		out.ProcessingError = *m.ProcessingError
	}
	return out
}

// AgentGraph is the generator as content.AgentGraphService: the events are
// yielded as they are emitted and a failure is yielded last.
func (a *App) AgentGraphStream() content.AgentGraphService { return agentGraph{a.AgentGraph} }

type agentGraph struct{ *agent.GraphService }

var errStopped = errors.New("stream consumer stopped")

func (g agentGraph) Start(ctx context.Context, orgID string, body *generator.GeneratorDto) iter.Seq2[any, error] {
	return func(yield func(any, error) bool) {
		err := g.GraphService.Start(ctx, orgID, body, func(e agent.Event) error {
			if !yield(e, nil) {
				return errStopped
			}
			return nil
		})
		if err != nil && !errors.Is(err, errStopped) {
			yield(nil, err)
		}
	}
}

// AgentInsertService is the insert service as content.AgentGraphInsertService.
func (a *App) AgentInsertService() content.AgentGraphInsertService { return agentInsert{a.AgentInsert} }

type agentInsert struct{ *agent.InsertService }

func (i agentInsert) NewPost(ctx context.Context, post string) (any, error) {
	return nil, i.InsertService.NewPost(ctx, post)
}

// AgentMemory is the Mastra memory as content.AgentMemory.
func (a *App) AgentMemory() content.AgentMemory { return agentMemory{a.Agent} }

type agentMemory struct{ *chat.Agent }

func (m agentMemory) Recall(ctx context.Context, resourceID, threadID string) (any, error) {
	r, err := m.Agent.Recall(ctx, resourceID, threadID)
	if err != nil {
		return nil, err
	}
	return r, nil
}

func (m agentMemory) ListThreads(ctx context.Context, resourceID string) ([]content.Thread, error) {
	list, err := m.Agent.ListThreads(ctx, resourceID)
	if err != nil || list == nil {
		return nil, err
	}
	out := make([]content.Thread, len(list.Threads))
	for i, t := range list.Threads {
		out[i] = content.Thread{ID: t.ID, Title: t.Title}
	}
	return out, nil
}

// ---- chat tools

type chatIntegrations struct{ *integration.Service }

func (i chatIntegrations) DisconnectChannel(ctx context.Context, orgID string, in *ent.Integration) error {
	return i.Service.DisconnectChannel(ctx, orgID, in, "")
}

type chatRefresh struct {
	*integration.RefreshIntegrationService
}

func (r chatRefresh) Refresh(ctx context.Context, in *ent.Integration) (*integrations.AuthTokenDetails, error) {
	return r.RefreshIntegrationService.Refresh(ctx, in, "")
}

type chatPosts struct{ *posts.Service }

func (p chatPosts) ValidatePosts(ctx context.Context, orgID string, list []postsdto.Post) ([]chat.PostValidation, error) {
	validations, err := p.Service.ValidatePosts(ctx, orgID, list)
	if err != nil {
		return nil, err
	}
	out := make([]chat.PostValidation, len(validations))
	for i, v := range validations {
		message, _ := v.Errors.(string) // true (valid media) reads as ""
		out[i] = chat.PostValidation{ID: v.ID, Identifier: v.Identifier, Name: v.Name, Valid: v.Valid, SettingsError: v.SettingsError,
			Errors: message, EmptyContent: v.EmptyContent, TooLong: v.TooLong, MaximumCharacters: v.MaximumCharacters}
	}
	return out, nil
}

func (p chatPosts) CreatePost(ctx context.Context, orgID string, body *postsdto.CreatePostDto, creationMethod string) ([]chat.CreatedPost, error) {
	created, err := p.Service.CreatePost(ctx, orgID, body, post.CreationMethod(creationMethod), false)
	if err != nil {
		return nil, err
	}
	out := make([]chat.CreatedPost, len(created))
	for i, c := range created {
		out[i] = chat.CreatedPost{PostID: c.PostID, Integration: c.Integration}
	}
	return out, nil
}

func (p chatPosts) GetPosts(ctx context.Context, orgID string, query *postsdto.GetPostsDto) ([]*ent.Post, error) {
	list, err := p.Service.GetPosts(ctx, orgID, query)
	if err != nil {
		return nil, err
	}
	out := make([]*ent.Post, len(list))
	for i, c := range list {
		out[i] = &ent.Post{ID: c.ID, PublishDate: c.PublishDate.Time, State: c.State, Error: c.Error, Content: c.Content,
			Settings: c.Settings, Group: c.Group, Edges: ent.PostEdges{Integration: &ent.Integration{
				ID: c.Integration.ID, Name: c.Integration.Name, ProviderIdentifier: c.Integration.ProviderIdentifier}}}
	}
	return out, nil
}

func (p chatPosts) UpdatePostSettings(ctx context.Context, orgID, postID string, settings map[string]any, creationMethod string) (*chat.UpdatedPostSettings, error) {
	r, err := p.Service.UpdatePostSettings(ctx, orgID, postID, settings, post.CreationMethod(creationMethod))
	if err != nil || r == nil {
		return nil, err
	}
	return &chat.UpdatedPostSettings{PostID: r.PostID, PublishDate: r.PublishDate}, nil
}

type chatMedia struct{ *media.Service }

func (m chatMedia) StartGenerateVideo(ctx context.Context, org *ent.Organization, body chat.VideoDto) (string, error) {
	params, err := json.Marshal(body.CustomParams)
	if err != nil {
		return "", err
	}
	job, err := m.Service.StartGenerateVideo(ctx, org, media.VideoDto{Type: body.Type, Output: body.Output, CustomParams: params})
	if err != nil || job == nil {
		return "", err
	}
	return job.JobID, nil
}

func (m chatMedia) GetGenerateVideoStatus(ctx context.Context, org *ent.Organization, jobID string) (*chat.VideoJob, error) {
	s, err := m.Service.GetGenerateVideoStatus(ctx, org, jobID)
	if err != nil || s == nil {
		return nil, err
	}
	return &chat.VideoJob{Status: s.Status, ID: s.ID, Path: s.Path, Error: s.Error}, nil
}

func (m chatMedia) GenerateImage(ctx context.Context, prompt string, org *ent.Organization) (string, error) {
	return m.Service.GenerateImage(ctx, prompt, org, false)
}

func (m chatMedia) SaveFile(ctx context.Context, orgID, fileName, filePath string) (*ent.Media, error) {
	saved, err := m.Service.SaveFile(ctx, orgID, fileName, filePath, "")
	return savedMedia(saved), err
}

func (m chatMedia) UploadFromURL(ctx context.Context, orgID, url string) (*ent.Media, error) {
	saved, err := m.Service.UploadFromURL(ctx, orgID, url)
	return savedMedia(saved), err
}

func (m chatMedia) GetMedia(ctx context.Context, orgID string, page int, search string) (int, []*ent.Media, error) {
	p, err := m.Service.GetMedia(ctx, orgID, page, search)
	if err != nil || p == nil {
		return 0, nil, err
	}
	out := make([]*ent.Media, len(p.Results))
	for i, r := range p.Results {
		out[i] = &ent.Media{ID: r.ID, Name: r.Name, OriginalName: r.OriginalName, Path: r.Path, Thumbnail: r.Thumbnail,
			Alt: r.Alt, ThumbnailTimestamp: r.ThumbnailTimestamp, CreatedAt: time.Time(r.CreatedAt)}
	}
	return p.Pages, out, nil
}

func (m chatMedia) GetUploadSession(ctx context.Context, orgID, sessionID string) ([]*ent.Media, error) {
	list, err := m.Service.GetUploadSession(ctx, orgID, sessionID)
	if err != nil {
		return nil, err
	}
	out := make([]*ent.Media, len(list))
	for i, s := range list {
		out[i] = savedMedia(s)
	}
	return out, nil
}

type chatSubscriptions struct{ *subscriptions.Service }

func (s chatSubscriptions) CheckCredits(ctx context.Context, org *ent.Organization, checkType string) (*chat.Credits, error) {
	credits, err := checkCredits(ctx, s.Service, org, checkType)
	if err != nil {
		return nil, err
	}
	return &chat.Credits{Credits: credits}, nil
}

type chatClipping struct{ *clipping.Service }

func (c chatClipping) StartClipping(ctx context.Context, org *ent.Organization, body chat.ClippingDto) (*ent.Clipping, error) {
	r, err := c.Service.StartClipping(ctx, org, clippingdto.ClippingDto{URL: body.URL, Integrations: body.Integrations, Clips: body.Clips, Fit: body.Fit})
	if err != nil || r == nil {
		return nil, err
	}
	return &ent.Clipping{ID: r.ID}, nil
}

func (c chatClipping) WaitForClipping(ctx context.Context, orgID, id string, seconds int) (*ent.Clipping, error) {
	d, err := c.Service.WaitForClipping(ctx, orgID, id, seconds)
	if err != nil || d == nil {
		return nil, err
	}
	out := &ent.Clipping{ID: d.ID, URL: d.URL, Status: d.Status, Error: d.Error, Title: d.Title, Thumbnail: d.Thumbnail}
	for _, clip := range d.Clips {
		out.Edges.Clips = append(out.Edges.Clips, &ent.ClippingClip{ID: clip.ID, Title: clip.Title, Content: clip.Content,
			Start: clip.Start, End: clip.End, Status: clip.Status, Error: clip.Error, MediaID: clip.MediaID, Path: clip.Path,
			Thumbnail: clip.Thumbnail})
	}
	return out, nil
}

// chatVideos lists the videos with the params DTO the schema is derived from.
type chatVideos struct{ *videos.Manager }

func (m chatVideos) GetAllVideos() []chat.Video {
	var out []chat.Video
	for _, p := range m.Manager.GetAllVideos() {
		v := m.Manager.GetVideoByName(p.Identifier)
		tools := make([]chat.VideoTool, len(p.Tools))
		for i, t := range p.Tools {
			tools[i] = chat.VideoTool{FunctionName: t.FunctionName, Output: t.Output}
		}
		var dto any
		switch p.DTOName {
		case "SeedanceParams":
			dto = &videos.SeedanceParams{}
		case "ImagesSlidesParams":
			dto = &videos.ImagesSlidesParams{}
		}
		out = append(out, chat.Video{Identifier: p.Identifier, Title: p.Title, Tools: tools, DTO: dto,
			Call: func(ctx context.Context, functionName string) (any, error) {
				fn := v.Instance.Functions()[functionName]
				if fn == nil {
					return nil, errors.New("Function not found")
				}
				return fn(ctx, nil)
			}})
	}
	return out
}
