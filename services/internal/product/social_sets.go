package product

import (
	"context"
	"fmt"
	"regexp"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/channelconnection"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/contentdraft"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/member"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/predicate"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/publicationattempt"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/scheduledpost"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/schema"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/socialset"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
	"github.com/lucsky/cuid"
)

// Social sets (RFC 041): a workspace's publishing identities. A set groups
// channel connections, at most one per platform, and a draft belongs to one
// set. The workspace's roles stay the authority; a restricted set narrows who
// sees its drafts to owners, admins, and the members it lists. Drafts with no
// set belong to the workspace's default set.

const (
	socialSetNameLimit   = 80
	socialSetLimit       = 50
	socialSetMemberLimit = 200
)

var (
	// User ids come from the auth library: letters, digits, - and _.
	userIDPattern        = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)
	socialSetManageRoles = []string{"owner", "admin"}
	// Roles that see every set, restricted or not.
	socialSetAllAccessRoles = []string{"owner", "admin"}
	socialSetColors         = []string{"sky", "violet", "emerald", "amber", "rose", "orange", "teal", "indigo", "pink", "gray"}
)

// SocialSetConnection is a set's account as the composer shows it, with its health.
type SocialSetConnection struct {
	AvatarURL   *string `json:"avatarUrl"`
	Channel     string  `json:"channel"`
	DisplayName *string `json:"displayName"`
	Handle      *string `json:"handle"`
	// Health is healthy, reconnect (credentials lapsed or were refused), or disabled.
	Health string `json:"health"`
	// Premium is the account's X Premium, as X reports it; never the plan's.
	Premium  bool   `json:"premium"`
	ID       string `json:"id"`
	Platform string `json:"platform"`
}

// SocialSetRecord is a social set as the API returns it.
type SocialSetRecord struct {
	ChannelConnectionIDs []string                    `json:"channelConnectionIds"`
	Color                string                      `json:"color"`
	Connections          []SocialSetConnection       `json:"connections"`
	CreatedAt            time.Time                   `json:"createdAt"`
	DefaultChannels      []string                    `json:"defaultChannels"`
	ID                   string                      `json:"id"`
	IsDefault            bool                        `json:"isDefault"`
	MemberUserIDs        []string                    `json:"memberUserIds"`
	Name                 string                      `json:"name"`
	Preferences          schema.SocialSetPreferences `json:"preferences"`
	// TimeZone is the set's own zone, or null for the workspace's.
	TimeZone   *string   `json:"timeZone"`
	UpdatedAt  time.Time `json:"updatedAt"`
	Visibility string    `json:"visibility"`
}

// SocialSetInput creates or changes a set; an update changes what it sets.
type SocialSetInput struct {
	ChannelConnectionIDs *[]string                    `json:"channelConnectionIds"`
	Color                *string                      `json:"color"`
	DefaultChannels      *[]string                    `json:"defaultChannels"`
	MemberUserIDs        *[]string                    `json:"memberUserIds"`
	Name                 *string                      `json:"name"`
	Preferences          *schema.SocialSetPreferences `json:"preferences"`
	TimeZone             *string                      `json:"timeZone"`
	Visibility           *string                      `json:"visibility"`
}

func socialSetRecord(row *ent.SocialSet) SocialSetRecord {
	return SocialSetRecord{ChannelConnectionIDs: nonNilStrings(row.ChannelConnectionIds), Color: row.Color,
		Connections: []SocialSetConnection{}, CreatedAt: row.CreatedAt, DefaultChannels: nonNilStrings(row.DefaultChannels),
		ID: row.ID, IsDefault: row.IsDefault, MemberUserIDs: nonNilStrings(row.MemberUserIds), Name: row.Name,
		Preferences: row.Preferences, TimeZone: row.TimeZone, UpdatedAt: row.UpdatedAt, Visibility: string(row.Visibility)}
}

// memberRole is the user's role in the workspace, or ErrForbidden.
func memberRole(ctx context.Context, client *ent.Client, organizationID, userID string) (string, error) {
	row, err := client.Member.Query().Where(member.OrganizationID(organizationID), member.UserID(userID)).Only(ctx)
	if ent.IsNotFound(err) || ent.IsNotSingular(err) {
		return "", publishing.ErrForbidden
	}
	if err != nil {
		return "", err
	}
	return row.Role, nil
}

