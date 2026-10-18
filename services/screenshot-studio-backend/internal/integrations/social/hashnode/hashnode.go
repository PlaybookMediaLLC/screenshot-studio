// Package hashnode is the Hashnode provider, its tag list, and the
// Hashnode settings DTO.
package hashnode

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/ids"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/integrations"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/temporalx"
)

// gqlURL is overridden by tests.
var gqlURL = "https://gql-beta.hashnode.com"

// Tag is one entry of the Hashnode tag list.
type Tag struct {
	Name     string  `json:"name,omitempty"`
	Logo     *string `json:"logo,omitempty"`
	Slug     string  `json:"slug"`
	ObjectID string  `json:"objectID"`
}

func str(s string) *string { return &s }

const (
	meQuery           = "\n                    query {\n                      me {\n                        name,\n                        id,\n                        profilePicture\n                        username\n                      }\n                    }\n                "
	publicationsQuery = "\n            query {\n              me {\n                publications (first: 50) {\n                  edges{\n                    node {\n                      id\n                      title\n                    }\n                  }\n                }\n              }\n            }\n                "
)

type Provider struct{ *integrations.Base }

var (
	_ integrations.Provider      = (*Provider)(nil)
	_ integrations.CustomFielder = (*Provider)(nil)
)

func New() *Provider { return &Provider{Base: integrations.NewBase("hashnode", nil)} }

func (p *Provider) Info() integrations.Info {
	// Hashnode has lenient publishing limits
	return integrations.Info{Identifier: "hashnode", Name: "Hashnode", Editor: "markdown", Scopes: []string{}, MaxConcurrentJob: 3}
}

func (p *Provider) MaxLength([]integrations.AdditionalSetting, json.RawMessage) int { return 10000 }

func (p *Provider) SettingsDTO() any { return &HashnodeSettingsDto{} }

func (p *Provider) GenerateAuthURL(context.Context, *integrations.ClientInformation) (*integrations.GenerateAuthURLResponse, error) {
	state := ids.Secure(6)
	return &integrations.GenerateAuthURLResponse{URL: state, CodeVerifier: ids.Secure(10), State: state}, nil
}

func (p *Provider) RefreshToken(context.Context, string) (*integrations.AuthTokenDetails, error) {
	return &integrations.AuthTokenDetails{}, nil
}

func (p *Provider) CustomFields() []integrations.CustomField {
	return []integrations.CustomField{{Key: "apiKey", Label: "API key", Validation: `/^.{3,}$/`, Type: "password"}}
}

func (p *Provider) Authenticate(ctx context.Context, params integrations.AuthenticateParams, _ *integrations.ClientInformation) (*integrations.AuthTokenDetails, error) {
	var body struct {
		APIKey string `json:"apiKey"`
	}
	if err := json.Unmarshal(decodeBase64(params.Code), &body); err != nil {
		return nil, err
	}
	data, err := graphql(ctx, body.APIKey, meQuery)
	if err != nil {
		return nil, integrations.AuthMessage("Invalid credentials")
	}
	var res struct {
		Data *struct {
			Me *struct {
				Name           string `json:"name"`
				ID             string `json:"id"`
				ProfilePicture string `json:"profilePicture"`
				Username       string `json:"username"`
			} `json:"me"`
		} `json:"data"`
	}
	if json.Unmarshal(data, &res) != nil || res.Data == nil || res.Data.Me == nil {
		return nil, integrations.AuthMessage("Invalid credentials")
	}
	me := res.Data.Me
	now := time.Now()
	return &integrations.AuthTokenDetails{
		ExpiresIn:   now.AddDate(100, 0, 0).Unix() - now.Unix(),
		AccessToken: body.APIKey,
		ID:          me.ID,
		Name:        me.Name,
		Picture:     me.ProfilePicture,
		Username:    me.Username,
	}, nil
}

type TagOption struct {
	Value string `json:"value"`
	Label string `json:"label,omitempty"`
}

// Tags is the frontend's "tags" function.
func (p *Provider) Tags() []TagOption {
	out := make([]TagOption, 0, len(tags))
	for _, tag := range tags {
		out = append(out, TagOption{Value: tag.ObjectID, Label: tag.Name})
	}
	return out
}

// TagsList is the "tagsList" @Tool.
func (p *Provider) TagsList() []Tag { return tags }

