package frontenddeploy

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/frontenddeploy/vercelapi"
	"github.com/cloudflare/cloudflare-go/v7/option"
	"github.com/cloudflare/cloudflare-go/v7/pages"
	"github.com/cloudflare/cloudflare-go/v7/workers"
	netlifyauth "github.com/go-openapi/runtime/client"
	"github.com/netlify/open-api/v2/go/plumbing"
	"github.com/netlify/open-api/v2/go/plumbing/operations"
)

const providerTimeout = 15 * time.Second

// SDKs own endpoint/parameter serialization and provider response contracts.
// This transport keeps the same egress, size and failure guarantees for all of
// them. Retries remain owned by durable maintenance, not hidden SDK loops.
func (c Client) sdkHTTP(host string) *http.Client {
	transport := http.DefaultTransport
	if c.HTTP != nil && c.HTTP.Transport != nil {
		transport = c.HTTP.Transport
	}
	return &http.Client{
		Timeout:       providerTimeout,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
		Transport:     sdkTransport{host: host, next: transport},
	}
}

type sdkTransport struct {
	host string
	next http.RoundTripper
}

func (t sdkTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	if r.Method != http.MethodGet || r.URL.Scheme != "https" || r.URL.Host != t.host || r.URL.User != nil {
		return nil, &APIError{Code: "provider_request_rejected"}
	}
	res, err := t.next.RoundTrip(r)
	if err != nil {
		return nil, &APIError{Code: "provider_unavailable"}
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		code := "provider_unavailable"
		switch res.StatusCode {
		case 401:
			code = "credential_revoked"
		case 403:
			code = "permission_missing"
		case 404:
			code = "project_unavailable"
		case 429:
			code = "rate_limited"
		}
		delay, _ := strconv.Atoi(res.Header.Get("Retry-After"))
		return nil, &APIError{Code: code, RetryAfter: time.Duration(max(delay, 0)) * time.Second}
	}
	body, err := io.ReadAll(io.LimitReader(res.Body, MaxBody+1))
	if len(body) > MaxBody {
		return nil, &APIError{Code: "provider_response_too_large"}
	}
	if err != nil {
		return nil, &APIError{Code: "provider_unavailable"}
	}
	if !json.Valid(body) {
		return nil, ErrPayload
	}
	if t.host == "api.cloudflare.com" {
		var envelope struct {
			Success bool `json:"success"`
		}
		if json.Unmarshal(body, &envelope) != nil || !envelope.Success {
			return nil, ErrPayload
		}
	}
	res.Body = io.NopCloser(bytes.NewReader(body))
	return res, nil
}

func sdkError(err error) error {
	var api *APIError
	if errors.As(err, &api) {
		return api
	}
	// Never expose SDK errors containing provider response bodies or tokens.
	return ErrPayload
}

// Use the provider service packages directly. Setting their public parameter
// fields avoids importing the root SDK, which imports every Cloudflare service.
func (c Client) cloudflareOptions(token string) []option.RequestOption {
	return []option.RequestOption{
		option.WithBaseURL("https://api.cloudflare.com/client/v4/"),
		option.WithAPIToken(token),
		option.WithHTTPClient(c.sdkHTTP("api.cloudflare.com")),
		option.WithMaxRetries(0), option.WithRequestTimeout(providerTimeout),
	}
}

func netlifySDK() *plumbing.Netlify {
	transport := netlifyauth.New(plumbing.DefaultHost, plumbing.DefaultBasePath, plumbing.DefaultSchemes)
	// go-openapi otherwise inherits DEBUG/SWAGGER_DEBUG and dumps requests,
	// including the tenant bearer token, before our HTTP transport sees them.
	transport.Debug = false
	return plumbing.New(transport, nil)
}

