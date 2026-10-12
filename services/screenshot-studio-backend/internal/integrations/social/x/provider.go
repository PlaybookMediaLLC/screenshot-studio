// Package x is the X (Twitter) provider (x.provider.ts). It talks OAuth 1.0a
// user context, calling the same endpoints twitter-api-v2 calls.
package x

import (
	"context"
	"encoding/json"
	"log"
	"math"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/helpers"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/integrations"
)

const identifier = "x"

type Provider struct {
	*integrations.Base
}

func New() *Provider {
	return &Provider{Base: integrations.NewBase(identifier, handleErrors)}
}

func (p *Provider) Info() integrations.Info {
	strip := ""
	if os.Getenv("STRIP_LINKS_FROM_X_POSTS") != "" {
		strip = "do not add links, they will be stripped from the post"
	}
	return integrations.Info{
		Identifier: identifier,
		Name:       "X",
		Scopes:     []string{},
		// The provider receives the rich HTML so articles keep their formatting;
		// regular tweets are stripped to plain text inside the provider.
		Editor:  "html",
		ToolTip: "You will be logged in into your current account, if you would like a different account, change it first on X",
		// X rate limits are per user (300 posts / 3 hours), not per app, so the cap
		// only needs to keep bursts polite. With the pending flow the slot is held
		// for actual API work only (processing waits live in workflow timers), so a
		// single slot is no longer required - it would serialize every customer's
		// status checks behind uploads.
		MaxConcurrentJob: 10,
		Rules:            `X can have maximum 4 pictures, or maximum one video, it can also be without attachments, it can also be published as a long-form article (draft or published) when post_type is set to article, in an article pictures go inside the content as <img src="..."> where they should appear (the src must be a picture from the media library, upload it with uploadFromUrlTool first) ` + strip,
	}
}

func (p *Provider) StripLinks() bool { return os.Getenv("STRIP_LINKS_FROM_X_POSTS") != "" }

func (p *Provider) SettingsDTO() any { return &XDto{} }

func decodeSettings(raw json.RawMessage) XDto {
	var dto XDto
	_ = json.Unmarshal(raw, &dto) // like TS, read whatever fields are usable
	return dto
}

func str(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// jsString renders a nullable column the way a template literal does.
func jsString(s *string) string {
	if s == nil {
		return "null"
	}
	return *s
}

func truthy(v any) bool {
	switch t := v.(type) {
	case nil:
		return false
	case bool:
		return t
	case string:
		return t != ""
	case float64:
		return t != 0 && !math.IsNaN(t)
	}
	return true
}

func (p *Provider) MaxLength(additionalSettings []integrations.AdditionalSetting, settings json.RawMessage) int {
	// Articles are long-form content, the tweet character limit doesn't apply.
	if str(decodeSettings(settings).PostType) == "article" {
		return 100000
	}
	// "Verified" => premium => higher limit.
	for _, s := range additionalSettings {
		if s.Title == "Verified" {
			if truthy(s.Value) {
				return 4000
			}
			break
		}
	}
	return 280
}

// InlineImages: article bodies hold pictures, tweets only take attachments.
func (p *Provider) InlineImages(settings json.RawMessage) bool {
	return str(decodeSettings(settings).PostType) == "article"
}

var hasTag = regexp.MustCompile(`(?i)</?[a-z][\s\S]*>`)

// toTweetText flattens the editor HTML back to the plain text X expects - same
// output the old 'normal' editor produced.
func toTweetText(message string) string {
	return helpers.StripHTMLValidation("normal", message, helpers.StripOptions{
		ReplaceBold: true,
		Plain:       !hasTag.MatchString(message),
	})
}

func (p *Provider) CheckValidity(_ context.Context, posts [][]integrations.ValidityMedia, settings json.RawMessage, _ []integrations.AdditionalSetting) (string, error) {
	dto := decodeSettings(settings)
	if str(dto.PostType) != "article" {
		return "", nil
	}
	for _, post := range posts {
		for _, m := range post {
			if helpers.HasExtension(m.Path, "mp4") {
				return "X articles only support images", nil
			}
		}
	}
	// Replies can only be attached to the seed post a published article
	// creates - a draft has no post to reply to.
	if str(dto.ArticleStatus) != "published" && len(posts) > 1 {
		return "A draft article cannot have thread replies, remove them or publish the article", nil
	}
	return "", nil
}

func handleErrors(body string, _ int) *integrations.HandledError {
	rules := []struct{ match, kind, value string }{
		{"You are not permitted to perform this action", "bad-body", "There is a problem posting, please edit your post and check character count and media attachments"},
		{"Service Unavailable", "retry", "X is currently unavailable, please try again later"},
		{"Too Many Requests", "retry", "X rate limit reached, please try again later"},
		{"maximum of one cashtag", "bad-body", "There can be maximum of one cashtag ($SYMBOL) per post"},
		{"maximum of 4 items", "bad-body", "There must be a maximum of 4 items per post"},
		{"Unsupported Authentication", "refresh-token", "X authentication has expired, please reconnect your account"},
		{"You are not allowed to create a Tweet", "bad-body", "You are not allowed to create a post with duplicate content"},
		{"usage-capped", "bad-body", "Posting failed - capped reached. Please try again later"},
		{"user-suspended", "bad-body", "Your X account has been suspended, please reconnect with another account"},
		{"duplicate-rules", "bad-body", "You have already posted this post, please wait before posting again"},
		{"Your account is not permitted to access this feature", "bad-body", "X blocked your request"},
		{"The Tweet contains an invalid URL.", "bad-body", "The Tweet contains a URL that is not allowed on X"},
		{"This user is not allowed to post a video longer than 2 minutes", "bad-body", "The video you are trying to post is longer than 2 minutes, which is not allowed for this account"},
		{"This user is not allowed to post a video longer than 10 minutes", "bad-body", "The video you are trying to post is longer than 10 minutes, which is not allowed for this account"},
		{"Your account is temporarily locked", "bad-body", "Your X account is temporarily locked, log in to x.com to unlock it and then try again"},
		{"Crypto addresses are prohibited", "bad-body", "X does not allow crypto addresses in posts for the first 7 days after connecting the account"},
		{"Your media IDs are invalid", "bad-body", "X rejected the attached media, please re-upload the media and try again"},
		{"not authorized to create or publish articles", "bad-body", "Publishing articles on X requires an X Premium subscription"},
		{"Please include either text or media in your Tweet", "bad-body", "One of the posts in this thread has no text or media, please add some text or remove it"},
		{`"title":"Unauthorized"`, "refresh-token", "X rejected the connected account, please reconnect your account"},
	}
	for _, r := range rules {
		if strings.Contains(body, r.match) {
			return &integrations.HandledError{Type: r.kind, Value: r.value}
		}
	}
	return nil
}

// jsNumber is `+value` for the plug's likesAmount field.
func jsNumber(value string) float64 {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return 0
	}
	n, err := strconv.ParseFloat(trimmed, 64)
	if err != nil {
		return math.NaN()
	}
	return n
}

