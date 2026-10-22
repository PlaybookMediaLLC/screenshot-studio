// Package notifications owns workspace activity policy, recipient inbox state and delivery.
package notifications

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"slices"
	"strings"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/activity"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
	"github.com/lucsky/cuid"
)

var ErrInvalid = errors.New("invalid notification input")
var ErrUnavailable = errors.New("notification provider is not configured")
var ErrRateLimit = errors.New("wait a minute before sending another test")

type Principal struct{ OrganizationID, UserID, SessionID, Kind string }
type Channels struct {
	InApp bool `json:"inApp"`
	Email bool `json:"email"`
	Slack bool `json:"slack"`
}
type Policy struct {
	Availability      *Channels           `json:"availability"`
	Events            map[string]Channels `json:"events"`
	Generation        int                 `json:"generation"`
	SlackConnectionID string              `json:"slackConnectionId"`
	SlackChannelID    string              `json:"slackChannelId"`
	SlackChannelName  string              `json:"slackChannelName"`
}
type Preferences struct {
	Events     map[string]Channels `json:"events"`
	Generation int                 `json:"generation"`
	// SocialSets turns activity kinds off for one social set (RFC 043): set
	// ID, then kind, false for off. A kind not listed follows Events.
	SocialSets map[string]map[string]bool `json:"socialSets"`
}

// socialSetAllows reports whether the person wants kind for the set.
func (p Preferences) socialSetAllows(setID, kind string) bool {
	if setID == "" {
		return true
	}
	on, listed := p.SocialSets[setID][kind]
	return !listed || on
}

type Settings struct {
	Effective      map[string]map[string]ChannelDecision `json:"effective"`
	Catalogue      []activity.Definition                 `json:"catalogue"`
	Policy         Policy                                `json:"policy"`
	Preferences    Preferences                           `json:"preferences"`
	CanManage      bool                                  `json:"canManage"`
	EmailAvailable bool                                  `json:"emailAvailable"`
	SlackAvailable bool                                  `json:"slackAvailable"`
	Connections    []SlackConnection                     `json:"connections"`
}
type Item struct {
	SourceSocialSet                             *SourceSocialSet `json:"sourceSocialSet"`
	Category                                    string           `json:"category"`
	ReadAt                                      *time.Time       `json:"readAt"`
	ArchivedAt                                  *time.Time       `json:"archivedAt"`
	ID                                          string           `json:"id"`
	Kind                                        string           `json:"kind"`
	Description                                 string           `json:"description"`
	Href                                        string           `json:"href"`
	WorkspaceID                                 string           `json:"workspaceId"`
	WorkspaceName                               string           `json:"workspaceName"`
	CreatedAt                                   time.Time        `json:"createdAt"`
	resourceType, resourceID, sourceSocialSetID string
}
type Page struct {
	Items       []Item `json:"items"`
	NextCursor  string `json:"nextCursor"`
	UnseenCount int    `json:"unseenCount"`
}
type SeenResult struct {
	Deleted     int `json:"deleted"`
	UnseenCount int `json:"unseenCount"`
}
type Service struct {
	DB        *sql.DB
	auth      *publishing.Repository
	HTTP      *http.Client
	SlackBase string
	EmailBase string
	Send      func(context.Context, Delivery, Envelope) (Outcome, error)
}

func New(db *sql.DB, client *ent.Client) *Service {
	s := &Service{DB: db, auth: publishing.NewRepository(client), HTTP: &http.Client{Timeout: 15 * time.Second}, SlackBase: "https://slack.com", EmailBase: "https://api.resend.com"}
	configureTestProviders(s)
	s.Send = s.send
	return s
}

func (s *Service) Authorize(ctx context.Context, p Principal, admin bool) error {
	if p.Kind != "" && p.Kind != "session" {
		return publishing.ErrForbidden
	}
	roles := []string{"owner", "admin", "creator", "approver", "publisher", "writer_publisher", "viewer", "member"}
	if admin {
		roles = []string{"owner", "admin"}
	}
	return s.auth.AuthorizeRole(ctx, p.OrganizationID, p.UserID, p.SessionID, roles...)
}