// setAccess is who may see a set's drafts: anyone in the workspace for a
// workspace set; for a restricted set, owners, admins, listed members, and
// support. An API key reaches only workspace sets.
type setAccess struct {
	all    bool
	userID string
}

func (c *Configuration) socialSetAccess(ctx context.Context, actor Actor) (setAccess, error) {
	switch actor.Kind {
	case "", "session":
		role, err := memberRole(ctx, c.client, actor.OrganizationID, actor.UserID)
		if err != nil {
			return setAccess{}, err
		}
		return setAccess{all: slices.Contains(socialSetAllAccessRoles, role), userID: actor.UserID}, nil
	case "support", "service":
		return setAccess{all: true}, nil
	}
	return setAccess{}, nil
}

func (a setAccess) allows(set *ent.SocialSet) bool {
	return set.Visibility == socialset.VisibilityWorkspace || a.all ||
		a.userID != "" && slices.Contains(set.MemberUserIds, a.userID)
}

// defaultSocialSet returns the workspace's default set, making it on first
// use with every active connection, one per platform.
func (c *Configuration) defaultSocialSet(ctx context.Context, organizationID string) (*ent.SocialSet, error) {
	row, err := c.client.SocialSet.Query().Where(socialset.OrganizationID(organizationID), socialset.IsDefault(true)).Only(ctx)
	if err == nil || !ent.IsNotFound(err) {
		return row, err
	}
	connections, err := c.client.ChannelConnection.Query().Where(channelconnection.OrganizationID(organizationID),
		channelconnection.StatusEQ(channelconnection.StatusACTIVE)).Order(ent.Asc(channelconnection.FieldCreatedAt)).All(ctx)
	if err != nil {
		return nil, err
	}
	ids, channels := []string{}, []string{}
	for _, connection := range connections {
		channel, ok := draftPlatformChannels[connection.Platform]
		if !ok || slices.Contains(channels, channel) {
			continue
		}
		ids, channels = append(ids, connection.ID), append(channels, channel)
	}
	name := "Default"
	if org, err := c.client.Organization.Get(ctx, organizationID); err == nil && strings.TrimSpace(org.Name) != "" {
		name = org.Name
	}
	err = c.client.SocialSet.Create().SetID(cuid.New()).SetOrganizationID(organizationID).SetName(name).
		SetIsDefault(true).SetChannelConnectionIds(ids).SetDefaultChannels(channels).Exec(ctx)
	if err != nil && !ent.IsConstraintError(err) {
		return nil, err
	}
	// A concurrent first visit may have made it: read the one that won.
	return c.client.SocialSet.Query().Where(socialset.OrganizationID(organizationID), socialset.IsDefault(true)).Only(ctx)
}

// draftSet resolves a draft's set: its own, or the workspace's default.
func (c *Configuration) draftSet(ctx context.Context, organizationID string, setID *string) (*ent.SocialSet, error) {
	if setID == nil {
		return c.defaultSocialSet(ctx, organizationID)
	}
	row, err := c.client.SocialSet.Query().Where(socialset.ID(*setID), socialset.OrganizationID(organizationID)).Only(ctx)
	if ent.IsNotFound(err) {
		return nil, publishing.ErrNotFound
	}
	return row, err
}

// authorizeDraftSet refuses a draft whose set the actor may not see. The
// draft reads as missing, so its existence does not leak.
func (c *Configuration) authorizeDraftSet(ctx context.Context, actor Actor, draft *ent.ContentDraft) error {
	set, err := c.draftSet(ctx, draft.OrganizationID, draft.SocialSetID)
	if err != nil {
		return err
	}
	access, err := c.socialSetAccess(ctx, actor)
	if err != nil {
		return err
	}
	if !access.allows(set) {
		return publishing.ErrNotFound
	}
	return nil
}

// visibleSetFilter limits a draft query to the sets the actor may see.
func (c *Configuration) visibleSetFilter(ctx context.Context, actor Actor) (predicate.ContentDraft, error) {
	access, err := c.socialSetAccess(ctx, actor)
	if err != nil {
		return nil, err
	}
	defaultSet, err := c.defaultSocialSet(ctx, actor.OrganizationID)
	if err != nil {
		return nil, err
	}
	sets, err := c.client.SocialSet.Query().Where(socialset.OrganizationID(actor.OrganizationID)).All(ctx)
	if err != nil {
		return nil, err
	}
	visible := []string{}
	for _, set := range sets {
		if access.allows(set) {
			visible = append(visible, set.ID)
		}
	}
	filter := contentdraft.SocialSetIDIn(visible...)
	if access.allows(defaultSet) {
		return contentdraft.Or(filter, contentdraft.SocialSetIDIsNil()), nil
	}
	return filter, nil
}