var likesField = integrations.PlugField{
	Name:        "likesAmount",
	Type:        "number",
	Placeholder: "Amount of likes",
	Description: "The amount of likes to trigger the repost",
	Validation:  `/^\d+$/`,
}

func (p *Provider) Plugs() []integrations.Plug {
	disabled := os.Getenv("DISABLE_X_ANALYTICS") != ""
	return []integrations.Plug{
		{
			MethodName:           "autoRepostPost",
			Identifier:           "x-autoRepostPost",
			Title:                "Auto Repost Posts",
			Disabled:             disabled,
			Description:          "When a post reached a certain number of likes, repost it to increase engagement (1 week old posts)",
			RunEveryMilliseconds: 21600000,
			TotalRuns:            3,
			Fields:               []integrations.PlugField{likesField},
			Run:                  p.AutoRepostPost,
		},
		{
			MethodName:           "autoPlugPost",
			Identifier:           "x-autoPlugPost",
			Title:                "Auto plug post",
			Disabled:             disabled,
			Description:          "When a post reached a certain number of likes, add another post to it so you followers get a notification about your promotion",
			RunEveryMilliseconds: 21600000,
			TotalRuns:            3,
			Fields: []integrations.PlugField{likesField, {
				Name:        "post",
				Type:        "richtext",
				Placeholder: "Post to plug",
				Description: "Message content to plug",
				Validation:  `/^[\s\S]{3,}$/g`,
			}},
			Run: p.AutoPlugPost,
		},
	}
}

func (p *Provider) InternalPlugs() []integrations.InternalPlug {
	return []integrations.InternalPlug{{
		MethodName:      "repostPostUsers",
		Identifier:      "x-repost-post-users",
		Title:           "Add Re-posters",
		Description:     "Add accounts to repost your post",
		PickIntegration: []string{"x"},
		Fields:          []integrations.PlugField{},
		Run:             p.RepostPostUsers,
	}}
}

func (p *Provider) AutoRepostPost(ctx context.Context, integration *ent.Integration, id string, fields map[string]string) (bool, error) {
	c := newClient(integration.Token)
	count, err := c.tweetLikedByCount(ctx, id)
	if err != nil {
		return false, err
	}
	if float64(count) >= jsNumber(fields["likesAmount"]) {
		if err := p.Sleep(ctx, 2*time.Second); err != nil {
			return false, err
		}
		if err := c.retweet(ctx, integration.InternalID, id); err != nil {
			return false, err
		}
		return true, nil
	}
	return false, nil
}

