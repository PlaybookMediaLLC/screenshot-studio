package bluesky

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"strings"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/ssrf"
)

// The parts of @atproto/api's AtpAgent (CredentialSession + XrpcClient) the
// provider uses, called as plain XRPC HTTP endpoints.

// responseTypeStrings is @atproto/xrpc's ResponseTypeStrings.
var responseTypeStrings = map[int]string{
	1: "Unknown", 2: "Invalid Response", 200: "Success", 400: "Invalid Request",
	401: "Authentication Required", 403: "Forbidden", 404: "XRPC Not Supported",
	406: "Not Acceptable", 413: "Payload Too Large", 415: "Unsupported Media Type",
	429: "Rate Limit Exceeded", 500: "Internal Server Error", 501: "Method Not Implemented",
	502: "Upstream Failure", 503: "Not Enough Resources", 504: "Upstream Timeout",
}

var responseTypeNames = map[int]string{
	1: "Unknown", 2: "InvalidResponse", 200: "Success", 400: "InvalidRequest",
	401: "AuthenticationRequired", 403: "Forbidden", 404: "XRPCNotSupported",
	406: "NotAcceptable", 413: "PayloadTooLarge", 415: "UnsupportedMediaType",
	429: "RateLimitExceeded", 500: "InternalServerError", 501: "MethodNotImplemented",
	502: "UpstreamFailure", 503: "NotEnoughResources", 504: "UpstreamTimeout",
}

// statusEnum is httpResponseCodeToEnum: statuses the client does not know
// collapse, e.g. 408 becomes 400.
func statusEnum(status int) int {
	if _, ok := responseTypeNames[status]; ok {
		return status
	}
	switch {
	case status >= 100 && status < 200, status >= 300 && status < 400:
		return 404
	case status >= 200 && status < 300:
		return 200
	case status >= 400 && status < 500:
		return 400
	}
	return 500
}

// XRPCError is @atproto/xrpc's XRPCError. Transport failures are returned as
// plain errors instead (they have no status).
type XRPCError struct {
	Status  int    `json:"status"`
	Name    string `json:"error"`
	Message string `json:"-"`
}

func (e *XRPCError) Error() string {
	if e.Message != "" {
		return e.Message
	}
	if e.Name != "" {
		return e.Name
	}
	return responseTypeStrings[e.Status]
}

func (e *XRPCError) MarshalJSON() ([]byte, error) {
	return json.Marshal(map[string]any{"error": e.Name, "success": false, "status": e.Status})
}

type session struct {
	AccessJwt  string          `json:"accessJwt"`
	RefreshJwt string          `json:"refreshJwt"`
	Handle     string          `json:"handle"`
	Did        string          `json:"did"`
	DidDoc     json.RawMessage `json:"didDoc,omitempty"`
}

type agent struct {
	service *url.URL
	pds     *url.URL
	session *session
	client  *http.Client
}

func newAgent(service string) (*agent, error) {
	u, err := url.Parse(service)
	if err != nil || u.Scheme == "" || u.Host == "" {
		return nil, fmt.Errorf("Invalid URL: %s", service)
	}
	return &agent{service: u, client: ssrf.Client()}, nil
}

// dispatchURL is the PDS from the session's DID document, else the service.
func (a *agent) dispatchURL() *url.URL {
	if a.pds != nil {
		return a.pds
	}
	return a.service
}

// xrpcRequest is one XRPC call: a query when body is nil, else a procedure.
type xrpcRequest struct {
	nsid        string
	params      url.Values
	body        []byte
	contentType string
	// authorization overrides the session's access token.
	authorization string
}

func (a *agent) call(ctx context.Context, req xrpcRequest, out any) error {
	status, data, err := a.do(ctx, a.dispatchURL(), req)
	if err != nil {
		return err
	}
	// the access token expired mid-run: refresh once and replay
	if status != nil && status.Status == 400 && status.Name == "ExpiredToken" && req.authorization == "" && a.session != nil && a.session.RefreshJwt != "" {
		accessJwt := a.session.AccessJwt
		if a.refreshSession(ctx) == nil && a.session != nil && a.session.AccessJwt != accessJwt {
			status, data, err = a.do(ctx, a.dispatchURL(), req)
			if err != nil {
				return err
			}
		}
	}
	if status != nil {
		return status
	}
	if out == nil {
		return nil
	}
	return json.Unmarshal(data, out)
}

