// Package activities is the orchestrator's activity layer
// (apps/orchestrator/src/activities). This file is the TS<->Go wire contract:
// every activity name exactly as the TypeScript worker registers it (the
// method name), and the payload types its arguments and results travel as.
// The JSON shapes match what the TypeScript side sends (Prisma rows with
// camelCase keys, Date as ISO strings, null for empty columns, sensitive
// columns such as integration.token included because activities read them
// from the payload), so a Go worker and a TypeScript worker can poll the same
// task queues.
//
// Arguments are positional, like the TypeScript methods. Optional trailing
// arguments may be missing on the wire (the Go SDK leaves them at their zero
// value) or arrive as null.
package activities

import (
	"bytes"
	"context"
	"encoding/json"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/integrations"
)

// PostActivity (post.activity.ts). Every method runs on the queue the
// workflow picks: "main" or the provider queue (identifier before "-").
const (
	// getIntegrationById(orgId: string, id: string): Integration | null
	GetIntegrationByID = "getIntegrationById"
	// searchForMissingThreeHoursPosts(): void
	SearchForMissingThreeHoursPosts = "searchForMissingThreeHoursPosts"
	// updatePost(id: string, postId: string, releaseURL: string): void
	UpdatePost = "updatePost"
	// getPost(orgId: string, postId: string): false | Post
	GetPost = "getPost"
	// getPostsList(orgId: string, postId: string): Post[]
	GetPostsList = "getPostsList"
	// isCommentable(integration: Integration): boolean
	IsCommentable = "isCommentable"
	// postComment(postId: string, lastPostId: string | undefined,
	//   integration: Integration, posts: Post[]): PostResponse[]
	PostComment = "postComment"
	// postSocial(integration: Integration, posts: Post[]): PostResponse[]
	PostSocial = "postSocial"
	// postSocialPending(integration: Integration, posts: Post[]): PostResponse[]
	PostSocialPending = "postSocialPending"
	// checkPostStatus(integration: Integration, pendingData: any): PendingCheckResponse
	CheckPostStatus = "checkPostStatus"
	// finalizePost(integration: Integration, pendingData: any): PendingCheckResponse
	FinalizePost = "finalizePost"
	// inAppNotification(orgId: string, subject: string, message: string,
	//   sendEmail = false, digest = false, type: NotificationType = 'success'): void
	InAppNotification = "inAppNotification"
	// globalPlugs(integration: Integration): GlobalPlug[]
	GlobalPlugs = "globalPlugs"
	// changeState(id: string, state: State, err?: any, body?: any): void
	ChangeState = "changeState"
	// internalPlugs(integration: Integration, settings: any): InternalPlug[]
	InternalPlugs = "internalPlugs"
	// sendWebhooks(postId: string, orgId: string, integrationId: string): void
	SendWebhooks = "sendWebhooks"
	// processPlug(data: {plugId, postId, delay, totalRuns, currentRun}): boolean
	ProcessPlug = "processPlug"
	// processInternalPlug(data: {post, originalIntegration, integration,
	//   plugName, orgId, delay, information}): void
	ProcessInternalPlug = "processInternalPlug"
	// refreshToken(integration: Integration): false | AuthTokenDetails
	//
	// IntegrationsActivity also has a refreshToken method, but it is not an
	// @ActivityMethod: "refreshToken" is always PostActivity's.
	RefreshToken = "refreshToken"
	// refreshTokenWithCause(integration: Integration, cause: string): false | AuthTokenDetails
	RefreshTokenWithCause = "refreshTokenWithCause"
)

// IntegrationsActivity (integrations.activity.ts).
const (
	// getIntegrationsById(id: string, orgId: string): Integration | null
	// (note the argument order, reversed from getIntegrationById)
	GetIntegrationsByID = "getIntegrationsById"
)