// draftSetFilter limits a draft query to one set the actor may see.
func (c *Configuration) draftSetFilter(ctx context.Context, actor Actor, setID string) (predicate.ContentDraft, error) {
	set, err := c.draftSet(ctx, actor.OrganizationID, &setID)
	if err != nil {
		return nil, err
	}
	access, err := c.socialSetAccess(ctx, actor)
	if err != nil {
		return nil, err
	}
	if !access.allows(set) {
		return nil, publishing.ErrNotFound
	}
	if set.IsDefault {
		return contentdraft.Or(contentdraft.SocialSetID(set.ID), contentdraft.SocialSetIDIsNil()), nil
	}
	return contentdraft.SocialSetID(set.ID), nil
}

// connectionHealth reads each connection's health: its status, and whether
// its last finished post failed because the platform refused its credentials.
func (c *Configuration) connectionHealth(ctx context.Context, connections []*ent.ChannelConnection) (map[string]string, error) {
	health := map[string]string{}
	ids := []string{}
	for _, connection := range connections {
		switch connection.Status {
		case channelconnection.StatusACTIVE:
			health[connection.ID] = "healthy"
			ids = append(ids, connection.ID)
		case channelconnection.StatusREVOKED:
			health[connection.ID] = "reconnect"
		default:
			health[connection.ID] = "disabled"
		}
	}
	if len(ids) == 0 {
		return health, nil
	}
	posts, err := c.client.ScheduledPost.Query().Where(scheduledpost.ChannelConnectionIDIn(ids...),
		scheduledpost.StatusIn(scheduledpost.StatusPUBLISHED, scheduledpost.StatusFAILED)).
		Order(ent.Desc(scheduledpost.FieldUpdatedAt)).Limit(200).WithAttempts(func(q *ent.PublicationAttemptQuery) {
		q.Order(ent.Desc(publicationattempt.FieldAttemptNumber))
	}).All(ctx)
	if err != nil {
		return nil, err
	}
	seen := map[string]bool{}
	for _, post := range posts {
		if seen[post.ChannelConnectionID] {
			continue
		}
		seen[post.ChannelConnectionID] = true
		if post.Status != scheduledpost.StatusFAILED || len(post.Edges.Attempts) == 0 {
			continue
		}
		// publicationOutcome answers lapsed or refused credentials with 409.
		if code := post.Edges.Attempts[0].FailureCode; code != nil && *code == "409" {
			health[post.ChannelConnectionID] = "reconnect"
		}
	}
	return health, nil
}

// withConnections fills in each set's accounts as the composer shows them.
func (c *Configuration) withConnections(ctx context.Context, organizationID string, rows []*ent.SocialSet) ([]SocialSetRecord, error) {
	ids := []string{}
	for _, row := range rows {
		ids = append(ids, row.ChannelConnectionIds...)
	}
	connections, err := c.client.ChannelConnection.Query().Where(channelconnection.IDIn(ids...),
		channelconnection.OrganizationID(organizationID)).All(ctx)
	if err != nil {
		return nil, err
	}
	health, err := c.connectionHealth(ctx, connections)
	if err != nil {
		return nil, err
	}
	byID := map[string]*ent.ChannelConnection{}
	for _, connection := range connections {
		byID[connection.ID] = connection
	}
	records := make([]SocialSetRecord, 0, len(rows))
	for _, row := range rows {
		record := socialSetRecord(row)
		for _, id := range row.ChannelConnectionIds {
			connection := byID[id]
			if connection == nil {
				continue
			}
			premium := connection.Platform == "x" && health[id] == "healthy" && c.accountStanding(ctx, connection).Premium
			record.Connections = append(record.Connections, SocialSetConnection{AvatarURL: connection.AvatarURL,
				Channel: draftPlatformChannels[connection.Platform], DisplayName: connection.DisplayName,
				Handle: connection.Handle, Health: health[id], ID: id, Platform: connection.Platform, Premium: premium})
		}
		records = append(records, record)
	}
	return records, nil
}

