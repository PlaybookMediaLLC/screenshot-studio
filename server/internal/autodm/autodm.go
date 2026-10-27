// Package autodm defines the local campaign and delivery contract. Production
// delivery remains disabled until authorized event ingestion, consent evidence,
// and a durable atomic ledger are configured for the connected X account.
package autodm

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"
)

const Window = 4 * 24 * time.Hour

var ErrUnavailable = errors.New("automatic direct-message delivery is not enabled for this connection")
var offer = regexp.MustCompile(`(?i)\b(dm|message|send)\b`)
var variables = regexp.MustCompile(`\{\{([^{}]+)\}\}`)

// Config is a persisted draft configuration, never an authorization to send.
type Config struct {
	Match         string `json:"match"`
	Reposts       bool   `json:"reposts"`
	Replies       bool   `json:"replies"`
	ReplyText     string `json:"replyText,omitempty"`
	RequireFollow bool   `json:"requireFollow"`
	Message       string `json:"message"`
}

// Validate checks local settings; provider quotas and access must also be verified.
func (c Config) Validate() error {
	if c.Match != "any" && c.Match != "all" {
		return fmt.Errorf("choose any or all matching actions")
	}
	if !c.Reposts && !c.Replies {
		return fmt.Errorf("select replies or reposts")
	}
	if utf8.RuneCountInString(c.ReplyText) > 100 || c.ReplyText != "" && !c.Replies {
		return fmt.Errorf("a reply filter requires replies and at most 100 characters")
	}
	if strings.TrimSpace(c.Message) == "" || utf8.RuneCountInString(c.Message) > 10000 {
		return fmt.Errorf("a message has 1 to 10,000 characters")
	}
	for _, match := range variables.FindAllStringSubmatch(c.Message, -1) {
		switch match[1] {
		case "first_name", "full_name", "username", "action", "post_url":
		default:
			return fmt.Errorf("unsupported message variable %s", match[1])
		}
	}
	return nil
}

// Campaign binds its immutable offer and configuration to a confirmed post.
type Campaign struct {
	ID, OrganizationID, AccountID, PostID, PostText string
	Config                                          Config
	PublishedAt                                     time.Time
	Disabled, SourceRemoved                         bool
}

// Recipient combines provider-verified actions with explicit consent evidence.
// Following or engaging alone must never be converted into consent.
type Recipient struct {
	ID, FirstName, FullName, Username, ReplyText string
	Reposted, Replied, Follows, OptedOut         bool
	ConsentPostID, ConsentEvidenceID             string
	ConsentAt                                    time.Time
}

// Eligible requires a current explicit opt-in to this specific published offer.
func Eligible(c Campaign, r Recipient, now time.Time) bool {
	if c.Config.Validate() != nil || c.ID == "" || c.OrganizationID == "" || c.AccountID == "" || c.PostID == "" || c.PublishedAt.IsZero() || c.Disabled || c.SourceRemoved || r.ID == "" || r.OptedOut || !offer.MatchString(c.PostText) || now.Before(c.PublishedAt) || !now.Before(c.PublishedAt.Add(Window)) {
		return false
	}
	if r.ConsentPostID != c.PostID || r.ConsentEvidenceID == "" || r.ConsentAt.Before(c.PublishedAt) || r.ConsentAt.After(now) || c.Config.RequireFollow && !r.Follows {
		return false
	}
	matched, selected := 0, 0
	if c.Config.Reposts {
		selected++
		if r.Reposted {
			matched++
		}
	}
	if c.Config.Replies {
		selected++
		if r.Replied && (strings.TrimSpace(c.Config.ReplyText) == "" || strings.Contains(strings.ToLower(r.ReplyText), strings.ToLower(strings.TrimSpace(c.Config.ReplyText)))) {
			matched++
		}
	}
	return c.Config.Match == "any" && matched > 0 || c.Config.Match == "all" && matched == selected
}

// Message expands only supported variables and always includes an opt-out instruction.
func Message(c Campaign, r Recipient) string {
	action := "reply"
	if r.Reposted && r.Replied {
		action = "reply and repost"
	} else if r.Reposted {
		action = "repost"
	}
	values := map[string]string{"first_name": r.FirstName, "full_name": r.FullName, "username": r.Username, "action": action, "post_url": "https://x.com/i/status/" + c.PostID}
	return variables.ReplaceAllStringFunc(c.Config.Message, func(match string) string { return values[strings.TrimSuffix(strings.TrimPrefix(match, "{{"), "}}")] }) + "\n\nReply STOP to opt out."
}

// Limits are product caps; deployments must use the lower verified provider quota.
type Limits struct{ PerMinute, PerHour, PerDay, ActiveCampaigns int }

var ProductLimits = Limits{30, 100, 500, 3}

func validLimits(limits Limits) bool {
	return limits.PerMinute > 0 && limits.PerHour > 0 && limits.PerDay > 0 && limits.ActiveCampaigns > 0 &&
		limits.PerMinute <= 30 && limits.PerHour <= 100 &&
		limits.PerDay <= 500 && limits.ActiveCampaigns <= 3
}

// Ledger must atomically recheck consent, opt-outs, disabled/removed source,
// campaign age and account-wide rolling quotas while reserving a unique
// organization/account/campaign/recipient key. A reservation is permanent:
// uncertain sends cannot be reclaimed or retried automatically.
type Ledger interface {
	Claim(context.Context, Campaign, Recipient, time.Time, Limits) (bool, error)
	Complete(context.Context, Campaign, Recipient, string, string) error
}

// Sender uses an authorized provider API and returns a confirmed remote message ID.
type Sender interface {
	Send(context.Context, string, string, string) (string, error)
}

// Deliver is off by default and requires verified DM scopes and event access.
// No production caller sets authorized until a durable ledger and opt-out event
// receiver have been deployed and provider access has been approved.
func Deliver(ctx context.Context, c Campaign, r Recipient, now time.Time, authorized bool, limits Limits, ledger Ledger, sender Sender) error {
	if !authorized || ledger == nil || sender == nil {
		return ErrUnavailable
	}
	if !Eligible(c, r, now) {
		return nil
	}
	if !validLimits(limits) {
		return fmt.Errorf("unverified or excessive DM quotas")
	}
	message := Message(c, r)
	if utf8.RuneCountInString(message) > 10000 {
		return fmt.Errorf("expanded message exceeds 10,000 characters")
	}
	claimed, err := ledger.Claim(ctx, c, r, now, limits)
	if err != nil || !claimed {
		return err
	}
	id, err := sender.Send(ctx, c.AccountID, r.ID, message)
	if err != nil || id == "" {
		recordErr := ledger.Complete(ctx, c, r, "", "unknown")
		return errors.Join(fmt.Errorf("DM outcome requires reconciliation; automatic retry disabled"), recordErr)
	}
	return ledger.Complete(ctx, c, r, id, "sent")
}
