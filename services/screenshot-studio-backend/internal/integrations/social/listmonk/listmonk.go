// Package listmonk is the Listmonk provider: email campaigns on a
// self-hosted ListMonk instance.
package listmonk

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/helpers"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/ids"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/integrations"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/integrations/social/internal/communityutil"
)

const identifier = "listmonk"

type Provider struct {
	*integrations.Base
}

func New() *Provider {
	return &Provider{Base: integrations.NewBase(identifier, nil)}
}

// SettingsDTO is ListmonkDto.
type SettingsDTO struct {
	Subject  *string `json:"subject"`
	Preview  *string `json:"preview"`
	List     *string `json:"list"`
	Template *string `json:"template,omitempty"`
}

// Validate reproduces class-validator's messages (decorators run bottom-up).
func (d *SettingsDTO) Validate() []string {
	var errs []string
	if d.Subject == nil || communityutil.Length(*d.Subject) < 1 {
		errs = append(errs, "subject must be longer than or equal to 1 characters")
	}
	if d.Subject == nil {
		errs = append(errs, "subject must be a string")
	}
	if d.Preview == nil {
		errs = append(errs, "preview must be a string")
	}
	if d.List == nil {
		errs = append(errs, "list must be a string")
	}
	return errs
}

func (p *Provider) Info() integrations.Info {
	return integrations.Info{
		Identifier:       identifier,
		Name:             "ListMonk",
		Editor:           "html",
		Scopes:           []string{},
		MaxConcurrentJob: 100,
		Rules:            `ListMonk sends the content as an email: pictures go inside the content as <img src="..."> where they should appear, the src must be a picture from the media library (upload it with uploadFromUrlTool first), attachments are not sent`,
	}
}

func (p *Provider) MaxLength([]integrations.AdditionalSetting, json.RawMessage) int { return 100000000 }

func (p *Provider) InlineImages(json.RawMessage) bool { return true }

func (p *Provider) SettingsDTO() any { return &SettingsDTO{} }

func (p *Provider) CustomFields() []integrations.CustomField {
	return []integrations.CustomField{
		{Key: "url", Label: "URL", DefaultValue: "", Validation: `/^(https?:\/\/)(?:\S+(?::\S*)?@)?(?:(?:localhost)|(?:\d{1,3}(?:\.\d{1,3}){3})|(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63})(?::\d{2,5})?(?:\/[^\s?#]*)?(?:\?[^\s#]*)?(?:#[^\s]*)?$/`, Type: "text"},
		{Key: "username", Label: "Username", Validation: `/^.+$/`, Type: "text"},
		{Key: "password", Label: "Password", Validation: `/^.{3,}$/`, Type: "password"},
	}
}

func (p *Provider) RefreshToken(context.Context, string) (*integrations.AuthTokenDetails, error) {
	return &integrations.AuthTokenDetails{}, nil
}

func (p *Provider) GenerateAuthURL(context.Context, *integrations.ClientInformation) (*integrations.GenerateAuthURLResponse, error) {
	state := ids.Secure(6)
	return &integrations.GenerateAuthURLResponse{URL: state, CodeVerifier: ids.Secure(10), State: state}, nil
}

type instance struct {
	URL      *string `json:"url"`
	Username *string `json:"username"`
	Password *string `json:"password"`
}

func orUndefined(v *string) string {
	if v == nil {
		return "undefined"
	}
	return *v
}

func (i instance) url() string { return orUndefined(i.URL) }

func (i instance) basic() string {
	return base64.StdEncoding.EncodeToString([]byte(orUndefined(i.Username) + ":" + orUndefined(i.Password)))
}

