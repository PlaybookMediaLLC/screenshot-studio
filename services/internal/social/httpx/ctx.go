package httpx

import (
	"bytes"
	"crypto/sha1"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent"
)

// MaxBody is the default JSON body limit (Express's json() default is 100kb;
// Postiz raises /posts and /copilot to 50mb, which BodyLimit restores).
const MaxBody = 100 << 10

// Ctx carries one request through middleware and the handler. The auth
// middleware fills User and Org the way Postiz fills req.user and req.org.
type Ctx struct {
	W      http.ResponseWriter
	R      *http.Request
	params map[string]string

	// User is the authenticated user (req.user). Never serialize it raw.
	User *ent.User
	// Org is the active organization (req.org) with Edges.Users holding the
	// caller's membership as users[0], and Edges.Subscription when loaded.
	Org *ent.Organization

	// Public API request state.
	IsOAuthApp     bool
	AuthOrgID      string
	IncludeDeleted bool
	OAuthUserID    string

	bodyLimit int64
	body      []byte
	bodyRead  bool
	written   bool
}

func newCtx(w http.ResponseWriter, r *http.Request, params map[string]string) *Ctx {
	return &Ctx{W: w, R: r, params: params, bodyLimit: MaxBody}
}

// Param returns a path parameter.
func (c *Ctx) Param(name string) string { return c.params[name] }

// Query returns a query string value.
func (c *Ctx) Query(name string) string { return c.R.URL.Query().Get(name) }

// Header returns a request header.
func (c *Ctx) Header(name string) string { return c.R.Header.Get(name) }

// Cookie returns a cookie value or "".
func (c *Ctx) Cookie(name string) string {
	cookie, err := c.R.Cookie(name)
	if err != nil {
		return ""
	}
	return cookie.Value
}

// Role is the caller's role in the active organization (org.users[0].role).
func (c *Ctx) Role() string {
	if c.Org == nil || len(c.Org.Edges.Users) == 0 {
		return ""
	}
	return string(c.Org.Edges.Users[0].Role)
}

// RealIP returns the first X-Forwarded-For entry, then X-Real-IP,
// then the socket address.
func (c *Ctx) RealIP() string {
	if forwarded := c.Header("X-Forwarded-For"); forwarded != "" {
		return strings.TrimSpace(strings.Split(forwarded, ",")[0])
	}
	if real := c.Header("X-Real-IP"); real != "" {
		return real
	}
	host, _, err := net.SplitHostPort(c.R.RemoteAddr)
	if err != nil {
		return c.R.RemoteAddr
	}
	return host
}

// BodyLimit raises the JSON body limit for this request.
func (c *Ctx) BodyLimit(n int64) { c.bodyLimit = n }

// RawBody returns the request body bytes, read once.
func (c *Ctx) RawBody() ([]byte, error) {
	if c.bodyRead {
		return c.body, nil
	}
	c.bodyRead = true
	data, err := io.ReadAll(io.LimitReader(c.R.Body, c.bodyLimit+1))
	if err != nil {
		return nil, BadRequest("Invalid request body")
	}
	if int64(len(data)) > c.bodyLimit {
		return nil, NewError(http.StatusRequestEntityTooLarge, map[string]any{
			"message": "request entity too large", "error": "Payload Too Large", "statusCode": 413,
		})
	}
	c.body = data
	return data, nil
}

// Bind decodes the JSON body into v and validates it, with type
// conversion. An empty body decodes as {}.
func (c *Ctx) Bind(v any) error {
	if err := c.Decode(v); err != nil {
		return err
	}
	return Validate(v)
}

// Decode decodes the JSON body into v without validation (an untyped @Body()).
func (c *Ctx) Decode(v any) error {
	data, err := c.RawBody()
	if err != nil {
		return err
	}
	if len(strings.TrimSpace(string(data))) == 0 {
		data = []byte("{}")
	}
	if err := json.Unmarshal(data, v); err != nil {
		return NewError(http.StatusBadRequest, map[string]any{
			"message": fmt.Sprintf("Unexpected token in JSON: %v", err), "error": "Bad Request", "statusCode": 400,
		})
	}
	return nil
}

// BindQuery decodes the query string into v (fields tagged `query:"name"`,
// falling back to the json tag) and validates it.
func (c *Ctx) BindQuery(v any) error {
	if err := decodeValues(c.R.URL.Query(), v); err != nil {
		return err
	}
	return Validate(v)
}

// SetCookie writes a response cookie.
func (c *Ctx) SetCookie(cookie *http.Cookie) { http.SetCookie(c.W, cookie) }

// SetHeader writes a response header.
func (c *Ctx) SetHeader(name, value string) { c.W.Header().Set(name, value) }

// Redirect sends a redirect and ends the request.
func (c *Ctx) Redirect(status int, location string) {
	c.written = true
	http.Redirect(c.W, c.R, location, status)
}