type Publication struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// Publications is the "publications" @Tool.
func (p *Provider) Publications(ctx context.Context, accessToken string) ([]Publication, error) {
	data, err := graphql(ctx, accessToken, publicationsQuery)
	if err != nil {
		return nil, err
	}
	var res struct {
		Data *struct {
			Me *struct {
				Publications *struct {
					Edges []struct {
						Node struct {
							ID    string `json:"id"`
							Title string `json:"title"`
						} `json:"node"`
					} `json:"edges"`
				} `json:"publications"`
			} `json:"me"`
		} `json:"data"`
	}
	if err := json.Unmarshal(data, &res); err != nil {
		return nil, err
	}
	if res.Data == nil || res.Data.Me == nil || res.Data.Me.Publications == nil || res.Data.Me.Publications.Edges == nil {
		return nil, errors.New("Cannot destructure the Hashnode publications response")
	}
	out := make([]Publication, 0, len(res.Data.Me.Publications.Edges))
	for _, edge := range res.Data.Me.Publications.Edges {
		out = append(out, Publication{ID: edge.Node.ID, Name: edge.Node.Title})
	}
	return out, nil
}

func (p *Provider) Functions() map[string]integrations.Function {
	return map[string]integrations.Function{
		"tags": func(context.Context, string, json.RawMessage, string, *ent.Integration) (any, error) {
			return p.Tags(), nil
		},
		"tagsList": func(context.Context, string, json.RawMessage, string, *ent.Integration) (any, error) {
			return p.TagsList(), nil
		},
		"publications": func(ctx context.Context, token string, _ json.RawMessage, _ string, _ *ent.Integration) (any, error) {
			return p.Publications(ctx, token)
		},
	}
}

func (p *Provider) Tools() []integrations.Tool {
	return []integrations.Tool{
		{MethodName: "tagsList", Description: "Tags", DataSchema: []integrations.ToolField{}},
		{MethodName: "publications", Description: "Publications", DataSchema: []integrations.ToolField{}},
	}
}

func (p *Provider) Post(ctx context.Context, id, accessToken string, posts []integrations.PostDetails, _ *ent.Integration) ([]integrations.PostResponse, error) {
	var settings HashnodeSettingsDto
	if len(posts[0].Settings) > 0 {
		if err := json.Unmarshal(posts[0].Settings, &settings); err != nil {
			return nil, err
		}
	}
	query, err := publishPostMutation(settings, posts[0].Message)
	if err != nil {
		return nil, err
	}
	body, _ := json.Marshal(map[string]string{"query": query})
	res, err := p.Fetch(ctx, gqlURL, integrations.Request{
		Method: http.MethodPost,
		Headers: map[string]string{
			"Content-Type":  "application/json",
			"Authorization": accessToken,
		},
		Body: body,
	})
	if err != nil {
		return nil, err
	}
	var out struct {
		Data   json.RawMessage `json:"data"`
		Errors json.RawMessage `json:"errors"`
	}
	if err := res.JSON(&out); err != nil {
		return nil, err
	}
	var errs []struct {
		Message string `json:"message"`
	}
	json.Unmarshal(out.Errors, &errs)
	var data struct {
		PublishPost *struct {
			Post *struct {
				ID  string `json:"id"`
				URL string `json:"url"`
			} `json:"post"`
		} `json:"publishPost"`
	}
	json.Unmarshal(out.Data, &data)

	if len(errs) > 0 || data.PublishPost == nil || data.PublishPost.Post == nil {
		details := "{}"
		if present(out.Errors) {
			details = compact(out.Errors)
		} else if present(out.Data) {
			details = compact(out.Data)
		}
		message := "Hashnode could not publish the post"
		if len(errs) > 0 && errs[0].Message != "" {
			message = errs[0].Message
		}
		return nil, temporalx.BadBody("hashnode", details, "{}", message)
	}

	post := data.PublishPost.Post
	return []integrations.PostResponse{{ID: posts[0].ID, Status: "completed", PostID: post.ID, ReleaseURL: post.URL}}, nil
}

