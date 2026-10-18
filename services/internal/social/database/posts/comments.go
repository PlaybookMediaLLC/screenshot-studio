package posts

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	commentdtos "github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/dtos/comments"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/helpers"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/httpx"
)

// PreviewComment is one comment of a preview, with its author's name.
type PreviewComment struct {
	ID          string  `json:"id"`
	PostID      string  `json:"postId"`
	ParentID    *string `json:"parentId"`
	Content     string  `json:"content"`
	AnchorStart *int    `json:"anchorStart"`
	AnchorEnd   *int    `json:"anchorEnd"`
	AnchorQuote *string `json:"anchorQuote"`
	ResolvedAt  *Date   `json:"resolvedAt"`
	CreatedAt   Date    `json:"createdAt"`
	Name        *string `json:"name"`
}

func (s *Service) GetComments(ctx context.Context, previewID string) ([]PreviewComment, error) {
	posts, err := s.GetPostsRecursively(ctx, previewID, false, "")
	if err != nil {
		return nil, err
	}
	ids := make([]string, 0, len(posts))
	for _, p := range posts {
		ids = append(ids, p.ID)
	}
	list, err := s.repo.GetCommentsForPosts(ctx, ids)
	if err != nil {
		return nil, err
	}

	out := make([]PreviewComment, 0, len(list))
	for _, c := range list {
		name := c.DisplayName
		if deref(c.UserID) != "" {
			name = nil
			if u := c.Edges.User; u != nil {
				var parts []string
				for _, part := range []string{deref(u.Name), deref(u.LastName)} {
					if part != "" {
						parts = append(parts, part)
					}
				}
				if joined := strings.TrimSpace(strings.Join(parts, " ")); joined != "" {
					name = &joined
				}
			}
		}
		out = append(out, PreviewComment{
			ID: c.ID, PostID: c.PostID, ParentID: c.ParentID, Content: c.Content, AnchorStart: c.AnchorStart,
			AnchorEnd: c.AnchorEnd, AnchorQuote: c.AnchorQuote, ResolvedAt: datePtr(c.ResolvedAt),
			CreatedAt: Date{c.CreatedAt}, Name: name,
		})
	}
	return out, nil
}

// CreatePublicComment adds a comment on a preview; userID "" is an anonymous
// visitor, who must give a name and pass the captcha.
func (s *Service) CreatePublicComment(ctx context.Context, previewID string, body *commentdtos.CreatePublicCommentDto, userID, ip string) (*ent.Comments, error) {
	posts, err := s.GetPostsRecursively(ctx, previewID, false, "")
	if err != nil {
		return nil, err
	}
	if len(posts) == 0 {
		return nil, httpx.NotFound("Post not found")
	}

	find := func(id string) *ent.Post {
		for _, p := range posts {
			if p.ID == id {
				return p
			}
		}
		return nil
	}

	p := posts[0]
	if body.PostID != "" {
		p = find(body.PostID)
	}
	if p == nil {
		return nil, httpx.BadRequest("Post does not belong to this preview")
	}

	if userID == "" {
		if body.DisplayName == nil || strings.TrimSpace(*body.DisplayName) == "" {
			return nil, httpx.BadRequest("Name is required")
		}
		if err := verifyRecaptcha(ctx, body.RecaptchaToken, ip); err != nil {
			return nil, err
		}
	}

	hasStart := body.AnchorStart != nil
	hasEnd := body.AnchorEnd != nil
	if hasStart != hasEnd {
		return nil, httpx.BadRequest("Both anchor offsets are required")
	}

	if body.ParentID != "" {
		parent, err := s.repo.GetCommentByID(ctx, body.ParentID)
		if err != nil {
			return nil, err
		}
		if parent == nil || find(parent.PostID) == nil {
			return nil, httpx.BadRequest("Parent comment not found")
		}
		if deref(parent.ParentID) != "" {
			return nil, httpx.BadRequest("Replies can only be added to a root comment")
		}
		if hasStart || deref(body.AnchorQuote) != "" {
			return nil, httpx.BadRequest("Replies cannot be anchored")
		}
		p = find(parent.PostID)
	}

	if hasStart {
		plainText := helpers.PostContentPlainText(p.Content)
		start, end := *body.AnchorStart, *body.AnchorEnd
		if start < 0 || start >= end || end > jsLength(plainText) {
			return nil, httpx.BadRequest("Anchor is out of range")
		}
		if body.AnchorQuote == nil || *body.AnchorQuote != jsSlice(plainText, start, end) {
			return nil, httpx.BadRequest("Anchor does not match the post text")
		}
	}

	extra := CommentExtra{ParentID: body.ParentID}
	if userID == "" {
		name := strings.TrimSpace(*body.DisplayName)
		extra.DisplayName = &name
	}
	if hasStart {
		extra.AnchorStart, extra.AnchorEnd, extra.AnchorQuote = body.AnchorStart, body.AnchorEnd, body.AnchorQuote
	}
	return s.repo.CreateComment(ctx, p.OrganizationID, userID, p.ID, body.Content, extra)
}

func verifyRecaptcha(ctx context.Context, token, ip string) error {
	secret := os.Getenv("RECAPTCHA_SECRET_KEY")
	if secret == "" {
		return nil
	}

	failed := httpx.BadRequest("Captcha verification failed")
	if token == "" {
		return failed
	}

	form := url.Values{"secret": {secret}, "response": {token}, "remoteip": {ip}}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://www.google.com/recaptcha/api/siteverify", strings.NewReader(form.Encode()))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()

	var result struct {
		Success bool `json:"success"`
	}
	if err := json.NewDecoder(res.Body).Decode(&result); err != nil {
		return err
	}
	if !result.Success {
		return failed
	}
	return nil
}

func (s *Service) ResolveComment(ctx context.Context, orgID, commentID string, resolved bool) (*ent.Comments, error) {
	comment, err := s.repo.GetCommentByID(ctx, commentID)
	if err != nil {
		return nil, err
	}
	if comment == nil || comment.Edges.Post == nil || comment.Edges.Post.OrganizationID != orgID {
		return nil, httpx.NotFound("Comment not found")
	}
	if deref(comment.ParentID) != "" {
		return nil, httpx.BadRequest("Only root comments can be resolved")
	}

	var resolvedAt *time.Time
	if resolved {
		now := time.Now()
		resolvedAt = &now
	}
	return s.repo.SetCommentResolved(ctx, commentID, resolvedAt)
}

// DetachStaleAnchors: a comment anchored to a span of text keeps its quote
// but loses the highlight once the span no longer reads the same on the new
// content.
func (s *Service) DetachStaleAnchors(ctx context.Context, posts []*ent.Post) error {
	for _, p := range posts {
		anchored, err := s.repo.GetAnchoredCommentsForPost(ctx, p.ID)
		if err != nil {
			return err
		}
		if len(anchored) == 0 {
			continue
		}

		plainText := helpers.PostContentPlainText(p.Content)
		var stale []string
		for _, c := range anchored {
			end := 0
			if c.AnchorEnd != nil {
				end = *c.AnchorEnd
			}
			if c.AnchorQuote == nil || *c.AnchorQuote != jsSlice(plainText, *c.AnchorStart, end) {
				stale = append(stale, c.ID)
			}
		}

		if len(stale) > 0 {
			if _, err := s.repo.DetachAnchorsForPost(ctx, p.ID, stale); err != nil {
				return err
			}
		}
	}
	return nil
}
