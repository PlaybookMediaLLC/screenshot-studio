package mcp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"slices"
	"strings"
	"sync/atomic"
	"time"

	"github.com/modelcontextprotocol/go-sdk/jsonrpc"
	sdk "github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/chat"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/httpx"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/ssrf"
)

// Every Postiz MCP server since v2.19.0 (the first one with the API key /mcp
// route) has these; a server without them is not a Postiz instance
var requiredTools = []string{"integrationList", "integrationSchedulePostTool"}

// Tool results are small JSON, an instance never needs this server to hold
// more than this in memory
const maxResponseBytes = 10 * 1024 * 1024

var (
	connectTimeout  = 10 * time.Second
	listTimeout     = 10 * time.Second
	callToolTimeout = 90 * time.Second // under the 100 seconds Cloudflare gives a request to the MCP host
	// instanceClient is the pinned-DNS SSRF-safe client; tests swap it.
	instanceClient = ssrf.Client
	// isSafePublicHTTPSURL is the reachability check; tests swap it.
	isSafePublicHTTPSURL = ssrf.IsSafePublicHTTPSURL
)

// SelfHostedOAuthService is the part of oauth.Service the relay uses.
type SelfHostedOAuthService interface {
	DeleteSelfHostedAuthorization(ctx context.Context, id string) error
}

// RelayService is McpRelayService. Postiz Cloud relays the MCP connection of
// a self-hosted Postiz: the person brings the instance and its API key on the
// consent screen ("Use self-hosted"), and the tool calls of that connection
// run on the instance.
type RelayService struct {
	oauth SelfHostedOAuthService
	// coreToolNames is LoadToolsService.coreToolNames().
	coreToolNames []string
}

// NewRelayService takes the whole toolList (for coreToolNames).
func NewRelayService(oauth SelfHostedOAuthService, tools []*chat.Tool) *RelayService {
	return &RelayService{oauth: oauth, coreToolNames: chat.CoreToolNames(tools)}
}

// statusError is StreamableHTTPError: the instance answered an HTTP error.
type statusError struct {
	code int
	err  error
}

func (e *statusError) Error() string { return e.err.Error() }
func (e *statusError) Unwrap() error { return e.err }

// instanceTransport adds the API key, caps the body and remembers a 401/403.
type instanceTransport struct {
	base   http.RoundTripper
	apiKey string
	status atomic.Int32
}

type cappedBody struct {
	io.ReadCloser
	received int64
}

func (b *cappedBody) Read(p []byte) (int, error) {
	n, err := b.ReadCloser.Read(p)
	b.received += int64(n)
	if b.received > maxResponseBytes {
		return n, errors.New("The response of the instance is too large")
	}
	return n, err
}

func (t *instanceTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	req = req.Clone(req.Context())
	req.Header.Set("Authorization", "Bearer "+t.apiKey)
	res, err := t.base.RoundTrip(req)
	if err != nil {
		return nil, err
	}
	if res.StatusCode == http.StatusUnauthorized || res.StatusCode == http.StatusForbidden {
		t.status.Store(int32(res.StatusCode))
	}
	if res.ContentLength > maxResponseBytes {
		res.Body.Close()
		return nil, errors.New("The response of the instance is too large")
	}
	res.Body = &cappedBody{ReadCloser: res.Body}
	return res, nil
}

// withClient connects to the instance, runs fn and ends the session
// (instances older than v2.23.0 keep a session per connection).
func withClient[T any](ctx context.Context, instance chat.SelfHostedInstance, fn func(ctx context.Context, session *sdk.ClientSession) (T, error)) (T, error) {
	var zero T
	base := instanceClient()
	transport := &instanceTransport{base: base.Transport, apiKey: instance.APIKey}
	if transport.base == nil {
		transport.base = http.DefaultTransport
	}
	httpClient := &http.Client{
		Transport: transport,
		// no redirects
		CheckRedirect: func(*http.Request, []*http.Request) error { return errors.New("redirect is not allowed") },
	}
	client := sdk.NewClient(&sdk.Implementation{Name: "Postiz Cloud", Version: "1.0.0"}, nil)
	connectCtx, cancel := context.WithTimeout(ctx, connectTimeout)
	session, err := client.Connect(connectCtx, &sdk.StreamableClientTransport{Endpoint: instance.MCPURL, HTTPClient: httpClient, MaxRetries: -1, DisableStandaloneSSE: true}, nil)
	cancel()
	wrap := func(err error) error {
		if code := transport.status.Load(); code != 0 {
			return &statusError{code: int(code), err: err}
		}
		return err
	}
	if err != nil {
		return zero, wrap(err)
	}
	defer session.Close()
	out, err := fn(ctx, session)
	if err != nil {
		return zero, wrap(err)
	}
	return out, nil
}

var (
	schemePattern   = regexp.MustCompile(`(?i)^[a-z][a-z0-9+.-]*://`)
	settingsPattern = regexp.MustCompile(`^(.*?)/mcp/([^/]+)/?$`)
)

const addressMessage = "Enter the address of your Postiz instance, for example https://postiz.example.com"