func (p *Provider) Authenticate(ctx context.Context, params integrations.AuthenticateParams, _ *integrations.ClientInformation) (*integrations.AuthTokenDetails, error) {
	var body instance
	if err := json.Unmarshal([]byte(communityutil.DecodeBase64(params.Code)), &body); err != nil {
		return nil, err
	}
	basic := body.basic()
	res, err := p.Fetch(ctx, body.url()+"/api/settings", integrations.Request{
		Headers: map[string]string{
			"Content-Type":  "application/json",
			"Accept":        "application/json",
			"Authorization": "Basic " + basic,
		},
	})
	var settings struct {
		Data map[string]any `json:"data"`
	}
	if err == nil {
		err = res.JSON(&settings)
	}
	if err == nil && settings.Data == nil {
		err = errors.New("Cannot read properties of undefined (reading 'app.site_name')")
	}
	if err != nil {
		return nil, integrations.AuthMessage("Invalid credentials")
	}
	picture := ""
	if communityutil.Truthy(settings.Data["app.logo_url"]) {
		picture = communityutil.JSString(settings.Data["app.logo_url"])
	}
	now := time.Now()
	return &integrations.AuthTokenDetails{
		RefreshToken: basic,
		ExpiresIn:    now.AddDate(100, 0, 0).Unix() - now.Unix(),
		AccessToken:  basic,
		ID:           base64.StdEncoding.EncodeToString([]byte(body.url())),
		Name:         communityutil.JSString(settings.Data["app.site_name"]),
		Picture:      picture,
		Username:     communityutil.JSString(settings.Data["app.site_name"]),
	}, nil
}

// instanceOf reads the encrypted {url, username, password} the channel was
// connected with.
func instanceOf(integration *ent.Integration) (instance, error) {
	var body instance
	if integration == nil || integration.CustomInstanceDetails == nil {
		return body, errors.New("missing custom instance details")
	}
	plain, err := helpers.FixedDecryption(*integration.CustomInstanceDetails)
	if err != nil {
		return body, err
	}
	err = json.Unmarshal([]byte(plain), &body)
	return body, err
}

func (p *Provider) Tools() []integrations.Tool {
	return []integrations.Tool{
		{MethodName: "list", Description: "List of available lists", DataSchema: []integrations.ToolField{}},
		{MethodName: "templates", Description: "List of available templates", DataSchema: []integrations.ToolField{}},
	}
}

func (p *Provider) Functions() map[string]integrations.Function {
	return map[string]integrations.Function{
		"list": func(ctx context.Context, _ string, _ json.RawMessage, _ string, integration *ent.Integration) (any, error) {
			return p.List(ctx, integration)
		},
		"templates": func(ctx context.Context, _ string, _ json.RawMessage, _ string, integration *ent.Integration) (any, error) {
			return p.Templates(ctx, integration)
		},
	}
}

func (p *Provider) get(ctx context.Context, integration *ent.Integration, path string, out any) error {
	body, err := instanceOf(integration)
	if err != nil {
		return err
	}
	res, err := p.Fetch(ctx, body.url()+path, integrations.Request{
		Headers: map[string]string{"Authorization": "Basic " + body.basic()},
	})
	if err != nil {
		return err
	}
	return res.JSON(out)
}

type item struct {
	ID   any `json:"id"`
	Name any `json:"name"`
}

// List is the @Tool listing the instance's mailing lists.
func (p *Provider) List(ctx context.Context, integration *ent.Integration) ([]communityutil.Option, error) {
	var res struct {
		Data *struct {
			Results []item `json:"results"`
		} `json:"data"`
	}
	if err := p.get(ctx, integration, "/api/lists", &res); err != nil {
		return nil, err
	}
	if res.Data == nil || res.Data.Results == nil {
		return nil, errors.New("Cannot read properties of undefined (reading 'map')")
	}
	out := []communityutil.Option{}
	for _, l := range res.Data.Results {
		out = append(out, communityutil.Option{ID: l.ID, Name: l.Name})
	}
	return out, nil
}

// Templates is the @Tool listing the instance's templates, after Default.
func (p *Provider) Templates(ctx context.Context, integration *ent.Integration) ([]communityutil.Option, error) {
	var res struct {
		Data []item `json:"data"`
	}
	if err := p.get(ctx, integration, "/api/templates", &res); err != nil {
		return nil, err
	}
	if res.Data == nil {
		return nil, errors.New("Cannot read properties of undefined (reading 'map')")
	}
	out := []communityutil.Option{{ID: 0, Name: "Default"}}
	for _, t := range res.Data {
		out = append(out, communityutil.Option{ID: t.ID, Name: t.Name})
	}
	return out, nil
}