// publishPostMutation builds what jsonToGraphQLQuery({mutation: {publishPost:
// {__args: {input}, post: {id: true, url: true}}}}, {pretty: true}) returns.
func publishPostMutation(settings HashnodeSettingsDto, message string) (string, error) {
	if settings.Tags == nil {
		return "", errors.New("Cannot read properties of undefined (reading 'map')")
	}
	input := []field{
		{"title", settings.Title},
		{"publicationId", settings.Publication},
	}
	if settings.Canonical != nil && *settings.Canonical != "" {
		input = append(input, field{"originalArticleURL", *settings.Canonical})
	}
	input = append(input, field{"contentMarkdown", message})
	tagList := make([]any, 0, len(*settings.Tags))
	for _, tag := range *settings.Tags {
		var slug *string
		for _, t := range tags {
			if tag.Value != nil && t.ObjectID == *tag.Value {
				slug = &t.Slug
				break
			}
		}
		tagList = append(tagList, object{{"slug", slug}})
	}
	input = append(input, field{"tags", tagList})
	if settings.Subtitle != nil && *settings.Subtitle != "" {
		input = append(input, field{"subtitle", *settings.Subtitle})
	}
	if settings.MainImage != nil {
		path := "undefined"
		prefix := ""
		if settings.MainImage.Path != nil {
			path = *settings.MainImage.Path
			if !strings.Contains(path, "http") {
				prefix = os.Getenv("NEXT_PUBLIC_BACKEND_URL") + "/" + os.Getenv("NEXT_PUBLIC_UPLOAD_STATIC_DIRECTORY")
			}
		}
		input = append(input, field{"coverImage", prefix + path})
	}

	return "mutation {\n" +
		"    publishPost (input: " + stringify(object(input)) + ") {\n" +
		"        post {\n" +
		"            id\n" +
		"            url\n" +
		"        }\n" +
		"    }\n" +
		"}", nil
}

// field and object keep json-to-graphql-query's argument key order.
type field struct {
	key   string
	value any
}

type object []field

// stringify is json-to-graphql-query's argument serializer: JSON for
// scalars, unquoted keys for objects, and "undefined" for a missing value.
func stringify(v any) string {
	switch x := v.(type) {
	case nil:
		return "undefined"
	case *string:
		if x == nil {
			return "undefined"
		}
		return quote(*x)
	case string:
		return quote(x)
	case []any:
		items := make([]string, len(x))
		for i, item := range x {
			items[i] = stringify(item)
		}
		return "[" + strings.Join(items, ", ") + "]"
	case object:
		props := make([]string, len(x))
		for i, f := range x {
			props[i] = f.key + ": " + stringify(f.value)
		}
		return "{" + strings.Join(props, ", ") + "}"
	}
	data, _ := json.Marshal(v)
	return string(data)
}

// quote is JSON.stringify for a string (no HTML or U+2028 escaping).
func quote(s string) string {
	var b strings.Builder
	b.WriteByte('"')
	for _, r := range s {
		switch r {
		case '"':
			b.WriteString(`\"`)
		case '\\':
			b.WriteString(`\\`)
		case '\b':
			b.WriteString(`\b`)
		case '\f':
			b.WriteString(`\f`)
		case '\n':
			b.WriteString(`\n`)
		case '\r':
			b.WriteString(`\r`)
		case '\t':
			b.WriteString(`\t`)
		default:
			if r < 0x20 {
				fmt.Fprintf(&b, `\u%04x`, r)
			} else {
				b.WriteRune(r)
			}
		}
	}
	b.WriteByte('"')
	return b.String()
}

// graphql is a plain fetch() POST to Hashnode: any status, body returned.
func graphql(ctx context.Context, token, query string) ([]byte, error) {
	body, _ := json.Marshal(map[string]string{"query": query})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, gqlURL, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", token)
	res, err := integrations.Do(req)
	var respErr *integrations.ResponseError
	if errors.As(err, &respErr) {
		return respErr.Body, nil
	}
	if err != nil {
		return nil, err
	}
	return res.Body, nil
}

func present(raw json.RawMessage) bool {
	s := strings.TrimSpace(string(raw))
	return s != "" && s != "null"
}

func compact(raw json.RawMessage) string {
	var b bytes.Buffer
	if json.Compact(&b, raw) != nil {
		return string(raw)
	}
	return b.String()
}

// decodeBase64 is Buffer.from(s, 'base64'): standard or URL alphabet,
// padding optional, other characters ignored.
func decodeBase64(s string) []byte {
	var clean bytes.Buffer
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case c == '=':
			i = len(s)
		case c == '-':
			clean.WriteByte('+')
		case c == '_':
			clean.WriteByte('/')
		case c == '+' || c == '/' || (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9'):
			clean.WriteByte(c)
		}
	}
	data := clean.Bytes()
	if len(data)%4 == 1 {
		data = data[:len(data)-1]
	}
	out, _ := base64.RawStdEncoding.DecodeString(string(data))
	return out
}
