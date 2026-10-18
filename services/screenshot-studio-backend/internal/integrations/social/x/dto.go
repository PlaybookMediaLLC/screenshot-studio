package x

import (
	"net/url"
	"regexp"
	"slices"
	"strings"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/helpers"
)

// XDto holds the X post settings. made_with_ai and
// paid_partnership stay `any` because the provider accepts "true" strings
// (assetBoolean) while validation requires booleans.
type XDto struct {
	Community       *string   `json:"community,omitempty"`
	WhoCanReplyPost *string   `json:"who_can_reply_post,omitempty"`
	PostType        *string   `json:"post_type,omitempty"`
	ArticleTitle    *string   `json:"article_title,omitempty"`
	ArticleStatus   *string   `json:"article_status,omitempty"`
	ArticleCover    *MediaDto `json:"article_cover,omitempty"`
	MadeWithAI      any       `json:"made_with_ai,omitempty"`
	PaidPartnership any       `json:"paid_partnership,omitempty"`
}

var communityURL = regexp.MustCompile(`^(https://x\.com/i/communities/\d+)?$`)

func isIn(value *string, allowed ...string) bool {
	return value != nil && slices.Contains(allowed, *value)
}

func isInMessage(property string, allowed ...string) string {
	return property + " must be one of the following values: " + strings.Join(allowed, ", ")
}

// Validate reproduces class-validator: properties in declaration order, the
// constraints of one property bottom-up (decorator registration order).
func (d *XDto) Validate() []string {
	var errs []string
	if d.Community != nil && !communityURL.MatchString(*d.Community) {
		errs = append(errs, "Invalid X community URL. It should be in the format: https://x.com/i/communities/1493446837214187523")
	}
	isArticle := d.PostType != nil && *d.PostType == "article"
	replies := []string{"everyone", "following", "mentionedUsers", "subscribers", "verified"}
	if !isArticle && !isIn(d.WhoCanReplyPost, replies...) {
		errs = append(errs, isInMessage("who_can_reply_post", replies...))
	}
	if d.PostType != nil && !isIn(d.PostType, "post", "article") {
		errs = append(errs, isInMessage("post_type", "post", "article"))
	}
	if isArticle {
		if d.ArticleTitle == nil || *d.ArticleTitle == "" {
			errs = append(errs, "Article title is required")
		}
		if d.ArticleTitle == nil {
			errs = append(errs, "article_title must be a string")
		}
		if !isIn(d.ArticleStatus, "draft", "published") {
			errs = append(errs, isInMessage("article_status", "draft", "published"))
		}
	}
	if d.ArticleCover != nil {
		errs = append(errs, d.ArticleCover.Validate()...)
	}
	if _, ok := d.MadeWithAI.(bool); d.MadeWithAI != nil && !ok {
		errs = append(errs, "made_with_ai must be a boolean value")
	}
	if _, ok := d.PaidPartnership.(bool); d.PaidPartnership != nil && !ok {
		errs = append(errs, "paid_partnership must be a boolean value")
	}
	return errs
}

// MediaDto is a media reference (the article cover).
type MediaDto struct {
	ID        *string `json:"id"`
	Path      *string `json:"path"`
	Alt       *string `json:"alt,omitempty"`
	Thumbnail *string `json:"thumbnail,omitempty"`
}

func (m *MediaDto) Validate() []string {
	var errs []string
	if m.ID == nil {
		errs = append(errs, "id should not be null or undefined", "id must be a string")
	}
	path := ""
	if m.Path == nil {
		errs = append(errs, "path should not be null or undefined")
	} else {
		path = *m.Path
	}
	if !helpers.ValidURLExtension(path) {
		errs = append(errs, helpers.ValidURLExtensionMessage)
	}
	if !helpers.IsAllowedUploadPath(path) {
		errs = append(errs, helpers.ValidURLPathMessage())
	}
	if m.Path == nil {
		errs = append(errs, "path must be a string")
	}
	if m.Thumbnail != nil && *m.Thumbnail != "" && !isURL(*m.Thumbnail) {
		errs = append(errs, "thumbnail must be a URL address")
	}
	return errs
}

// isURL approximates validator.js isURL defaults: http/https/ftp (or no
// protocol) and a host with a top-level domain.
func isURL(value string) bool {
	if !strings.Contains(value, "://") {
		value = "http://" + value
	}
	u, err := url.Parse(value)
	if err != nil || !slices.Contains([]string{"http", "https", "ftp"}, u.Scheme) {
		return false
	}
	host := u.Hostname()
	return strings.Contains(host, ".") && !strings.HasSuffix(host, ".") && !strings.ContainsAny(host, " _")
}