// Connect turns what the person typed on the consent screen into the MCP
// endpoint of their instance, and checks that the API key works there.
func (s *RelayService) Connect(ctx context.Context, instanceURL, apiKey string) (*chat.SelfHostedInstance, error) {
	value := strings.TrimSpace(instanceURL)
	if !schemePattern.MatchString(value) {
		value = "https://" + value
	}
	u, err := url.Parse(value)
	if err != nil || u.Host == "" {
		return nil, httpx.HTTPException(addressMessage, http.StatusBadRequest)
	}
	// An address with credentials (an email like me@company.com reads as
	// user "me" on company.com) is never sent anywhere
	if u.User != nil {
		return nil, httpx.HTTPException(addressMessage, http.StatusBadRequest)
	}

	// The MCP URL from Settings > Agents carries the API key: <backend>/mcp/<key>
	pathname := u.EscapedPath()
	if pathname == "" {
		pathname = "/"
	}
	fromSettings := settingsPattern.FindStringSubmatch(pathname)
	key := strings.TrimSpace(apiKey)
	if key == "" && fromSettings != nil {
		key, _ = url.PathUnescape(fromSettings[2])
	}
	if key == "" {
		return nil, httpx.HTTPException("Enter the API key of your Postiz instance", http.StatusBadRequest)
	}

	origin := strings.ToLower(u.Scheme) + "://" + u.Host
	if !isSafePublicHTTPSURL(ctx, origin) {
		return nil, httpx.HTTPException("Your Postiz instance must be reachable from the internet over https", http.StatusBadRequest)
	}

	// The docker image serves the backend under /api of the same domain, a
	// backend on its own domain answers on /mcp
	path := pathname
	if fromSettings != nil {
		path = fromSettings[1]
	}
	path = strings.TrimSuffix(strings.TrimRight(path, "/"), "/mcp")
	candidates := []string{origin + path + "/api/mcp", origin + path + "/mcp"}
	if strings.HasSuffix(path, "/api") {
		candidates = []string{origin + path + "/mcp"}
	}

	for _, mcpURL := range candidates {
		tools, err := withClient(ctx, chat.SelfHostedInstance{MCPURL: mcpURL, APIKey: key}, func(ctx context.Context, session *sdk.ClientSession) ([]string, error) {
			ctx, cancel := context.WithTimeout(ctx, listTimeout)
			defer cancel()
			list, err := session.ListTools(ctx, nil)
			if err != nil {
				return nil, err
			}
			var names []string
			for _, t := range list.Tools {
				names = append(names, t.Name)
			}
			return names, nil
		})
		if err != nil {
			var se *statusError
			if errors.As(err, &se) && se.code == http.StatusUnauthorized {
				return nil, httpx.HTTPException("Your Postiz instance rejected this API key", http.StatusBadRequest)
			}
			if errors.As(err, &se) && se.code == http.StatusForbidden {
				return nil, httpx.HTTPException("Your Postiz instance refused the connection (403), make sure nothing in front of it blocks requests from Postiz Cloud", http.StatusBadRequest)
			}
			// nothing that speaks MCP at this address, try the next one
			continue
		}

		for _, name := range requiredTools {
			if !slices.Contains(tools, name) {
				return nil, httpx.HTTPException(fmt.Sprintf("%s does not look like a Postiz instance, or it runs a version older than v2.19.0", origin), http.StatusBadRequest)
			}
		}

		// Every tool any install has must run on the instance, an older one
		// would answer some calls with errors (tools of optional features,
		// like clipping, depend on the instance setup, not its version)
		var missing []string
		for _, name := range s.coreToolNames {
			if !slices.Contains(tools, name) {
				missing = append(missing, name)
			}
		}
		if len(missing) > 0 {
			return nil, httpx.HTTPException(fmt.Sprintf("Your Postiz instance is missing tools this connection needs (%s). Update it to the latest Postiz version and connect again", strings.Join(missing, ", ")), http.StatusBadRequest)
		}
		return &chat.SelfHostedInstance{MCPURL: mcpURL, APIKey: key}, nil
	}

	return nil, httpx.HTTPException(fmt.Sprintf("Could not find a Postiz MCP server at %s. Paste the MCP URL from Settings > Agents (Developers or Public API on older versions) of your instance, and make sure it runs Postiz v2.19.0 or newer", origin), http.StatusBadRequest)
}