func (a *agent) do(ctx context.Context, base *url.URL, req xrpcRequest) (*XRPCError, []byte, error) {
	target := base.ResolveReference(&url.URL{Path: "/xrpc/" + req.nsid, RawQuery: req.params.Encode()})
	method := http.MethodGet
	var body io.Reader
	if req.body != nil {
		method = http.MethodPost
		body = bytes.NewReader(req.body)
	}
	httpReq, err := http.NewRequestWithContext(ctx, method, target.String(), body)
	if err != nil {
		return nil, nil, err
	}
	if req.contentType != "" {
		httpReq.Header.Set("Content-Type", req.contentType)
	}
	switch {
	case req.authorization != "":
		httpReq.Header.Set("Authorization", req.authorization)
	case a.session != nil:
		httpReq.Header.Set("Authorization", "Bearer "+a.session.AccessJwt)
	}
	res, err := a.client.Do(httpReq)
	if err != nil {
		return nil, nil, err
	}
	defer res.Body.Close()
	data, err := io.ReadAll(res.Body)
	if err != nil {
		return nil, nil, err
	}
	code := statusEnum(res.StatusCode)
	if code == 200 {
		return nil, data, nil
	}
	xrpcErr := &XRPCError{Status: code, Name: responseTypeNames[code]}
	if mediaType, _, _ := mime.ParseMediaType(res.Header.Get("Content-Type")); strings.Contains(mediaType, "application/json") {
		var payload struct {
			Error   *string `json:"error"`
			Message *string `json:"message"`
		}
		if json.Unmarshal(data, &payload) == nil {
			if payload.Error != nil {
				xrpcErr.Name = *payload.Error
			}
			if payload.Message != nil {
				xrpcErr.Message = *payload.Message
			}
		}
	}
	return xrpcErr, data, nil
}

func jsonBody(v any) []byte {
	data, _ := json.Marshal(v)
	return data
}

// login is agent.login (com.atproto.server.createSession).
func (a *agent) login(ctx context.Context, identifier, password string) error {
	a.session = nil
	var s session
	err := a.call(ctx, xrpcRequest{
		nsid:        "com.atproto.server.createSession",
		body:        jsonBody(map[string]string{"identifier": identifier, "password": password}),
		contentType: "application/json",
	}, &s)
	if err != nil {
		return err
	}
	a.session = &s
	a.updateAPIEndpoint(s.DidDoc)
	return nil
}

func (a *agent) refreshSession(ctx context.Context) error {
	var s session
	status, data, err := a.do(ctx, a.service, xrpcRequest{
		nsid:          "com.atproto.server.refreshSession",
		body:          []byte{},
		authorization: "Bearer " + a.session.RefreshJwt,
	})
	if err != nil {
		return err
	}
	if status != nil {
		if status.Name == "ExpiredToken" || status.Name == "InvalidToken" {
			a.session = nil
		}
		return status
	}
	if err := json.Unmarshal(data, &s); err != nil {
		return err
	}
	a.session = &s
	a.updateAPIEndpoint(s.DidDoc)
	return nil
}

// updateAPIEndpoint captures the PDS endpoint of the DID document: it may
// differ from the endpoint used to contact the server.
func (a *agent) updateAPIEndpoint(raw json.RawMessage) {
	a.pds = nil
	var doc struct {
		ID      *string `json:"id"`
		Service []struct {
			ID              *string         `json:"id"`
			Type            *string         `json:"type"`
			ServiceEndpoint json.RawMessage `json:"serviceEndpoint"`
		} `json:"service"`
	}
	if len(raw) == 0 || json.Unmarshal(raw, &doc) != nil || doc.ID == nil {
		return
	}
	for _, s := range doc.Service {
		if s.ID == nil || s.Type == nil {
			return
		}
	}
	for _, s := range doc.Service {
		if *s.ID != "#atproto_pds" && *s.ID != *doc.ID+"#atproto_pds" {
			continue
		}
		var endpoint string
		if *s.Type != "AtprotoPersonalDataServer" || json.Unmarshal(s.ServiceEndpoint, &endpoint) != nil {
			return
		}
		if !strings.HasPrefix(endpoint, "http://") && !strings.HasPrefix(endpoint, "https://") {
			return
		}
		if u, err := url.Parse(endpoint); err == nil && u.Host != "" {
			a.pds = u
		}
		return
	}
}