// EmailActivity (email.activity.ts).
const (
	// sendEmail(to: string, subject: string, html: string, replyTo?: string)
	SendEmail = "sendEmail"
	// sendEmailAsync(to: string, subject: string, html: string,
	//   sendTo: 'top' | 'bottom', replyTo?: string)
	SendEmailAsync = "sendEmailAsync"
	// getUserOrgs(id: string): Team | null
	GetUserOrgs = "getUserOrgs"
	// setStreak(organizationId: string, type: 'start' | 'end'): void
	SetStreak = "setStreak"
	// getLastPublishDate(organizationId: string): number | null (epoch ms)
	GetLastPublishDate = "getLastPublishDate"
)

// MediaActivity (media.activity.ts).
const (
	// submitMediaProcessing(mediaId: string): string | null (job id)
	SubmitMediaProcessing = "submitMediaProcessing"
	// checkMediaProcessing(mediaId: string, jobId: string): boolean (final)
	CheckMediaProcessing = "checkMediaProcessing"
	// failMediaProcessing(mediaId: string, error: string): void
	FailMediaProcessing = "failMediaProcessing"
)

// VideoActivity (video.activity.ts).
const (
	// generateVideo(organizationId: string, body: VideoDto): Media
	GenerateVideo = "generateVideo"
)

// AutopostActivity (autopost.activity.ts).
const (
	// autoPost(id: string): void
	AutoPost = "autoPost"
)

// ClippingActivity (clipping.activity.ts). Every activity takes a single
// object of ids so fields can be added without a new activity.
const (
	// submitClippingAnalyse({clippingId}): string (job id)
	SubmitClippingAnalyse = "submitClippingAnalyse"
	// checkClippingAnalyse({clippingId, jobId}): {state, transcribe?}
	CheckClippingAnalyse = "checkClippingAnalyse"
	// transcribeClipping({clippingId}): void
	TranscribeClipping = "transcribeClipping"
	// pickClippingClips({clippingId}): string[] (clip ids)
	PickClippingClips = "pickClippingClips"
	// submitClipFetch({clipId}): string (job id)
	SubmitClipFetch = "submitClipFetch"
	// checkClipFetch({clipId, jobId}): {state}
	CheckClipFetch = "checkClipFetch"
	// captionClip({clipId}): void
	CaptionClip = "captionClip"
	// submitClipRender({clipId}): string (job id)
	SubmitClipRender = "submitClipRender"
	// checkClipRender({clipId, jobId}): {state}
	CheckClipRender = "checkClipRender"
	// failClip({clipId, error, customer?}): void
	FailClip = "failClip"
	// createClippingDrafts({clippingId}): void
	CreateClippingDrafts = "createClippingDrafts"
	// finishClipping({clippingId}): Clipping row (the workflow's result)
	FinishClipping = "finishClipping"
	// failClipping({clippingId, error, customer?}): Clipping row (the workflow's result)
	FailClipping = "failClipping"
)

// TypeClippingStop is the application failure type of a clipping error
// written for the customer to read.
const TypeClippingStop = "clipping_stop"

// Post states (Prisma State enum).
const (
	StateQueue     = "QUEUE"
	StatePublished = "PUBLISHED"
	StateError     = "ERROR"
	StateDraft     = "DRAFT"
)

