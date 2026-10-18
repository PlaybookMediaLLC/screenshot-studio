// Package content ports the content controllers of apps/backend/src/api/routes:
// posts, public, media (+ widget), clipping (+ widget), copilot, oauth,
// oauth-app and approved-apps.
package content

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"iter"
	"net/http"
	"net/url"
	"slices"
	"strings"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/backend/auth"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/database/media"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/database/oauth"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/dtos/generator"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/httpx"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/track"
)

// AgentGraphService is the part of the agent graph service the posts
// controller uses (internal/agent).
type AgentGraphService interface {
	// Start is start(orgId, body): the LangGraph streamEvents stream. A
	// failure is yielded as the last element.
	Start(ctx context.Context, orgID string, body *generator.GeneratorDto) iter.Seq2[any, error]
}

// AgentGraphInsertService is the part of the agent graph insert service
// the public controller uses (internal/agent).
type AgentGraphInsertService interface {
	NewPost(ctx context.Context, post string) (any, error)
}

// ShortLinkService is the part of the short link service the
// posts controller uses (internal/shortlink).
type ShortLinkService interface {
	AskShortLinkedin(messages []string) bool
}

// TrackService is the track service (internal/track).
type TrackService interface {
	Track(ctx context.Context, uniqueID, ip, agent string, tt track.Enum, additional map[string]any, fbclid string, user *ent.User) error
}

// UploadedFile is the Express.Multer.File the controllers read.
type UploadedFile struct {
	Filename     string
	Path         string
	Mimetype     string
	Originalname string
}

// Uploader is the part of the upload library the media controllers use
// (internal/upload).
type Uploader interface {
	// UploadSimple is UploadFactory.createStorage().uploadSimple(path).
	UploadSimple(ctx context.Context, path string) (string, error)
	// ReceiveFile is FileInterceptor(field, streamUploadOptions()): the
	// stored file (nil when the request has none) and the text fields
	// (req.body).
	ReceiveFile(ctx context.Context, r *http.Request, field string) (*UploadedFile, map[string]string, error)
	// HandleR2Upload is handleR2Upload(endpoint, req, res): it answers the
	// request itself except a successful complete-multipart-upload, whose
	// result is returned unsent.
	HandleR2Upload(ctx context.Context, c *httpx.Ctx, endpoint string) (map[string]any, error)
}

// Thread is one Mastra memory thread.
type Thread struct {
	ID    string
	Title string
}

// AgentMemory is the memory of the Mastra 'postiz' agent
// (mastra.getAgent('postiz').getMemory(), internal/chat).
type AgentMemory interface {
	// Recall is memory.recall({ resourceId, threadId }).
	Recall(ctx context.Context, resourceID, threadID string) (any, error)
	// ListThreads is memory.listThreads({ filter: { resourceId }, perPage:
	// 100000, page: 0, orderBy: { field: 'createdAt', direction: 'DESC' } }).
	ListThreads(ctx context.Context, resourceID string) ([]Thread, error)
}

// MCPRelayService is the part of the mcp relay service the OAuth
// controller uses (internal/chat).
type MCPRelayService interface {
	Connect(ctx context.Context, instanceURL, apiKey string) (*oauth.SelfHostedInstance, error)
}

// nullable turns a nil result into an empty response instead of JSON null
// (a typed nil pointer would otherwise be encoded).
func nullable[T any](v *T, err error) (any, error) {
	if err != nil || v == nil {
		return nil, err
	}
	return v, nil
}

// subscriptionError renders the media/clipping services' SubscriptionException
// through SubscriptionExceptionFilter (402 {statusCode, message, url}).
func subscriptionError(err error) error {
	var se *media.SubscriptionError
	if errors.As(err, &se) {
		return auth.SubscriptionException(auth.Sections(se.Section), auth.AuthorizationActions(se.Action))
	}
	return err
}

// lastSegment is path.split('/').pop().
func lastSegment(path string) string {
	return path[strings.LastIndex(path, "/")+1:]
}

// rewriteObject re-encodes a JSON object in its key order without the drop
// keys and with the replace values in place, like `({ a, ...p }) => ({ ...p,
// key: value })`.
func rewriteObject(data []byte, drop []string, replace map[string]any) (json.RawMessage, error) {
	dec := json.NewDecoder(bytes.NewReader(data))
	if _, err := dec.Token(); err != nil {
		return nil, err
	}
	var buf bytes.Buffer
	buf.WriteByte('{')
	for dec.More() {
		tok, err := dec.Token()
		if err != nil {
			return nil, err
		}
		key, _ := tok.(string)
		var value json.RawMessage
		if err := dec.Decode(&value); err != nil {
			return nil, err
		}
		if slices.Contains(drop, key) {
			continue
		}
		if r, ok := replace[key]; ok {
			if value, err = json.Marshal(r); err != nil {
				return nil, err
			}
		}
		if buf.Len() > 1 {
			buf.WriteByte(',')
		}
		k, _ := json.Marshal(key)
		buf.Write(k)
		buf.WriteByte(':')
		buf.Write(value)
	}
	buf.WriteByte('}')
	return buf.Bytes(), nil
}

// jsURL is `new URL(raw)`: an absolute URL, with the "/" path WHATWG adds to
// special URLs that have none.
func jsURL(raw string) (*url.URL, error) {
	u, err := url.Parse(raw)
	if err != nil {
		return nil, err
	}
	if u.Scheme == "" {
		return nil, errors.New("TypeError: Invalid URL")
	}
	if u.Path == "" && u.Host != "" && (u.Scheme == "http" || u.Scheme == "https") {
		u.Path = "/"
	}
	return u, nil
}

// setSearchParam is url.searchParams.set(key, value): the first pair named key
// is replaced (the others dropped), or the pair is appended, keeping order.
func setSearchParam(u *url.URL, key, value string) {
	var pairs []string
	set := false
	for _, pair := range strings.Split(u.RawQuery, "&") {
		if pair == "" {
			continue
		}
		name, _, hasValue := strings.Cut(pair, "=")
		if decoded, err := url.QueryUnescape(name); err == nil && decoded == key {
			if set {
				continue
			}
			set = true
			pair = url.QueryEscape(key) + "=" + url.QueryEscape(value)
		} else if !hasValue {
			pair += "="
		}
		pairs = append(pairs, pair)
	}
	if !set {
		pairs = append(pairs, url.QueryEscape(key)+"="+url.QueryEscape(value))
	}
	u.RawQuery = strings.Join(pairs, "&")
}

// exceptionMessage is `err instanceof HttpException ? err.message : ...`.
func exceptionMessage(err error) (string, bool) {
	var he *httpx.Error
	if !errors.As(err, &he) {
		return "", false
	}
	if s, ok := he.Body.(string); ok {
		return s, true
	}
	if m := he.Message(); m != "" {
		return m, true
	}
	return "Http Exception", true
}