func (c Client) project(ctx context.Context, provider, account, project, token string) ([]byte, error) {
	switch provider {
	case "netlify":
		params := operations.NewGetSiteParams().WithContext(ctx).WithTimeout(providerTimeout).
			WithHTTPClient(c.sdkHTTP("api.netlify.com")).WithSiteID(project)
		res, err := netlifySDK().Operations.GetSite(params, netlifyauth.BearerToken(token))
		if err != nil {
			return nil, sdkError(err)
		}
		if res.Payload == nil {
			return nil, ErrPayload
		}
		return json.Marshal(res.Payload)
	case "cloudflare_pages":
		params := pages.ProjectGetParams{}
		params.AccountID.Value, params.AccountID.Present = url.PathEscape(account), true
		res, err := pages.NewProjectService(c.cloudflareOptions(token)...).Get(ctx, url.PathEscape(project), params)
		if err != nil {
			return nil, sdkError(err)
		}
		return json.Marshal(struct {
			Success bool            `json:"success"`
			Result  json.RawMessage `json:"result"`
		}{true, json.RawMessage(res.JSON.RawJSON())})
	case "cloudflare_workers":
		return c.deployments(ctx, provider, account, project, token, 1)
	case "vercel":
		sdk, err := vercelapi.NewClient("https://api.vercel.com", vercelapi.WithHTTPClient(c.sdkHTTP("api.vercel.com")), vercelapi.WithRequestEditorFn(bearer(token)))
		if err != nil {
			return nil, sdkError(err)
		}
		return sdkBody(sdk.GetProject(ctx, project, &vercelapi.GetProjectParams{TeamId: &account}))
	default:
		return nil, ErrPayload
	}
}

func (c Client) deployments(ctx context.Context, provider, account, project, token string, page int) ([]byte, error) {
	switch provider {
	case "netlify":
		pageNumber, perPage := int32(page), int32(50)
		params := operations.NewListSiteDeploysParams().WithContext(ctx).WithTimeout(providerTimeout).
			WithHTTPClient(c.sdkHTTP("api.netlify.com")).WithSiteID(project).WithPage(&pageNumber).WithPerPage(&perPage)
		res, err := netlifySDK().Operations.ListSiteDeploys(params, netlifyauth.BearerToken(token))
		if err != nil {
			return nil, sdkError(err)
		}
		if res.Payload == nil {
			return nil, ErrPayload
		}
		for _, deploy := range res.Payload {
			if deploy == nil {
				return nil, ErrPayload
			}
		}
		return json.Marshal(res.Payload)
	case "cloudflare_pages":
		params := pages.ProjectDeploymentListParams{}
		params.AccountID.Value, params.AccountID.Present = url.PathEscape(account), true
		params.Page.Value, params.Page.Present = int64(page), true
		params.PerPage.Value, params.PerPage.Present = 50, true
		res, err := pages.NewProjectDeploymentService(c.cloudflareOptions(token)...).List(ctx, url.PathEscape(project), params)
		if err != nil {
			return nil, sdkError(err)
		}
		return []byte(res.JSON.RawJSON()), nil
	case "cloudflare_workers":
		params := workers.ScriptDeploymentListParams{}
		params.AccountID.Value, params.AccountID.Present = url.PathEscape(account), true
		params.Page.Value, params.Page.Present = int64(page), true
		params.PerPage.Value, params.PerPage.Present = 50, true
		res, err := workers.NewScriptDeploymentService(c.cloudflareOptions(token)...).List(ctx, url.PathEscape(project), params)
		if err != nil {
			return nil, sdkError(err)
		}
		// Preserve the raw envelope: the SDK's generic pagination Items field
		// does not model this endpoint's result.deployments collection.
		return []byte(res.JSON.RawJSON()), nil
	default:
		return nil, ErrPayload
	}
}

func (c Client) vercelChecks(ctx context.Context, account, deployment, token string) ([]byte, error) {
	sdk, err := vercelapi.NewClient("https://api.vercel.com", vercelapi.WithHTTPClient(c.sdkHTTP("api.vercel.com")), vercelapi.WithRequestEditorFn(bearer(token)))
	if err != nil {
		return nil, sdkError(err)
	}
	return sdkBody(sdk.GetAllChecks(ctx, deployment, &vercelapi.GetAllChecksParams{TeamId: &account}))
}

func bearer(token string) vercelapi.RequestEditorFn {
	return func(_ context.Context, r *http.Request) error {
		r.Header.Set("Authorization", "Bearer "+token)
		r.Header.Set("Accept", "application/json")
		return nil
	}
}

func sdkBody(res *http.Response, err error) ([]byte, error) {
	if err != nil {
		return nil, sdkError(err)
	}
	defer res.Body.Close()
	return io.ReadAll(res.Body) // sdkTransport has already bounded and validated it.
}