// JSON writes a JSON response immediately (for handlers using Raw()).
func (c *Ctx) JSON(status int, body any) {
	c.written = true
	writeJSON(c.W, c.R, status, body)
}

// Send writes the body and marks the response as written.
func (c *Ctx) Send(status int, body any) { c.send(status, body) }

func (c *Ctx) send(status int, body any) {
	c.written = true
	h := c.W.Header()
	switch v := body.(type) {
	case nil:
		expressSend(c.W, c.R, status, nil)
	case string:
		if h.Get("Content-Type") == "" {
			h.Set("Content-Type", "text/html; charset=utf-8")
		}
		expressSend(c.W, c.R, status, []byte(v))
	case []byte:
		if h.Get("Content-Type") == "" {
			h.Set("Content-Type", "application/octet-stream")
		}
		expressSend(c.W, c.R, status, v)
	case bool, int, int64, float64:
		h.Set("Content-Type", "text/html; charset=utf-8")
		expressSend(c.W, c.R, status, []byte(fmt.Sprint(v)))
	default:
		writeJSON(c.W, c.R, status, v)
	}
}

// writeJSON is Express's res.json: no HTML escaping (&, <, > stay as-is).
func writeJSON(w http.ResponseWriter, r *http.Request, status int, body any) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(body); err != nil {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		expressSend(w, r, http.StatusInternalServerError, []byte(`{"statusCode":500,"message":"Internal server error"}`))
		return
	}
	if w.Header().Get("Content-Type") == "" {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
	}
	expressSend(w, r, status, bytes.TrimSuffix(buf.Bytes(), []byte("\n")))
}

// expressSend is the tail of Express's res.send: Content-Length, a weak
// ETag, 304 for a fresh conditional GET/HEAD, no body for 204/304 or HEAD.
// A nil chunk is res.send() with no body.
func expressSend(w http.ResponseWriter, r *http.Request, status int, chunk []byte) {
	h := w.Header()
	if chunk != nil {
		h.Set("Content-Length", strconv.Itoa(len(chunk)))
		if h.Get("ETag") == "" {
			h.Set("ETag", weakETag(chunk))
		}
	}
	if isFresh(r, status, h) {
		status = http.StatusNotModified
	}
	if status == http.StatusNoContent || status == http.StatusNotModified {
		h.Del("Content-Type")
		h.Del("Content-Length")
		h.Del("Transfer-Encoding")
		chunk = nil
	}
	w.WriteHeader(status)
	if r.Method != http.MethodHead && len(chunk) > 0 {
		_, _ = w.Write(chunk)
	}
}

// weakETag is the etag package with {weak: true} (Express's default).
func weakETag(body []byte) string {
	if len(body) == 0 {
		return `W/"0-2jmj7l5rSw0yVb/vlWAYkK/YBwk"`
	}
	sum := sha1.Sum(body)
	return fmt.Sprintf(`W/"%x-%s"`, len(body), base64.StdEncoding.EncodeToString(sum[:])[:27])
}

var noCache = regexp.MustCompile(`(?:^|,)\s*?no-cache\s*?(?:,|$)`)

// isFresh is Express's req.fresh (the fresh package).
func isFresh(r *http.Request, status int, res http.Header) bool {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		return false
	}
	if !((status >= 200 && status < 300) || status == http.StatusNotModified) {
		return false
	}
	modifiedSince := r.Header.Get("If-Modified-Since")
	noneMatch := r.Header.Get("If-None-Match")
	if modifiedSince == "" && noneMatch == "" {
		return false
	}
	if cc := r.Header.Get("Cache-Control"); cc != "" && noCache.MatchString(cc) {
		return false
	}
	if noneMatch != "" && noneMatch != "*" {
		etag := res.Get("ETag")
		if etag == "" {
			return false
		}
		stale := true
		for _, match := range parseTokenList(noneMatch) {
			if match == etag || match == "W/"+etag || "W/"+match == etag {
				stale = false
				break
			}
		}
		if stale {
			return false
		}
	}
	if modifiedSince != "" {
		lastModified, err1 := http.ParseTime(res.Get("Last-Modified"))
		since, err2 := http.ParseTime(modifiedSince)
		if err1 != nil || err2 != nil || lastModified.After(since) {
			return false
		}
	}
	return true
}

func parseTokenList(s string) []string {
	var list []string
	start, end := 0, 0
	for i := 0; i < len(s); i++ {
		switch s[i] {
		case ' ':
			if start == end {
				start, end = i+1, i+1
			}
		case ',':
			list = append(list, s[start:end])
			start, end = i+1, i+1
		default:
			end = i + 1
		}
	}
	return append(list, s[start:end])
}

// Written reports whether the response was already sent.
func (c *Ctx) Written() bool { return c.written }

// MarkWritten tells the router the handler streamed the response itself.
func (c *Ctx) MarkWritten() { c.written = true }