// PostActivity is the Go side of post.activity.ts; register each method
// under the matching constant above.
type PostActivity interface {
	GetIntegrationByID(ctx context.Context, orgID, id string) (*Integration, error)
	// Signal-with-starts postWorkflowV112 (id post_<id>, signal poke, USE_EXISTING).
	SearchForMissingThreeHoursPosts(ctx context.Context) error
	UpdatePost(ctx context.Context, id, postID, releaseURL string) error
	// false when the organization has no subscription (with
	// STRIPE_SECRET_KEY) or the post is deleted; a repeating QUEUE post's
	// publishDate is re-anchored to its next occurrence.
	GetPost(ctx context.Context, orgID, postID string) (OrFalse[Post], error)
	// [root, ...comments], slimmed (see Post); [] when missing.
	GetPostsList(ctx context.Context, orgID, postID string) ([]Post, error)
	IsCommentable(ctx context.Context, integration *Integration) (bool, error)
	// lastPostID is undefined (nil) for the first comment.
	PostComment(ctx context.Context, postID string, lastPostID *string, integration *Integration, posts []Post) ([]integrations.PostResponse, error)
	PostSocial(ctx context.Context, integration *Integration, posts []Post) ([]integrations.PostResponse, error)
	PostSocialPending(ctx context.Context, integration *Integration, posts []Post) ([]integrations.PostResponse, error)
	CheckPostStatus(ctx context.Context, integration *Integration, pendingData json.RawMessage) (*integrations.PendingCheckResponse, error)
	FinalizePost(ctx context.Context, integration *Integration, pendingData json.RawMessage) (*integrations.PendingCheckResponse, error)
	// Workflows send 5 arguments for success notifications: an empty
	// notificationType means 'success'.
	InAppNotification(ctx context.Context, orgID, subject, message string, sendEmail, digest bool, notificationType string) error
	GlobalPlugs(ctx context.Context, integration *Integration) ([]GlobalPlug, error)
	// errValue is a JSON string (stored as is) or a serialized workflow
	// failure object (stored JSON.stringify'd); body is the post list.
	// Either may be missing.
	ChangeState(ctx context.Context, id, state string, errValue, body json.RawMessage) error
	// settings is JSON.parse(post.settings): an object, or null.
	InternalPlugs(ctx context.Context, integration *Integration, settings json.RawMessage) ([]InternalPlug, error)
	// Best effort: never fails.
	SendWebhooks(ctx context.Context, postID, orgID, integrationID string) error
	ProcessPlug(ctx context.Context, data ProcessPlugInput) (bool, error)
	ProcessInternalPlug(ctx context.Context, data InternalPlug) error
	RefreshToken(ctx context.Context, integration *Integration) (OrFalse[integrations.AuthTokenDetails], error)
	RefreshTokenWithCause(ctx context.Context, integration *Integration, cause string) (OrFalse[integrations.AuthTokenDetails], error)
}

// IntegrationsActivity is the Go side of integrations.activity.ts.
type IntegrationsActivity interface {
	GetIntegrationsByID(ctx context.Context, id, orgID string) (*Integration, error)
}

// EmailActivity is the Go side of email.activity.ts. The send results are
// never read by a workflow.
type EmailActivity interface {
	SendEmail(ctx context.Context, to, subject, html string, replyTo *string) error
	// sendTo is 'top' or 'bottom'.
	SendEmailAsync(ctx context.Context, to, subject, html, sendTo string, replyTo *string) error
	GetUserOrgs(ctx context.Context, id string) (*Team, error)
	// streakType is 'start' or 'end'.
	SetStreak(ctx context.Context, organizationID, streakType string) error
	GetLastPublishDate(ctx context.Context, organizationID string) (*int64, error)
}

// MediaActivity is the Go side of media.activity.ts.
type MediaActivity interface {
	SubmitMediaProcessing(ctx context.Context, mediaID string) (*string, error)
	CheckMediaProcessing(ctx context.Context, mediaID, jobID string) (bool, error)
	FailMediaProcessing(ctx context.Context, mediaID, errMessage string) error
}

// VideoActivity is the Go side of video.activity.ts. The result is the saved
// Media row, which generateVideoWorkflow returns to its caller.
type VideoActivity interface {
	GenerateVideo(ctx context.Context, organizationID string, body VideoBody) (json.RawMessage, error)
}

// AutopostActivity is the Go side of autopost.activity.ts.
type AutopostActivity interface {
	AutoPost(ctx context.Context, id string) error
}

// ClippingActivity is the Go side of clipping.activity.ts.
type ClippingActivity interface {
	SubmitClippingAnalyse(ctx context.Context, in ClippingRef) (string, error)
	CheckClippingAnalyse(ctx context.Context, in ClippingJobRef) (ClippingJobResult, error)
	TranscribeClipping(ctx context.Context, in ClippingRef) error
	PickClippingClips(ctx context.Context, in ClippingRef) ([]string, error)
	SubmitClipFetch(ctx context.Context, in ClipRef) (string, error)
	CheckClipFetch(ctx context.Context, in ClipJobRef) (ClippingJobResult, error)
	CaptionClip(ctx context.Context, in ClipRef) error
	SubmitClipRender(ctx context.Context, in ClipRef) (string, error)
	CheckClipRender(ctx context.Context, in ClipJobRef) (ClippingJobResult, error)
	FailClip(ctx context.Context, in FailClipInput) error
	CreateClippingDrafts(ctx context.Context, in ClippingRef) error
	FinishClipping(ctx context.Context, in ClippingRef) (json.RawMessage, error)
	FailClipping(ctx context.Context, in FailClippingInput) (json.RawMessage, error)
}