func defaultPolicy() Policy {
	p := Policy{Availability: &Channels{InApp: true, Email: true, Slack: true}, Events: map[string]Channels{}, Generation: 1}
	for _, d := range activity.Catalogue {
		p.Events[d.ID] = Channels{InApp: true, Email: d.EmailDefault}
	}
	return p
}
func defaultPreferences() Preferences {
	p := Preferences{Events: map[string]Channels{}, Generation: 1, SocialSets: map[string]map[string]bool{}}
	for _, d := range activity.Catalogue {
		p.Events[d.ID] = Channels{InApp: true, Email: true}
	}
	return p
}

type queryer interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func policy(ctx context.Context, db queryer, org string) (Policy, error) {
	p := defaultPolicy()
	var raw, available []byte
	err := db.QueryRowContext(ctx, `SELECT events,availability,generation,slack_connection_id,slack_channel_id,slack_channel_name FROM platform_notification_policy WHERE "organizationId"=$1`, org).
		Scan(&raw, &available, &p.Generation, &p.SlackConnectionID, &p.SlackChannelID, &p.SlackChannelName)
	if errors.Is(err, sql.ErrNoRows) {
		return p, nil
	}
	if err != nil {
		return p, err
	}
	if err = json.Unmarshal(available, p.Availability); err != nil {
		return p, err
	}
	var overrides map[string]Channels
	if err = json.Unmarshal(raw, &overrides); err != nil {
		return p, err
	}
	for k, v := range overrides {
		p.Events[k] = v
	}
	return p, nil
}
func preferences(ctx context.Context, db queryer, org, user string) (Preferences, error) {
	p := defaultPreferences()
	var raw, sets []byte
	err := db.QueryRowContext(ctx, `SELECT events,generation,social_sets FROM platform_notification_preference WHERE "organizationId"=$1 AND "userId"=$2`, org, user).Scan(&raw, &p.Generation, &sets)
	if errors.Is(err, sql.ErrNoRows) {
		return p, nil
	}
	if err != nil {
		return p, err
	}
	var overrides map[string]Channels
	if err = json.Unmarshal(raw, &overrides); err != nil {
		return p, err
	}
	for k, v := range overrides {
		p.Events[k] = v
	}
	if len(sets) > 0 {
		if err = json.Unmarshal(sets, &p.SocialSets); err != nil {
			return p, err
		}
	}
	return p, nil
}

// emailWanted reads the person's email master switch (RFC 043); off, no
// notification email reaches them in any workspace.
func emailWanted(ctx context.Context, db queryer, user string) (bool, error) {
	var on bool
	err := db.QueryRowContext(ctx, `SELECT "emailNotifications" FROM user_preference WHERE "userId"=$1`, user).Scan(&on)
	if errors.Is(err, sql.ErrNoRows) {
		return true, nil
	}
	return on, err
}

// socialSetOf names the social set a resource row belongs to, if any.
func socialSetOf(row map[string]any) string {
	return textValue(row, "socialSetId")
}