func (p *Provider) RepostPostUsers(ctx context.Context, integration, _ *ent.Integration, postID string, _ json.RawMessage) error {
	c := newClient(integration.Token)
	me, err := c.me(ctx, nil)
	if err != nil {
		return err
	}
	_ = c.retweet(ctx, me.ID, postID) // nothing
	return nil
}

func (p *Provider) AutoPlugPost(ctx context.Context, integration *ent.Integration, id string, fields map[string]string) (bool, error) {
	c := newClient(integration.Token)
	count, err := c.tweetLikedByCount(ctx, id)
	if err != nil {
		return false, err
	}
	if float64(count) < jsNumber(fields["likesAmount"]) {
		return false, nil
	}
	if err := p.Sleep(ctx, 2*time.Second); err != nil {
		return false, err
	}
	plugText := helpers.StripHTMLValidation("normal", fields["post"], helpers.StripOptions{ReplaceBold: true})
	if p.StripLinks() {
		plugText = helpers.StripLinks(plugText)
	}
	err = c.postJSON(ctx, v2("tweets"), map[string]any{
		"text":  plugText,
		"reply": map[string]string{"in_reply_to_tweet_id": id},
	}, nil)
	return err == nil, err
}

func (p *Provider) RefreshToken(context.Context, string) (*integrations.AuthTokenDetails, error) {
	return &integrations.AuthTokenDetails{}, nil
}

func (p *Provider) GenerateAuthURL(ctx context.Context, _ *integrations.ClientInformation) (*integrations.GenerateAuthURLResponse, error) {
	callback := os.Getenv("X_URL")
	if callback == "" {
		callback = os.Getenv("FRONTEND_URL")
	}
	res, err := (&client{}).postForm(ctx, apiBase+"/oauth/request_token", url.Values{
		"oauth_callback":     {callback + "/integrations/social/x"},
		"x_auth_access_type": {"write"},
	})
	if err != nil {
		return nil, err
	}
	token := res.Get("oauth_token")
	return &integrations.GenerateAuthURLResponse{
		URL:          apiBase + "/oauth/authenticate?oauth_token=" + url.QueryEscape(token) + "&force_login=false",
		CodeVerifier: token + ":" + res.Get("oauth_token_secret"),
		State:        token,
	}, nil
}

func (p *Provider) Authenticate(ctx context.Context, params integrations.AuthenticateParams, _ *integrations.ClientInformation) (*integrations.AuthTokenDetails, error) {
	oauthToken, oauthTokenSecret := splitToken(params.CodeVerifier)
	starting := &client{token: oauthToken, secret: oauthTokenSecret}
	login, err := starting.postForm(ctx, apiBase+"/oauth/access_token", url.Values{
		"oauth_token":    {oauthToken},
		"oauth_verifier": {params.Code},
	})
	if err != nil {
		return nil, err
	}
	accessToken, accessSecret := login.Get("oauth_token"), login.Get("oauth_token_secret")
	c := &client{token: accessToken, secret: accessSecret}
	me, err := c.me(ctx, url.Values{"user.fields": {"username,verified,verified_type,profile_image_url,name"}})
	if err != nil {
		return nil, err
	}
	return &integrations.AuthTokenDetails{
		ID:          me.ID,
		AccessToken: accessToken + ":" + accessSecret,
		Name:        me.Name,
		ExpiresIn:   999999999,
		Picture:     me.ProfileImageURL,
		Username:    me.Username,
		AdditionalSettings: []integrations.AdditionalSetting{{
			Title:       "Verified",
			Description: "Is this a verified user? (Premium)",
			Type:        "checkbox",
			Value:       me.Verified,
		}},
	}, nil
}

type tweet struct {
	ID            string            `json:"id"`
	PublicMetrics map[string]*int64 `json:"public_metrics"`
}

func (p *Provider) loadAllTweets(ctx context.Context, c *client, id, until, since, token string) ([]tweet, error) {
	query := url.Values{
		"tweet.fields": {"id"},
		"user.fields":  {""},
		"poll.fields":  {""},
		"place.fields": {""},
		"media.fields": {""},
		"exclude":      {"replies,retweets"},
		"start_time":   {since},
		"end_time":     {until},
		"max_results":  {"100"},
	}
	if token != "" {
		query.Set("pagination_token", token)
	}
	var res struct {
		Data []tweet `json:"data"`
		Meta struct {
			NextToken string `json:"next_token"`
		} `json:"meta"`
	}
	if err := c.get(ctx, v2("users/"+id+"/tweets"), query, &res); err != nil {
		return nil, err
	}
	if len(res.Data) == 100 && res.Meta.NextToken != "" {
		more, err := p.loadAllTweets(ctx, c, id, until, since, res.Meta.NextToken)
		if err != nil {
			return nil, err
		}
		return append(res.Data, more...), nil
	}
	return res.Data, nil
}