// JSDate is a Prisma DateTime on the wire: JSON.stringify(Date), e.g.
// "2024-01-02T03:04:05.000Z".
type JSDate struct{ time.Time }

func (d JSDate) MarshalJSON() ([]byte, error) {
	return json.Marshal(d.UTC().Format("2006-01-02T15:04:05.000Z"))
}

// OrFalse is TypeScript's `false | T`: JSON false (or null) is V == nil.
type OrFalse[T any] struct{ V *T }

func (o OrFalse[T]) MarshalJSON() ([]byte, error) {
	if o.V == nil {
		return []byte("false"), nil
	}
	return json.Marshal(o.V)
}

func (o *OrFalse[T]) UnmarshalJSON(data []byte) error {
	switch string(bytes.TrimSpace(data)) {
	case "false", "null":
		o.V = nil
		return nil
	}
	o.V = new(T)
	return json.Unmarshal(data, o.V)
}

// Integration is the full Prisma Integration row, token included.
type Integration struct {
	ID                    string  `json:"id"`
	InternalID            string  `json:"internalId"`
	OrganizationID        string  `json:"organizationId"`
	Name                  string  `json:"name"`
	CustomName            *string `json:"customName"`
	Picture               *string `json:"picture"`
	ProviderIdentifier    string  `json:"providerIdentifier"`
	Type                  string  `json:"type"`
	Token                 string  `json:"token"`
	Disabled              bool    `json:"disabled"`
	TokenExpiration       *JSDate `json:"tokenExpiration"`
	RefreshToken          *string `json:"refreshToken"`
	Profile               *string `json:"profile"`
	DeletedAt             *JSDate `json:"deletedAt"`
	CreatedAt             JSDate  `json:"createdAt"`
	UpdatedAt             *JSDate `json:"updatedAt"`
	InBetweenSteps        bool    `json:"inBetweenSteps"`
	RefreshNeeded         bool    `json:"refreshNeeded"`
	PostingTimes          string  `json:"postingTimes"`
	CustomInstanceDetails *string `json:"customInstanceDetails"`
	CustomerID            *string `json:"customerId"`
	RootInternalID        *string `json:"rootInternalId"`
	AdditionalSettings    *string `json:"additionalSettings"`
}

// Post is a Prisma Post row as getPost / getPostsList return it. The root
// post carries its integration; comments don't. getPostsList strips the
// fields marked omitempty (slimPost); getPost returns them, plus
// submittedForOrder.
type Post struct {
	ID             string       `json:"id"`
	State          string       `json:"state"`
	PublishDate    JSDate       `json:"publishDate"`
	OrganizationID string       `json:"organizationId"`
	IntegrationID  string       `json:"integrationId"`
	Content        string       `json:"content"`
	Delay          int          `json:"delay"`
	Group          string       `json:"group"`
	BatchID        *string      `json:"batchId"`
	ReleaseID      *string      `json:"releaseId"`
	ReleaseURL     *string      `json:"releaseURL"`
	Settings       *string      `json:"settings"`
	Image          *string      `json:"image"`
	CreationMethod string       `json:"creationMethod"`
	IntervalInDays *int         `json:"intervalInDays"`
	Integration    *Integration `json:"integration,omitempty"`

	Title                      *string         `json:"title,omitempty"`
	Description                *string         `json:"description,omitempty"`
	ParentPostID               *string         `json:"parentPostId,omitempty"`
	SubmittedForOrderID        *string         `json:"submittedForOrderId,omitempty"`
	SubmittedForOrganizationID *string         `json:"submittedForOrganizationId,omitempty"`
	ApprovedSubmitForOrder     string          `json:"approvedSubmitForOrder,omitempty"`
	LastMessageID              *string         `json:"lastMessageId,omitempty"`
	Error                      *string         `json:"error,omitempty"`
	CreatedAt                  *JSDate         `json:"createdAt,omitempty"`
	UpdatedAt                  *JSDate         `json:"updatedAt,omitempty"`
	DeletedAt                  *JSDate         `json:"deletedAt,omitempty"`
	SubmittedForOrder          json.RawMessage `json:"submittedForOrder,omitempty"`
}