// ListSocialSets lists the sets the actor may see, the default first.
func (c *Configuration) ListSocialSets(ctx context.Context, actor Actor) ([]SocialSetRecord, error) {
	if err := c.authorizeContentDrafts(ctx, actor, false); err != nil {
		return nil, err
	}
	if _, err := c.defaultSocialSet(ctx, actor.OrganizationID); err != nil {
		return nil, err
	}
	rows, err := c.client.SocialSet.Query().Where(socialset.OrganizationID(actor.OrganizationID)).
		Order(ent.Desc(socialset.FieldIsDefault), ent.Asc(socialset.FieldCreatedAt), ent.Asc(socialset.FieldID)).All(ctx)
	if err != nil {
		return nil, err
	}
	access, err := c.socialSetAccess(ctx, actor)
	if err != nil {
		return nil, err
	}
	visible := rows[:0]
	for _, row := range rows {
		if access.allows(row) {
			visible = append(visible, row)
		}
	}
	return c.withConnections(ctx, actor.OrganizationID, visible)
}

// GetSocialSet reads one set the actor may see.
func (c *Configuration) GetSocialSet(ctx context.Context, actor Actor, id string) (*SocialSetRecord, error) {
	if err := c.authorizeContentDrafts(ctx, actor, false); err != nil {
		return nil, err
	}
	row, err := c.draftSet(ctx, actor.OrganizationID, &id)
	if err != nil {
		return nil, err
	}
	access, err := c.socialSetAccess(ctx, actor)
	if err != nil {
		return nil, err
	}
	if !access.allows(row) {
		return nil, publishing.ErrNotFound
	}
	records, err := c.withConnections(ctx, actor.OrganizationID, []*ent.SocialSet{row})
	if err != nil {
		return nil, err
	}
	return &records[0], nil
}