const dayjsZ = "2006-01-02T15:04:05-07:00"

func (p *Provider) Analytics(ctx context.Context, id, accessToken string, date int) ([]integrations.AnalyticsData, error) {
	out := []integrations.AnalyticsData{}
	if os.Getenv("DISABLE_X_ANALYTICS") != "" {
		return out, nil
	}
	now := time.Now()
	until := time.Date(now.Year(), now.Month(), now.Day(), 23, 59, 59, 999e6, now.Location())
	since := now.AddDate(0, 0, -min(date, 100))
	c := newClient(accessToken)

	all, err := p.loadAllTweets(ctx, c, id, until.Format(dayjsZ), since.Format(dayjsZ), "")
	if err != nil {
		log.Println(err)
		return out, nil
	}
	seen := map[string]bool{}
	ids := []string{}
	for _, t := range all {
		if !seen[t.ID] {
			seen[t.ID] = true
			ids = append(ids, t.ID)
		}
	}
	if len(ids) == 0 {
		return out, nil
	}
	var data struct {
		Data []tweet `json:"data"`
	}
	if err := c.get(ctx, v2("tweets"), url.Values{"ids": {strings.Join(ids, ",")}, "tweet.fields": {"public_metrics"}}, &data); err != nil {
		log.Println(err)
		return out, nil
	}
	keys := []string{"impression_count", "bookmark_count", "like_count", "quote_count", "reply_count", "retweet_count"}
	totals := map[string]int64{}
	for _, t := range data.Data {
		for _, k := range keys {
			if v := t.PublicMetrics[k]; v != nil {
				totals[k] += *v
			}
		}
	}
	for _, k := range keys {
		out = append(out, integrations.AnalyticsData{
			Label:            strings.ToUpper(strings.Replace(strings.Replace(k, "_count", "", 1), "_", " ", 1)),
			PercentageChange: 5,
			Data: []integrations.AnalyticsItem{
				{Total: "0", Date: since.Format("2006-01-02")},
				{Total: strconv.FormatInt(totals[k], 10), Date: until.Format("2006-01-02")},
			},
		})
	}
	return out, nil
}

func (p *Provider) PostAnalytics(ctx context.Context, _, accessToken, postID string, _ int64) ([]integrations.AnalyticsData, error) {
	out := []integrations.AnalyticsData{}
	if os.Getenv("DISABLE_X_ANALYTICS") != "" {
		return out, nil
	}
	today := time.Now().Format("2006-01-02")
	c := newClient(accessToken)
	// Fetch the specific tweet with public metrics
	var res struct {
		Data *tweet `json:"data"`
	}
	if err := c.get(ctx, v2("tweets/"+postID), url.Values{"tweet.fields": {"public_metrics,created_at"}}, &res); err != nil {
		log.Println("Error fetching X post analytics:", err)
		return out, nil
	}
	if res.Data == nil || res.Data.PublicMetrics == nil {
		return out, nil
	}
	for _, m := range []struct{ key, label string }{
		{"impression_count", "Impressions"},
		{"like_count", "Likes"},
		{"retweet_count", "Retweets"},
		{"reply_count", "Replies"},
		{"quote_count", "Quotes"},
		{"bookmark_count", "Bookmarks"},
	} {
		if v := res.Data.PublicMetrics[m.key]; v != nil {
			out = append(out, integrations.AnalyticsData{
				Label: m.label,
				Data:  []integrations.AnalyticsItem{{Total: strconv.FormatInt(*v, 10), Date: today}},
			})
		}
	}
	return out, nil
}

func (p *Provider) Mention(ctx context.Context, token, query, _ string, _ *ent.Integration) ([]integrations.MentionResult, bool, error) {
	c := newClient(token)
	var res struct {
		Data *user `json:"data"`
	}
	if err := c.get(ctx, v2("users/by/username/"+url.PathEscape(query)), url.Values{"user.fields": {"username,name,profile_image_url"}}, &res); err != nil {
		log.Println(err)
		return []integrations.MentionResult{}, false, nil
	}
	if res.Data == nil || res.Data.Username == "" {
		return []integrations.MentionResult{}, false, nil
	}
	return []integrations.MentionResult{{ID: res.Data.Username, Image: res.Data.ProfileImageURL, Label: res.Data.Name}}, false, nil
}

func (p *Provider) MentionFormat(idOrHandle, _ string) string { return "@" + idOrHandle }
