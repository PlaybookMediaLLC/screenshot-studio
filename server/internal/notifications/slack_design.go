package notifications

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
)

// importLegacy verifies the team before replacing the web ciphertext. Unknown app identity stays separate.
func (s *Service) importLegacy(ctx context.Context, org, id string) error {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var ciphertext, team, name string
	var scopes []byte
	var owner sql.NullString
	var expires sql.NullTime
	err = tx.QueryRowContext(ctx, `SELECT "encryptedCredentials","externalId","displayName",scopes,"createdByUserId","tokenExpiresAt" FROM integration_connection WHERE id=$1 AND "organizationId"=$2 AND provider='SLACK' FOR UPDATE`, id, org).Scan(&ciphertext, &team, &name, &scopes, &owner, &expires)
	if errors.Is(err, sql.ErrNoRows) {
		return publishing.ErrNotFound
	}
	if err != nil {
		return err
	}
	var imported bool
	if err = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM platform_slack_connection WHERE id=$1 AND "organizationId"=$2)`, id, org).Scan(&imported); err != nil {
		return err
	}
	if imported {
		return nil
	}
	if !strings.HasPrefix(ciphertext, "v1.") {
		return &slackError{Code: "reconnect_required"}
	}
	clear, err := openLegacy(ciphertext)
	if err != nil {
		return ErrUnavailable
	}
	var credentials slackCredentials
	if json.Unmarshal(clear, &credentials) != nil || credentials.AccessToken == "" {
		return ErrUnavailable
	}
	result, err := s.slackAPI(ctx, credentials.AccessToken, "auth.test", map[string]any{})
	if err != nil {
		return err
	}
	var verifiedTeam string
	if json.Unmarshal(result["team_id"], &verifiedTeam) != nil || verifiedTeam != team {
		return &slackError{Code: "installation_identity_mismatch"}
	}
	var granted []string
	if json.Unmarshal(scopes, &granted) != nil {
		return ErrUnavailable
	}
	grant := &slackGrant{AppID: "legacy:" + id, AccessToken: credentials.AccessToken, RefreshToken: credentials.RefreshToken, Scope: strings.Join(granted, ",")}
	grant.Team.ID, grant.Team.Name = team, name
	if expires.Valid {
		grant.ExpiresIn = max(1, int(time.Until(expires.Time).Seconds()))
	}
	_, err = s.saveInstallationTx(ctx, tx, Principal{OrganizationID: org, UserID: owner.String}, grant, id, true)
	if err != nil {
		return err
	}
	return tx.Commit()
}

// SlackDesign contains only an authorized asset and its live share link.
type SlackDesign struct {
	Bytes                                                             []byte
	Filename, MediaType, Title, AltText, ShareURL, Message, ChannelID string
}

// UploadDesign preserves the existing Slack file delivery behind the backend installation lifecycle.
func (s *Service) UploadDesign(ctx context.Context, org, id string, design SlackDesign) error {
	if len(design.Bytes) == 0 || len(design.Bytes) > 100*1024*1024 || !slackID.MatchString(design.ChannelID) {
		return ErrInvalid
	}
	_, err := s.ValidateChannel(ctx, org, id, design.ChannelID)
	var provider *slackError
	if errors.As(err, &provider) && provider.Code == "not_in_channel" && strings.HasPrefix(design.ChannelID, "C") {
		_, err = s.connectionCall(ctx, org, id, "conversations.join", map[string]any{"channel": design.ChannelID})
		if err == nil {
			_, err = s.ValidateChannel(ctx, org, id, design.ChannelID)
		}
	}
	if err != nil {
		return err
	}
	ticket, err := s.connectionCall(ctx, org, id, "files.getUploadURLExternal", map[string]any{"filename": design.Filename, "length": len(design.Bytes), "alt_txt": design.AltText})
	if err != nil {
		return err
	}
	var uploadURL, fileID string
	if json.Unmarshal(ticket["upload_url"], &uploadURL) != nil || json.Unmarshal(ticket["file_id"], &fileID) != nil || fileID == "" {
		return &slackError{Code: "malformed_upload_ticket"}
	}
	target, err := url.Parse(uploadURL)
	if err != nil || !validSlackUpload(target) {
		return &slackError{Code: "invalid_upload_destination"}
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, target.String(), bytes.NewReader(design.Bytes))
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", design.MediaType)
	client := *s.HTTP
	client.CheckRedirect = func(req *http.Request, via []*http.Request) error {
		if len(via) > 5 || !validSlackUpload(req.URL) {
			return ErrInvalid
		}
		return nil
	}
	response, err := client.Do(request)
	if err != nil {
		return &slackError{Code: "upload_transport_uncertain", Uncertain: true}
	}
	_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 64*1024))
	response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return &slackError{Code: "upload_rejected", Uncertain: response.StatusCode >= 500}
	}
	_, err = s.pacedSlackCall(ctx, org, id, design.ChannelID, "files.completeUploadExternal", map[string]any{"channel_id": design.ChannelID, "files": []map[string]string{{"id": fileID, "title": design.Title}}, "initial_comment": escapeSlack(strings.TrimSpace(design.Message) + "\n\n" + design.ShareURL)})
	return err
}
func validSlackUpload(u *url.URL) bool {
	return u != nil && u.Scheme == "https" && u.User == nil && u.Port() == "" && strings.HasSuffix(u.Hostname(), ".slack.com")
}