// privateSocialSet reports whether a set is private, and to whom. A referenced
// set that is missing, deleted or outside the workspace has no authorized owner.
func privateSocialSet(ctx context.Context, db queryer, org, setID string) (bool, string, error) {
	if setID == "" {
		return false, "", nil
	}
	var visibility string
	var owner sql.NullString
	err := db.QueryRowContext(ctx, `SELECT visibility,"ownerUserId" FROM social_set WHERE id=$1 AND "organizationId"=$2 AND "deletedAt" IS NULL`, setID, org).Scan(&visibility, &owner)
	if errors.Is(err, sql.ErrNoRows) {
		return true, "", nil
	}
	return visibility == "PRIVATE", owner.String, err
}
func (s *Service) Settings(ctx context.Context, p Principal) (*Settings, error) {
	if err := s.Authorize(ctx, p, false); err != nil {
		return nil, err
	}
	pol, err := policy(ctx, s.DB, p.OrganizationID)
	if err != nil {
		return nil, err
	}
	pref, err := preferences(ctx, s.DB, p.OrganizationID, p.UserID)
	if err != nil {
		return nil, err
	}
	connections, err := s.Connections(ctx, p.OrganizationID)
	if err != nil {
		return nil, err
	}
	_, keyErr := encryptionKey("PLATFORM_NOTIFICATION_ENCRYPTION_KEY")
	available := emailConfigured() && keyErr == nil
	return &Settings{Catalogue: activity.Catalogue, Policy: pol, Preferences: pref, CanManage: s.Authorize(ctx, p, true) == nil, EmailAvailable: available, SlackAvailable: s.slackConfigured(), Connections: connections, Effective: effectiveSettings(pol, pref, available, connections)}, nil
}
func validEvents(events map[string]Channels, personal bool) bool {
	if len(events) > len(activity.Catalogue) {
		return false
	}
	for k, v := range events {
		d, ok := activity.Lookup(k)
		if !ok || personal && v.Slack || d.Restricted && v.Slack {
			return false
		}
	}
	return true
}
func (s *Service) SavePolicy(ctx context.Context, p Principal, input Policy) (*Settings, error) {
	if err := s.Authorize(ctx, p, true); err != nil {
		return nil, err
	}
	if !validEvents(input.Events, false) {
		return nil, ErrInvalid
	}
	if input.SlackConnectionID != "" || input.SlackChannelID != "" {
		ch, err := s.ValidateChannel(ctx, p.OrganizationID, input.SlackConnectionID, input.SlackChannelID)
		if err != nil {
			return nil, err
		}
		input.SlackChannelName = ch.Name
	} else {
		input.SlackChannelName = ""
	}
	raw, _ := json.Marshal(input.Events)
	if input.Availability == nil {
		input.Availability = &Channels{InApp: true, Email: true, Slack: true}
	}
	available, _ := json.Marshal(input.Availability)
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	if err = lockSessionMember(ctx, tx, p, true); err != nil {
		return nil, err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO platform_notification_policy ("organizationId",events,slack_connection_id,slack_channel_id,slack_channel_name,generation,availability) VALUES ($1,$2,$3,$4,$5,2,$6)
	 ON CONFLICT ("organizationId") DO UPDATE SET availability=EXCLUDED.availability,events=EXCLUDED.events,slack_connection_id=EXCLUDED.slack_connection_id,slack_channel_id=EXCLUDED.slack_channel_id,slack_channel_name=EXCLUDED.slack_channel_name,generation=platform_notification_policy.generation+1,enabled_at=now(),updated_at=now()`, p.OrganizationID, raw, input.SlackConnectionID, input.SlackChannelID, input.SlackChannelName, available)
	if err != nil {
		return nil, err
	}
	if err = audit(ctx, tx, p, "notification.policy_updated", p.OrganizationID); err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return s.Settings(ctx, p)
}
func (s *Service) SavePreferences(ctx context.Context, p Principal, input Preferences) (*Settings, error) {
	if err := s.Authorize(ctx, p, false); err != nil {
		return nil, err
	}
	if !validEvents(input.Events, true) || !validSocialSetPreferences(input.SocialSets) {
		return nil, ErrInvalid
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	if err = lockSessionMember(ctx, tx, p, false); err != nil {
		return nil, err
	}
	raw, _ := json.Marshal(input.Events)
	if input.SocialSets == nil {
		input.SocialSets = map[string]map[string]bool{}
	}
	sets, _ := json.Marshal(input.SocialSets)
	_, err = tx.ExecContext(ctx, `INSERT INTO platform_notification_preference(id,"organizationId","userId",events,generation,social_sets) VALUES($1,$2,$3,$4,2,$5)
	ON CONFLICT("organizationId","userId") DO UPDATE SET events=EXCLUDED.events,social_sets=EXCLUDED.social_sets,generation=platform_notification_preference.generation+1,updated_at=now()`, cuid.New(), p.OrganizationID, p.UserID, raw, sets)
	if err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return s.Settings(ctx, p)
}
func audit(ctx context.Context, tx *sql.Tx, p Principal, action, id string) error {
	auditID := cuid.New()
	_, err := tx.ExecContext(ctx, `INSERT INTO audit_log(id,"organizationId","requestId","actorType","actorUserId","actorDisplay",action,outcome,"entityType","entityId",metadata,"searchText") VALUES($1,$2,$1,'USER',NULLIF($3,''),'workspace member',$4,'SUCCEEDED','notification',$5,'{}',$4)`, auditID, p.OrganizationID, p.UserID, action, id)
	if err != nil {
		return err
	}
	rows, err := tx.QueryContext(ctx, `SELECT id FROM audit_drain WHERE "organizationId"=$1 AND enabled`, p.OrganizationID)
	if err != nil {
		return err
	}
	var drains []string
	for rows.Next() {
		var drain string
		if err = rows.Scan(&drain); err != nil {
			rows.Close()
			return err
		}
		drains = append(drains, drain)
	}
	err = rows.Err()
	rows.Close()
	if err != nil || len(drains) == 0 {
		return err
	}
	outbox := cuid.New()
	if _, err = tx.ExecContext(ctx, `INSERT INTO audit_outbox(id,"auditLogId") VALUES($1,$2)`, outbox, auditID); err != nil {
		return err
	}
	for _, drain := range drains {
		if _, err = tx.ExecContext(ctx, `INSERT INTO audit_drain_delivery(id,"drainId","outboxId","updatedAt") VALUES($1,$2,$3,now())`, cuid.New(), drain, outbox); err != nil {
			return err
		}
	}
	return nil
}

var resourceTables = map[string]string{"campaign": "campaign", "release": "release", "source_change": "source_change", "source_app": "source_app", "deployment_event": "deployment_event", "asset": "asset", "creative_variant": "creative_variant", "release_spec": "release_spec", "campaign_plan": "campaign_plan", "launch_run": "launch_run", "content_draft": "content_draft", "store_review": "store_review", "product_surface": "product_surface", "scheduled_post": "scheduled_post", "project": "project", "release_automation_run": "release_automation_run"}

func (s *Service) resource(ctx context.Context, org, user, kind, id string) (bool, map[string]any, error) {
	var role string
	err := s.DB.QueryRowContext(ctx, `SELECT m.role FROM member m JOIN "user" u ON u.id=m."userId" WHERE m."organizationId"=$1 AND m."userId"=$2 AND COALESCE(u.banned,false)=false AND NOT EXISTS(SELECT 1 FROM workspace_deletion WHERE "organizationId"=$1 AND status<>'CANCELLED')`, org, user).Scan(&role)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil, nil
	}
	if err != nil {
		return false, nil, err
	}
	if kind == "legacy_activity" {
		return true, map[string]any{}, nil
	}
	if kind == "member" && role != "owner" && role != "admin" {
		var owned bool
		err := s.DB.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM member WHERE id=$1 AND "organizationId"=$2 AND "userId"=$3)`, id, org, user).Scan(&owned)
		return owned, map[string]any{}, err
	}
	if kind == "integration_connection" || kind == "channel_connection" {
		var owner sql.NullString
		var setID string
		err := s.DB.QueryRowContext(ctx, `SELECT "createdByUserId",COALESCE(to_jsonb(c)->>'socialSetId','') FROM `+kind+` c WHERE id=$1 AND "organizationId"=$2`, id, org).Scan(&owner, &setID)
		if errors.Is(err, sql.ErrNoRows) {
			return false, nil, nil
		}
		if err != nil {
			return false, nil, err
		}
		if private, setOwner, err := privateSocialSet(ctx, s.DB, org, setID); err != nil || private && setOwner != user {
			return false, nil, err
		}
		return role == "owner" || role == "admin" || owner.String == user, map[string]any{"createdByUserId": owner.String, "socialSetId": setID}, nil
	}
	if slices.Contains([]string{"member", "invitation", "organization", "workspace"}, kind) {
		return role == "owner" || role == "admin", map[string]any{}, nil
	}
	table, ok := resourceTables[kind]
	if !ok {
		return false, nil, nil
	}
	var raw []byte
	err = s.DB.QueryRowContext(ctx, `SELECT to_jsonb(r) FROM `+table+` r WHERE id=$1 AND "organizationId"=$2`, id, org).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil, nil
	}
	if err != nil {
		return false, nil, err
	}
	var row map[string]any
	if err = json.Unmarshal(raw, &row); err != nil {
		return false, nil, err
	}
	if row["deletedAt"] != nil || row["status"] == "DELETED" {
		return false, row, nil
	}
	// A private social set's drafts and posts are its owner's alone (RFC 043).
	if private, owner, err := privateSocialSet(ctx, s.DB, org, socialSetOf(row)); err != nil {
		return false, nil, err
	} else if private && owner != user {
		return false, row, nil
	}
	if kind == "release_spec" {
		var campaignID string
		err = s.DB.QueryRowContext(ctx, `SELECT id FROM campaign WHERE "organizationId"=$1 AND "releaseId"=$2 ORDER BY "createdAt" DESC,id DESC LIMIT 1`, org, textValue(row, "releaseId")).Scan(&campaignID)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return false, nil, err
		}
		row["campaignId"] = campaignID
	}
	return true, row, nil
}
func href(kind, id string, row map[string]any) string {
	id = url.PathEscape(id)
	switch kind {
	case "legacy_activity":
		return ""
	case "campaign":
		return "/campaigns/" + id + "/copy"
	case "release_automation_run":
		return "/workflows/runs/" + id
	case "content_draft":
		return "/drafts/" + id
	case "scheduled_post":
		if d, _ := row["contentDraftId"].(string); d != "" {
			return "/drafts/" + url.PathEscape(d)
		}
		return "/drafts/calendar"
	case "launch_run", "campaign_plan", "release_spec", "creative_variant":
		if c, _ := row["campaignId"].(string); c != "" {
			step := ""
			if kind == "creative_variant" {
				step = "/assets"
			}
			if kind == "campaign_plan" {
				step = "/plan"
			}
			if kind == "release_spec" {
				step = "/spec"
			}
			return "/campaigns/" + url.PathEscape(c) + step
		}
		return "/campaigns"
	case "asset":
		return "/assets"
	case "project", "store_review":
		return "/projects"
	case "product_surface", "deployment_event":
		return "/workspace/product-pages"
	case "integration_connection", "channel_connection", "source_app":
		return "/workspace/integrations"
	case "member", "invitation", "organization", "workspace":
		return "/workspace/members"
	default:
		return "/product/release-intake"
	}
}
func appURL(path string) string {
	u, err := url.Parse(os.Getenv("BETTER_AUTH_URL"))
	if err != nil || u.Host == "" || u.User != nil || (u.Scheme != "https" && !(u.Scheme == "http" && (u.Hostname() == "localhost" || u.Hostname() == "127.0.0.1"))) || !strings.HasPrefix(path, "/") || strings.HasPrefix(path, "//") {
		return ""
	}
	u.Path, u.RawQuery, u.Fragment = path, "", ""
	return u.String()
}
func textValue(m map[string]any, k string) string { s, _ := m[k].(string); return s }
func invalid(message string) error                { return fmt.Errorf("%w: %s", ErrInvalid, message) }

// socialSetIDPattern is a social set's ID.
var socialSetIDPattern = regexp.MustCompile(`^[a-z0-9]{10,32}$`)

// validSocialSetPreferences checks per-set choices: set IDs and catalogue kinds.
func validSocialSetPreferences(sets map[string]map[string]bool) bool {
	if len(sets) > 200 {
		return false
	}
	for id, kinds := range sets {
		if !socialSetIDPattern.MatchString(id) {
			return false
		}
		for kind := range kinds {
			if _, ok := activity.Lookup(kind); !ok {
				return false
			}
		}
	}
	return true
}