// Tools are the same definitions this server serves everyone (the listing
// stays the reviewed one, and nothing an instance returns ends up in a
// description), run by the instance. Pass tools without ui:// widgets -
// those upload to this server - and _meta (a tool's widget link) is dropped.
func (s *RelayService) Tools(source []*chat.Tool) []*chat.Tool {
	out := make([]*chat.Tool, 0, len(source))
	for _, tool := range source {
		tool := tool
		out = append(out, &chat.Tool{
			Name:         tool.Name,
			ID:           tool.ID,
			Description:  tool.Description,
			InputSchema:  tool.InputSchema,
			OutputSchema: tool.OutputSchema,
			Annotations:  tool.Annotations,
			Execute: func(ctx context.Context, input json.RawMessage) (any, error) {
				instance := chat.GetRelay(ctx)
				if instance == nil {
					return nil, errors.New("This connection is not linked to a self-hosted instance")
				}
				var args map[string]any
				_ = json.Unmarshal(input, &args)
				result, err := s.CallTool(ctx, *instance, tool.Name, args)
				if err != nil {
					return failure(tool, err.Error())
				}

				text := resultText(result)
				if tool.OutputSchema == nil {
					return text, nil
				}
				// The structured result is what the outputSchema describes;
				// instances whose tool had no outputSchema yet answer with JSON text
				output := result.StructuredContent
				if output == nil {
					if err := json.Unmarshal([]byte(text), &output); err != nil {
						message := text
						if message == "" {
							message = tool.Name + " returned an unexpected answer from your Postiz instance"
						}
						return failure(tool, message)
					}
				}
				// an instance on another Postiz version can answer in another shape
				var decoded any
				_ = json.Unmarshal(mustMarshal(output), &decoded)
				if len(tool.OutputSchema.Check(decoded, "")) > 0 {
					return failure(tool, fmt.Sprintf("Your Postiz instance answered %s in a format this connection does not know, update the instance to the latest Postiz version", tool.Name))
				}
				return decoded, nil
			},
		})
	}
	return out
}

func mustMarshal(v any) []byte {
	data, _ := json.Marshal(v)
	return data
}

// CallTool runs one tool on the instance; an instance error result becomes an
// error with the message the model reads.
func (s *RelayService) CallTool(ctx context.Context, instance chat.SelfHostedInstance, name string, args map[string]any) (*sdk.CallToolResult, error) {
	result, err := withClient(ctx, instance, func(ctx context.Context, session *sdk.ClientSession) (*sdk.CallToolResult, error) {
		ctx, cancel := context.WithTimeout(ctx, callToolTimeout)
		defer cancel()
		return session.CallTool(ctx, &sdk.CallToolParams{Name: name, Arguments: args})
	})
	if err != nil {
		// The key was rotated (or the instance reset): the connection can
		// never work again, so it goes away and the client asks to connect again
		var se *statusError
		if errors.As(err, &se) && se.code == http.StatusUnauthorized && instance.ID != "" && s.oauth != nil {
			_ = s.oauth.DeleteSelfHostedAuthorization(ctx, instance.ID)
		}
		return nil, errors.New(describeError(instance, name, err))
	}

	if result.IsError {
		text := resultText(result)
		// an instance older than this server doesn't have every tool yet
		if strings.HasPrefix(text, "Unknown tool:") {
			return nil, fmt.Errorf("%s is not available on your Postiz instance: the feature it needs is not set up there, or the instance needs an update to the latest Postiz version", name)
		}
		// arguments this server validated but an older instance doesn't accept
		if strings.HasPrefix(text, "Tool validation failed") {
			return nil, fmt.Errorf("Your Postiz instance runs an older version of %s, update it to the latest Postiz version to use it", name)
		}
		if text == "" {
			text = name + " failed on your Postiz instance"
		}
		return nil, errors.New(text)
	}
	return result, nil
}

// failure: a tool whose output has an `error` field answers normally with it
// (the clients count error results against the connector), any other one
// returns an error result.
func failure(tool *chat.Tool, message string) (any, error) {
	if tool.OutputSchema == nil {
		return message, nil
	}
	if len(tool.OutputSchema.Check(map[string]any{"error": message}, "")) == 0 {
		return map[string]any{"error": message}, nil
	}
	return nil, errors.New(message)
}

func resultText(result *sdk.CallToolResult) string {
	var texts []string
	for _, c := range result.Content {
		if t, ok := c.(*sdk.TextContent); ok {
			texts = append(texts, t.Text)
		}
	}
	return strings.TrimSpace(strings.Join(texts, "\n"))
}

// describeError is what the model (and so the person) reads when the
// instance can't run a tool - it has to say what to do next.
func describeError(instance chat.SelfHostedInstance, name string, err error) string {
	origin := instance.MCPURL
	if u, perr := url.Parse(instance.MCPURL); perr == nil {
		origin = u.Scheme + "://" + u.Host
	}
	var se *statusError
	if errors.As(err, &se) && se.code == http.StatusUnauthorized {
		return fmt.Sprintf("Your Postiz instance (%s) rejected the saved API key, it was probably rotated, so this connection was removed. Connect Postiz again to keep using your instance", origin)
	}
	if errors.As(err, &se) && se.code == http.StatusForbidden {
		return fmt.Sprintf("Your Postiz instance (%s) refused the request (403), make sure nothing in front of it blocks requests from Postiz Cloud", origin)
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return fmt.Sprintf("Your Postiz instance (%s) did not answer %s in time", origin, name)
	}
	var rpcErr *jsonrpc.Error
	if errors.As(err, &rpcErr) {
		return fmt.Sprintf("Your Postiz instance (%s) could not run %s: %s", origin, name, err.Error())
	}
	return fmt.Sprintf("Could not reach your Postiz instance (%s): %s. Make sure it is online and reachable from the internet", origin, err.Error())
}