// socialSetFields validates a set's fields onto the create or update builder.
// It checks every connection is the workspace's and takes drafts, one per
// platform, and that the default platforms are among the set's.
func (c *Configuration) socialSetFields(ctx context.Context, tx *ent.Tx, actor Actor, current *ent.SocialSet,
	input SocialSetInput) (map[string]any, error) {
	fields := map[string]any{}
	if input.Name != nil {
		name := strings.TrimSpace(*input.Name)
		if name == "" || utf8.RuneCountInString(name) > socialSetNameLimit {
			return nil, invalid(fmt.Sprintf("Name the set in 1 to %d characters.", socialSetNameLimit))
		}
		fields["name"] = name
	}
	if input.Color != nil {
		if !slices.Contains(socialSetColors, *input.Color) {
			return nil, invalid("Pick one of the set colours: " + strings.Join(socialSetColors, ", ") + ".")
		}
		fields["color"] = *input.Color
	}
	if input.Visibility != nil {
		if *input.Visibility != "workspace" && *input.Visibility != "restricted" {
			return nil, invalid("A set is visible to the workspace or restricted.")
		}
		fields["visibility"] = *input.Visibility
	}
	if input.TimeZone != nil {
		zone := strings.TrimSpace(*input.TimeZone)
		if zone != "" {
			if _, err := time.LoadLocation(zone); err != nil {
				return nil, invalid("Use an IANA time zone, such as Europe/Paris.")
			}
		}
		fields["timeZone"] = zone
	}
	if input.Preferences != nil {
		prefs := *input.Preferences
		if utf8.RuneCountInString(prefs.Voice) > 2000 || utf8.RuneCountInString(prefs.Audience) > 2000 || len(prefs.Samples) > 20 {
			return nil, invalid("Keep the voice and audience under 2,000 characters and at most 20 samples.")
		}
		for _, sample := range prefs.Samples {
			if utf8.RuneCountInString(sample) > 5000 {
				return nil, invalid("Keep each writing sample under 5,000 characters.")
			}
		}
		if prefs.Automation != nil {
			if err := checkDraftExtras("x", ContentDraftScheduleTarget{AutoActions: prefs.Automation}); err != nil {
				return nil, err
			}
		}
		fields["preferences"] = prefs
	}
	if input.MemberUserIDs != nil {
		ids := []string{}
		for _, id := range *input.MemberUserIDs {
			if !userIDPattern.MatchString(id) {
				return nil, invalid("Every member must be a valid user ID.")
			}
			if !slices.Contains(ids, id) {
				ids = append(ids, id)
			}
		}
		if len(ids) > socialSetMemberLimit {
			return nil, invalid(fmt.Sprintf("List at most %d members.", socialSetMemberLimit))
		}
		count, err := tx.Member.Query().Where(member.OrganizationID(actor.OrganizationID), member.UserIDIn(ids...)).Count(ctx)
		if err != nil {
			return nil, err
		}
		if count != len(ids) {
			return nil, invalid("Every listed member must belong to this workspace.")
		}
		fields["members"] = ids
	}
	connectionIDs := []string{}
	if current != nil {
		connectionIDs = current.ChannelConnectionIds
	}
	if input.ChannelConnectionIDs != nil {
		ids, err := uniqueIDs(*input.ChannelConnectionIDs, contentDraftChannelLimit, "channel")
		if err != nil {
			return nil, err
		}
		connections, err := tx.ChannelConnection.Query().Where(channelconnection.IDIn(ids...),
			channelconnection.OrganizationID(actor.OrganizationID)).All(ctx)
		if err != nil {
			return nil, err
		}
		if len(connections) != len(ids) {
			return nil, invalid("Every account must be a connection of this workspace.")
		}
		platforms := map[string]bool{}
		for _, connection := range connections {
			channel, ok := draftPlatformChannels[connection.Platform]
			if !ok {
				return nil, invalid("A " + connection.Platform + " account cannot publish drafts.")
			}
			if platforms[channel] {
				return nil, invalid("A set has one account per platform; this one has two " + channel + " accounts.")
			}
			platforms[channel] = true
		}
		fields["connections"] = ids
		connectionIDs = ids
	}
	if input.DefaultChannels != nil || input.ChannelConnectionIDs != nil {
		channels := []string{}
		if current != nil {
			channels = current.DefaultChannels
		}
		if input.DefaultChannels != nil {
			channels = *input.DefaultChannels
		}
		available, err := setChannels(ctx, tx, actor.OrganizationID, connectionIDs)
		if err != nil {
			return nil, err
		}
		if current == nil && input.DefaultChannels == nil {
			// A new set starts with every platform it has, in account order.
			connections, err := tx.ChannelConnection.Query().Where(channelconnection.IDIn(connectionIDs...),
				channelconnection.OrganizationID(actor.OrganizationID)).All(ctx)
			if err != nil {
				return nil, err
			}
			for _, id := range connectionIDs {
				for _, connection := range connections {
					if connection.ID == id {
						channels = append(channels, draftPlatformChannels[connection.Platform])
					}
				}
			}
		}
		kept := []string{}
		for _, channel := range channels {
			if input.DefaultChannels != nil && !available[channel] {
				return nil, invalid("A default platform must be one of the set's accounts: " + channel + " is not.")
			}
			if available[channel] && !slices.Contains(kept, channel) {
				kept = append(kept, channel)
			}
		}
		fields["defaultChannels"] = kept
	}
	return fields, nil
}

// setChannels is the channels a set's connections publish to.
func setChannels(ctx context.Context, tx *ent.Tx, organizationID string, ids []string) (map[string]bool, error) {
	connections, err := tx.ChannelConnection.Query().Where(channelconnection.IDIn(ids...),
		channelconnection.OrganizationID(organizationID)).All(ctx)
	if err != nil {
		return nil, err
	}
	channels := map[string]bool{}
	for _, connection := range connections {
		if channel, ok := draftPlatformChannels[connection.Platform]; ok {
			channels[channel] = true
		}
	}
	return channels, nil
}

