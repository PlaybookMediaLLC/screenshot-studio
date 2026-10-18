package activities

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/database/autopost"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/database/clipping"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/database/integration"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/database/media"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/database/organizations"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/httpx"
	"go.temporal.io/sdk/client"
)

var (
	_ IntegrationsActivity = (*IntegrationsActivities)(nil)
	_ EmailActivity        = (*EmailActivities)(nil)
	_ AutopostActivity     = (*AutopostActivities)(nil)
	_ VideoActivity        = (*VideoActivities)(nil)
	_ MediaActivity        = (*MediaActivities)(nil)
	_ ClippingActivity     = (*ClippingActivities)(nil)
)

// IntegrationsActivities are the integrations activities. Its refreshToken is
// not an @ActivityMethod, so it is not ported here.
type IntegrationsActivities struct {
	integrations *integration.Service
}

func NewIntegrationsActivities(integrationService *integration.Service) *IntegrationsActivities {
	return &IntegrationsActivities{integrations: integrationService}
}

func (a *IntegrationsActivities) GetIntegrationsByID(ctx context.Context, id, orgID string) (*Integration, error) {
	i, err := a.integrations.GetIntegrationByID(ctx, orgID, id)
	return toIntegration(i), err
}

// EmailService is the part of the email service the email activity
// uses (satisfied by *email.Service).
type EmailService interface {
	SendEmail(ctx context.Context, to, subject, html, addTo, replyTo string) (client.WorkflowRun, error)
	SendEmailSync(ctx context.Context, to, subject, html, replyTo string)
}

// EmailActivities are the email activities.
type EmailActivities struct {
	email         EmailService
	organizations *organizations.Service
}