// GlobalPlug is one entry of checkPlugs: delay is the plug's
// runEveryMilliseconds.
type GlobalPlug struct {
	Type      string  `json:"type"` // "global"
	PlugID    string  `json:"plugId"`
	Delay     float64 `json:"delay"`
	TotalRuns int     `json:"totalRuns"`
}

// ProcessPlugInput is what the workflow sends to processPlug: the global plug
// with delay multiplied by the run number, plus the platform post id.
// currentRun is never sent by the workflows.
type ProcessPlugInput struct {
	Type       string  `json:"type,omitempty"`
	PlugID     string  `json:"plugId"`
	Delay      float64 `json:"delay"`
	TotalRuns  int     `json:"totalRuns"`
	PostID     string  `json:"postId"`
	CurrentRun *int    `json:"currentRun,omitempty"`
}

// InternalPlug is one entry of checkInternalPlug, and the processInternalPlug
// argument (with post replaced by the platform post id). delay is
// +trigger.delay, so NaN arrives as null.
type InternalPlug struct {
	Type                string          `json:"type,omitempty"` // "internal-plug"
	Post                string          `json:"post"`
	OriginalIntegration string          `json:"originalIntegration"`
	Integration         string          `json:"integration"`
	PlugName            string          `json:"plugName"`
	OrgID               string          `json:"orgId"`
	Delay               *float64        `json:"delay"`
	Information         json.RawMessage `json:"information"`
}

// Team is getTeam's select.
type Team struct {
	Users []TeamMember `json:"users"`
}

type TeamMember struct {
	Role     string   `json:"role"`
	Disabled bool     `json:"disabled"`
	User     TeamUser `json:"user"`
}

type TeamUser struct {
	Email             string `json:"email"`
	ID                string `json:"id"`
	SendSuccessEmails bool   `json:"sendSuccessEmails"`
	SendFailureEmails bool   `json:"sendFailureEmails"`
	SendStreakEmails  bool   `json:"sendStreakEmails"`
}

// VideoBody is VideoDto.
type VideoBody struct {
	Type         string          `json:"type"`
	Output       string          `json:"output"` // vertical | horizontal
	CustomParams json.RawMessage `json:"customParams,omitempty"`
}

type ClippingRef struct {
	ClippingID string `json:"clippingId"`
}

type ClippingJobRef struct {
	ClippingID string `json:"clippingId"`
	JobID      string `json:"jobId"`
}

type ClipRef struct {
	ClipID string `json:"clipId"`
}

type ClipJobRef struct {
	ClipID string `json:"clipId"`
	JobID  string `json:"jobId"`
}

// Clipping job states (ClippingJobState).
const (
	JobPending = "pending"
	JobRetry   = "retry"
	JobDone    = "done"
	JobFailed  = "failed"
)

// ClippingJobResult is a check answer; transcribe only comes from
// checkClippingAnalyse.
type ClippingJobResult struct {
	State      string `json:"state"`
	Transcribe *bool  `json:"transcribe,omitempty"`
}

// FailClipInput: customer says the error was written for the customer.
type FailClipInput struct {
	ClipID   string `json:"clipId"`
	Error    string `json:"error"`
	Customer bool   `json:"customer"`
}

type FailClippingInput struct {
	ClippingID string `json:"clippingId"`
	Error      string `json:"error"`
	Customer   bool   `json:"customer"`
}