const sendBodyTemplate = `
<style>
.content {
  padding: 20px;
  font-size: 15px;
  line-height: 1.6;
}
.content img {
  max-width: 100%;
  height: auto;
}
</style>
<div class="hidden-preheader"
       style="display:none !important; visibility:hidden; opacity:0; overflow:hidden;
              max-height:0; max-width:0; line-height:1px; font-size:1px; color:transparent;
              mso-hide:all;">
    <!-- A short visible decoy (optional): shows as "." or short text in preview -->
    {{preview}}
    <!-- Then invisible padding to eat up preview characters -->
    &#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;
    &#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;
    &#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;
    <!-- Repeat the trio (zero-width space, zero-width non-joiner, nbsp, BOM) a bunch of times -->
    &#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;
    &#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;
    &#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;
    &#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;
    &#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;
    &#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;
    &#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;
    &#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;
    &#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;
    &#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;
    &#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;
    &#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;
    &#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;
    &#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;
    &#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;
    &#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;
    &#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;
  </div>

  <div class="content">
    {{message}}
  </div>
`

// number is unary + : NaN serializes as null.
func number(v *string) any {
	var value any
	if v != nil {
		value = *v
	}
	if n, ok := communityutil.JSNumber(value); ok {
		return n
	}
	return nil
}

func (p *Provider) Post(ctx context.Context, id, accessToken string, posts []integrations.PostDetails, integration *ent.Integration) ([]integrations.PostResponse, error) {
	body, err := instanceOf(integration)
	if err != nil {
		return nil, err
	}
	post := posts[0]
	var settings SettingsDTO
	if err := communityutil.DecodeSettings(post.Settings, &settings); err != nil {
		return nil, err
	}
	preview := ""
	if settings.Preview != nil {
		preview = *settings.Preview
	}
	sendBody := strings.NewReplacer("{{preview}}", preview, "{{message}}", post.Message).Replace(sendBodyTemplate)
	if settings.Subject == nil {
		return nil, errors.New("slugify: string argument expected")
	}
	campaign := map[string]any{
		"name":         communityutil.Slugify(*settings.Subject),
		"type":         "regular",
		"content_type": "html",
		"subject":      *settings.Subject,
		"lists":        []any{number(settings.List)},
		"body":         sendBody,
	}
	if t, ok := number(settings.Template).(float64); ok && t != 0 {
		campaign["template_id"] = t
	}
	data, err := json.Marshal(campaign)
	if err != nil {
		return nil, err
	}
	headers := map[string]string{
		"Content-Type":  "application/json",
		"Accept":        "application/json",
		"Authorization": "Basic " + body.basic(),
	}
	res, err := p.Fetch(ctx, body.url()+"/api/campaigns", integrations.Request{Method: http.MethodPost, Headers: headers, Body: data})
	if err != nil {
		return nil, err
	}
	var created struct {
		Data *struct {
			UUID any `json:"uuid"`
			ID   any `json:"id"`
		} `json:"data"`
	}
	if err := res.JSON(&created); err != nil {
		return nil, err
	}
	if created.Data == nil {
		return nil, errors.New("Cannot read properties of undefined (reading 'uuid')")
	}
	campaignID := communityutil.JSString(created.Data.ID)
	if created.Data.ID == nil {
		campaignID = "undefined"
	}
	if _, err := p.Fetch(ctx, body.url()+"/api/campaigns/"+campaignID+"/status", integrations.Request{
		Method: http.MethodPut, Headers: headers, Body: []byte(`{"status":"running"}`),
	}); err != nil {
		return nil, err
	}
	return []integrations.PostResponse{{
		ID:         post.ID,
		Status:     "completed",
		ReleaseURL: body.url() + "/api/campaigns/" + campaignID + "/preview",
		PostID:     communityutil.JSString(created.Data.UUID),
	}}, nil
}