func NewEmailActivities(emailService EmailService, organizationService *organizations.Service) *EmailActivities {
	return &EmailActivities{email: emailService, organizations: organizationService}
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func (a *EmailActivities) SendEmail(ctx context.Context, to, subject, html string, replyTo *string) error {
	a.email.SendEmailSync(ctx, to, subject, html, deref(replyTo))
	return nil
}

func (a *EmailActivities) SendEmailAsync(ctx context.Context, to, subject, html, sendTo string, replyTo *string) error {
	_, err := a.email.SendEmail(ctx, to, subject, html, sendTo, deref(replyTo))
	return err
}

func (a *EmailActivities) GetUserOrgs(ctx context.Context, id string) (*Team, error) {
	team, err := a.organizations.GetTeam(ctx, id)
	if err != nil || team == nil {
		return nil, err
	}
	out := &Team{Users: make([]TeamMember, 0, len(team.Users))}
	for _, u := range team.Users {
		out.Users = append(out.Users, TeamMember{Role: string(u.Role), Disabled: u.Disabled, User: TeamUser{
			Email: u.User.Email, ID: u.User.ID, SendSuccessEmails: u.User.SendSuccessEmails,
			SendFailureEmails: u.User.SendFailureEmails, SendStreakEmails: u.User.SendStreakEmails,
		}})
	}
	return out, nil
}

func (a *EmailActivities) SetStreak(ctx context.Context, organizationID, streakType string) error {
	a.organizations.SetStreak(ctx, organizationID, streakType)
	return nil
}

func (a *EmailActivities) GetLastPublishDate(ctx context.Context, organizationID string) (*int64, error) {
	return a.organizations.GetLastPublishDate(ctx, organizationID)
}

// AutopostActivities are the autopost activities.
type AutopostActivities struct {
	autopost *autopost.Service
}

func NewAutopostActivities(autopostService *autopost.Service) *AutopostActivities {
	return &AutopostActivities{autopost: autopostService}
}

func (a *AutopostActivities) AutoPost(ctx context.Context, id string) error {
	return a.autopost.StartAutopost(ctx, id)
}

// VideoActivities are the video activities.
type VideoActivities struct {
	media         *media.Service
	organizations *organizations.Service
}

func NewVideoActivities(mediaService *media.Service, organizationService *organizations.Service) *VideoActivities {
	return &VideoActivities{media: mediaService, organizations: organizationService}
}

func (a *VideoActivities) GenerateVideo(ctx context.Context, organizationID string, body VideoBody) (json.RawMessage, error) {
	// credits are checked against the subscription, so it has to be loaded with the org
	org, err := a.organizations.GetOrgByIDWithSubscription(ctx, organizationID)
	if err != nil {
		return nil, err
	}
	if org == nil {
		return nil, errors.New("Organization not found")
	}

	saved, err := a.media.GenerateVideo(ctx, org, media.VideoDto{Type: body.Type, Output: body.Output, CustomParams: body.CustomParams})
	if err != nil {
		// only the message survives the workflow failure, and a SubscriptionException's is not readable
		var sub *media.SubscriptionError
		var he *httpx.Error
		if errors.As(err, &sub) || (errors.As(err, &he) && he.Status == 402) {
			return nil, errors.New("No AI video credits are available on this account.")
		}
		return nil, err
	}
	return json.Marshal(saved)
}

// MediaActivities are the media activities.
type MediaActivities struct {
	media *media.Service
}

func NewMediaActivities(mediaService *media.Service) *MediaActivities {
	return &MediaActivities{media: mediaService}
}

// SubmitMediaProcessing returns the processor job id, or null when there is
// nothing to process.
func (a *MediaActivities) SubmitMediaProcessing(ctx context.Context, mediaID string) (*string, error) {
	jobID, err := a.media.SubmitProcessing(ctx, mediaID)
	if err != nil || jobID == "" {
		return nil, err
	}
	return &jobID, nil
}

// CheckMediaProcessing returns true once the media record is final (ready or failed).
func (a *MediaActivities) CheckMediaProcessing(ctx context.Context, mediaID, jobID string) (bool, error) {
	return a.media.CheckProcessing(ctx, mediaID, jobID)
}

func (a *MediaActivities) FailMediaProcessing(ctx context.Context, mediaID, errMessage string) error {
	_, err := a.media.FailProcessing(ctx, mediaID, errMessage)
	return err
}

// ClippingActivities are the clipping activities. An activity on main can never
// change its parameters, so every one takes a single object of ids: the
// state lives on the clipping records, and a field can be added to the
// object without a new activity.
type ClippingActivities struct {
	clipping *clipping.Service
	repo     *clipping.Repository
}

// NewClippingActivities: repo reads back the {id, status} row that
// finishClipping / failClipping return in TypeScript.
func NewClippingActivities(clippingService *clipping.Service, repo *clipping.Repository) *ClippingActivities {
	return &ClippingActivities{clipping: clippingService, repo: repo}
}

func jobResult(j *clipping.JobCheck, err error) (ClippingJobResult, error) {
	if err != nil || j == nil {
		return ClippingJobResult{}, err
	}
	return ClippingJobResult{State: j.State, Transcribe: j.Transcribe}, nil
}

func (a *ClippingActivities) SubmitClippingAnalyse(ctx context.Context, in ClippingRef) (string, error) {
	return a.clipping.SubmitAnalyse(ctx, in.ClippingID)
}

func (a *ClippingActivities) CheckClippingAnalyse(ctx context.Context, in ClippingJobRef) (ClippingJobResult, error) {
	return jobResult(a.clipping.CheckAnalyse(ctx, in.ClippingID, in.JobID))
}

func (a *ClippingActivities) TranscribeClipping(ctx context.Context, in ClippingRef) error {
	return a.clipping.Transcribe(ctx, in.ClippingID)
}

func (a *ClippingActivities) PickClippingClips(ctx context.Context, in ClippingRef) ([]string, error) {
	return a.clipping.PickClips(ctx, in.ClippingID)
}

func (a *ClippingActivities) SubmitClipFetch(ctx context.Context, in ClipRef) (string, error) {
	return a.clipping.SubmitClipFetch(ctx, in.ClipID)
}

func (a *ClippingActivities) CheckClipFetch(ctx context.Context, in ClipJobRef) (ClippingJobResult, error) {
	return jobResult(a.clipping.CheckClipFetch(ctx, in.ClipID, in.JobID))
}

func (a *ClippingActivities) CaptionClip(ctx context.Context, in ClipRef) error {
	return a.clipping.CaptionClip(ctx, in.ClipID)
}

func (a *ClippingActivities) SubmitClipRender(ctx context.Context, in ClipRef) (string, error) {
	return a.clipping.SubmitClipRender(ctx, in.ClipID)
}

func (a *ClippingActivities) CheckClipRender(ctx context.Context, in ClipJobRef) (ClippingJobResult, error) {
	return jobResult(a.clipping.CheckClipRender(ctx, in.ClipID, in.JobID))
}

// FailClip: customer says the error was written for the customer to read.
func (a *ClippingActivities) FailClip(ctx context.Context, in FailClipInput) error {
	return a.clipping.FailClip(ctx, in.ClipID, in.Error, in.Customer)
}

func (a *ClippingActivities) CreateClippingDrafts(ctx context.Context, in ClippingRef) error {
	return a.clipping.CreateDrafts(ctx, in.ClippingID)
}

func (a *ClippingActivities) FinishClipping(ctx context.Context, in ClippingRef) (json.RawMessage, error) {
	return a.clippingRow(ctx, in.ClippingID, a.clipping.FinishClipping(ctx, in.ClippingID))
}

func (a *ClippingActivities) FailClipping(ctx context.Context, in FailClippingInput) (json.RawMessage, error) {
	return a.clippingRow(ctx, in.ClippingID, a.clipping.FailClipping(ctx, in.ClippingID, in.Error, in.Customer))
}

// clippingRow is updateClipping's select ({id, status}), or null when the
// clipping does not exist.
func (a *ClippingActivities) clippingRow(ctx context.Context, id string, err error) (json.RawMessage, error) {
	if err != nil {
		return nil, err
	}
	c, err := a.repo.GetClippingByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if c == nil {
		return json.RawMessage("null"), nil
	}
	return json.Marshal(clipping.StatusResult{ID: c.ID, Status: c.Status})
}