func (a *agent) accountDid() (string, error) {
	if a.session == nil {
		return "", errors.New("Not logged in")
	}
	return a.session.Did, nil
}

type profile struct {
	DisplayName string `json:"displayName"`
	Avatar      string `json:"avatar"`
	Handle      string `json:"handle"`
}

func (a *agent) getProfile(ctx context.Context, actor string) (*profile, error) {
	var out profile
	return &out, a.call(ctx, xrpcRequest{nsid: "app.bsky.actor.getProfile", params: url.Values{"actor": {actor}}}, &out)
}

type threadPost struct {
	URI       string          `json:"uri"`
	CID       string          `json:"cid"`
	LikeCount *float64        `json:"likeCount"`
	Record    json.RawMessage `json:"record"`
}

// replyRoot is record.reply.root of a thread post.
func (p *threadPost) replyRoot() (uri, cid string) {
	var record struct {
		Reply struct {
			Root struct {
				URI string `json:"uri"`
				CID string `json:"cid"`
			} `json:"root"`
		} `json:"reply"`
	}
	_ = json.Unmarshal(p.Record, &record)
	return record.Reply.Root.URI, record.Reply.Root.CID
}

// getPostThread returns thread.post (nil when the thread is not a post view).
func (a *agent) getPostThread(ctx context.Context, uri string) (*threadPost, error) {
	var out struct {
		Thread struct {
			Post *threadPost `json:"post"`
		} `json:"thread"`
	}
	err := a.call(ctx, xrpcRequest{nsid: "app.bsky.feed.getPostThread", params: url.Values{"uri": {uri}, "depth": {"0"}}}, &out)
	return out.Thread.Post, err
}

type actor struct {
	Handle      string `json:"handle"`
	DisplayName string `json:"displayName"`
	Avatar      string `json:"avatar"`
}

func (a *agent) searchActors(ctx context.Context, q string) ([]actor, error) {
	var out struct {
		Actors []actor `json:"actors"`
	}
	return out.Actors, a.call(ctx, xrpcRequest{nsid: "app.bsky.actor.searchActors", params: url.Values{"q": {q}}}, &out)
}

func (a *agent) resolveHandle(ctx context.Context, handle string) (string, error) {
	var out struct {
		Did string `json:"did"`
	}
	return out.Did, a.call(ctx, xrpcRequest{nsid: "com.atproto.identity.resolveHandle", params: url.Values{"handle": {handle}}}, &out)
}

// uploadBlob returns the blob ref exactly as the PDS serialized it.
func (a *agent) uploadBlob(ctx context.Context, data []byte) (json.RawMessage, error) {
	var out struct {
		Blob json.RawMessage `json:"blob"`
	}
	return out.Blob, a.call(ctx, xrpcRequest{nsid: "com.atproto.repo.uploadBlob", body: data, contentType: "application/octet-stream"}, &out)
}

type createdRecord struct {
	URI string `json:"uri"`
	CID string `json:"cid"`
}

// createRecord is `<collection>.create({ repo: accountDid }, record)`.
func (a *agent) createRecord(ctx context.Context, collection string, record map[string]any) (*createdRecord, error) {
	repo, err := a.accountDid()
	if err != nil {
		return nil, err
	}
	record["$type"] = collection
	var out createdRecord
	return &out, a.call(ctx, xrpcRequest{
		nsid:        "com.atproto.repo.createRecord",
		body:        jsonBody(map[string]any{"collection": collection, "repo": repo, "record": record}),
		contentType: "application/json",
	}, &out)
}

type strongRef struct {
	URI string `json:"uri"`
	CID string `json:"cid"`
}

func (a *agent) repost(ctx context.Context, uri, cid string) (*createdRecord, error) {
	return a.createRecord(ctx, "app.bsky.feed.repost", map[string]any{
		"subject": strongRef{URI: uri, CID: cid}, "createdAt": nowISO(),
	})
}

type jobStatus struct {
	JobID    string          `json:"jobId"`
	Did      string          `json:"did,omitempty"`
	State    string          `json:"state"`
	Progress *int            `json:"progress,omitempty"`
	Blob     json.RawMessage `json:"blob,omitempty"`
	Error    string          `json:"error,omitempty"`
	Message  string          `json:"message,omitempty"`
}