// CreateSocialSet adds a publishing identity. Owners and admins manage sets.
func (c *Configuration) CreateSocialSet(ctx context.Context, actor Actor, input SocialSetInput) (*SocialSetRecord, error) {
	if err := c.authorizeDecision(ctx, actor, socialSetManageRoles...); err != nil {
		return nil, err
	}
	if err := c.requireWorkspaceFeature(ctx, actor.OrganizationID, contentDraftFeature); err != nil {
		return nil, err
	}
	if input.Name == nil {
		return nil, invalid("Name the set.")
	}
	if _, err := c.defaultSocialSet(ctx, actor.OrganizationID); err != nil {
		return nil, err
	}
	count, err := c.client.SocialSet.Query().Where(socialset.OrganizationID(actor.OrganizationID)).Count(ctx)
	if err != nil {
		return nil, err
	}
	if count >= socialSetLimit {
		return nil, conflict(fmt.Sprintf("A workspace can have up to %d social sets.", socialSetLimit))
	}
	tx, err := c.client.Tx(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	fields, err := c.socialSetFields(ctx, tx, actor, nil, input)
	if err != nil {
		return nil, err
	}
	create := tx.SocialSet.Create().SetID(cuid.New()).SetOrganizationID(actor.OrganizationID).
		SetName(fields["name"].(string)).SetNillableCreatedByUserID(projectActor(actor))
	applySocialSetFields(fields, create.Mutation())
	row, err := create.Save(ctx)
	if err != nil {
		return nil, err
	}
	if err := appendConfigurationAudit(ctx, tx, actor, "product.social_set_created", "social_set", row.ID,
		map[string]any{"name": row.Name}); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return c.GetSocialSet(ctx, actor, row.ID)
}

// applySocialSetFields copies validated fields onto a set mutation.
func applySocialSetFields(fields map[string]any, mutation *ent.SocialSetMutation) {
	for key, value := range fields {
		switch key {
		case "name":
			mutation.SetName(value.(string))
		case "color":
			mutation.SetColor(value.(string))
		case "visibility":
			mutation.SetVisibility(socialset.Visibility(value.(string)))
		case "timeZone":
			if zone := value.(string); zone == "" {
				mutation.ClearTimeZone()
			} else {
				mutation.SetTimeZone(zone)
			}
		case "preferences":
			mutation.SetPreferences(value.(schema.SocialSetPreferences))
		case "members":
			mutation.SetMemberUserIds(value.([]string))
		case "connections":
			mutation.SetChannelConnectionIds(value.([]string))
		case "defaultChannels":
			mutation.SetDefaultChannels(value.([]string))
		}
	}
}

// UpdateSocialSet changes a set. Owners and admins manage sets.
func (c *Configuration) UpdateSocialSet(ctx context.Context, actor Actor, id string, input SocialSetInput) (*SocialSetRecord, error) {
	if err := c.authorizeDecision(ctx, actor, socialSetManageRoles...); err != nil {
		return nil, err
	}
	if err := c.requireWorkspaceFeature(ctx, actor.OrganizationID, contentDraftFeature); err != nil {
		return nil, err
	}
	tx, err := c.client.Tx(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	current, err := tx.SocialSet.Query().Where(socialset.ID(id), socialset.OrganizationID(actor.OrganizationID)).Only(ctx)
	if ent.IsNotFound(err) {
		return nil, publishing.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	fields, err := c.socialSetFields(ctx, tx, actor, current, input)
	if err != nil {
		return nil, err
	}
	update := tx.SocialSet.UpdateOne(current)
	applySocialSetFields(fields, update.Mutation())
	if _, err := update.Save(ctx); err != nil {
		return nil, err
	}
	changed := make([]string, 0, len(fields))
	for key := range fields {
		changed = append(changed, key)
	}
	slices.Sort(changed)
	if err := appendConfigurationAudit(ctx, tx, actor, "product.social_set_updated", "social_set", id,
		map[string]any{"fields": changed}); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return c.GetSocialSet(ctx, actor, id)
}

// DeleteSocialSet removes an empty set. The default set stays, and a set
// with drafts is refused: its drafts are moved or deleted first.
func (c *Configuration) DeleteSocialSet(ctx context.Context, actor Actor, id string) error {
	if err := c.authorizeDecision(ctx, actor, socialSetManageRoles...); err != nil {
		return err
	}
	tx, err := c.client.Tx(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	row, err := tx.SocialSet.Query().Where(socialset.ID(id), socialset.OrganizationID(actor.OrganizationID)).Only(ctx)
	if ent.IsNotFound(err) {
		return publishing.ErrNotFound
	}
	if err != nil {
		return err
	}
	if row.IsDefault {
		return conflict("The workspace's default set cannot be deleted.")
	}
	if err := tx.SocialSet.DeleteOne(row).Exec(ctx); err != nil {
		if ent.IsConstraintError(err) {
			return conflict("This set has drafts. Move or delete them first.")
		}
		return err
	}
	if err := appendConfigurationAudit(ctx, tx, actor, "product.social_set_deleted", "social_set", id,
		map[string]any{"name": row.Name}); err != nil {
		return err
	}
	return tx.Commit()
}
