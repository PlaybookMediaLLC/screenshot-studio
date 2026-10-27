package autopost

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	dto "github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/dtos/autopost"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/helpers"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ids"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/temporalx"
	enumspb "go.temporal.io/api/enums/v1"
	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/temporal"
)

// IntegrationService is the part of integration.Service autopost uses.
type IntegrationService interface {
	GetIntegrationsList(ctx context.Context, orgID string) ([]*ent.Integration, error)
}

// PostsService is the part of posts.Service autopost uses. CreatePostBody
// mirrors the CreatePostDto JSON that schedulePost builds.
type PostsService interface {
	FindFreeDateTime(ctx context.Context, orgID, integrationID string) (string, error)
	CreatePost(ctx context.Context, orgID string, body CreatePostBody, creationMethod string) error
}

type CreatePostBody struct {
	Date      string     `json:"date"`
	Order     string     `json:"order"`
	ShortLink bool       `json:"shortLink"`
	Type      string     `json:"type"`
	Tags      []any      `json:"tags"`
	Posts     []PostBody `json:"posts"`
}

type PostBody struct {
	Settings    PostSettings    `json:"settings"`
	Group       string          `json:"group"`
	Integration PostIntegration `json:"integration"`
	Value       []PostValue     `json:"value"`
}

type PostSettings struct {
	Type      string `json:"__type"`
	Title     string `json:"title"`
	Tags      []any  `json:"tags"`
	Subreddit []any  `json:"subreddit"`
}

type PostIntegration struct {
	ID string `json:"id"`
}

type PostValue struct {
	ID      string      `json:"id"`
	Delay   int         `json:"delay"`
	Content string      `json:"content"`
	Image   []PostImage `json:"image"`
}

type PostImage struct {
	ID             string `json:"id"`
	Name           string `json:"name"`
	Path           string `json:"path"`
	OrganizationID string `json:"organizationId"`
}

// LoadResult is loadXML's response: {success: false} or the newest item's
// date, link and plain-text description (absent fields are undefined).
type LoadResult struct {
	Success     bool    `json:"success"`
	Date        *string `json:"date,omitempty"`
	URL         *string `json:"url,omitempty"`
	Description *string `json:"description,omitempty"`
}

type Service struct {
	repo         *Repository
	temporal     client.Client
	integrations IntegrationService
	posts        PostsService
}

func NewService(repo *Repository, temporal client.Client, integrations IntegrationService, posts PostsService) *Service {
	return &Service{repo: repo, temporal: temporal, integrations: integrations, posts: posts}
}

func (s *Service) StopAll(ctx context.Context, org string) error {
	all, err := s.GetAutoposts(ctx, org)
	if err != nil {
		return err
	}
	for _, autopost := range all {
		if !autopost.Active {
			continue
		}
		if _, err := s.ChangeActive(ctx, org, autopost.ID, false); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) GetAutoposts(ctx context.Context, orgID string) ([]*ent.AutoPost, error) {
	return s.repo.GetAutoposts(ctx, orgID)
}

func (s *Service) CreateAutopost(ctx context.Context, orgID string, body dto.AutopostDto, id string) (CreateResponse, error) {
	data, err := s.repo.CreateAutopost(ctx, orgID, body, id)
	if err != nil {
		return CreateResponse{}, err
	}
	s.ProcessCron(ctx, boolOf(body.Active), orgID, data.ID)
	return data, nil
}

func (s *Service) ChangeActive(ctx context.Context, orgID, id string, active bool) (*ent.AutoPost, error) {
	data, err := s.repo.ChangeActive(ctx, orgID, id, active)
	if err != nil {
		return nil, err
	}
	s.ProcessCron(ctx, active, orgID, id)
	return data, nil
}

// ProcessCron starts the autopost workflow for an active autopost (keeping
// a running one, it reads the settings on every run) or terminates it.
// Failures are swallowed, like the TS.
func (s *Service) ProcessCron(ctx context.Context, active bool, orgID, id string) {
	if s.temporal == nil {
		return
	}
	if active {
		_, err := s.temporal.ExecuteWorkflow(ctx, client.StartWorkflowOptions{
			ID:        "autopost-" + id,
			TaskQueue: temporalx.MainQueue,
			// Keep a running workflow, it reads the autopost settings on every run
			WorkflowIDConflictPolicy: enumspb.WORKFLOW_ID_CONFLICT_POLICY_USE_EXISTING,
			TypedSearchAttributes:    temporal.NewSearchAttributes(temporalx.OrganizationID.ValueSet(orgID)),
		}, "autoPostWorkflow", map[string]any{"id": id, "immediately": true})
		// Don't fall through and terminate an active autopost
		_ = err
		return
	}
	_ = s.temporal.TerminateWorkflow(ctx, "autopost-"+id, "", "")
}

func (s *Service) DeleteAutopost(ctx context.Context, orgID, id string) (*ent.AutoPost, error) {
	data, err := s.repo.DeleteAutopost(ctx, orgID, id)
	if err != nil {
		return nil, err
	}
	s.ProcessCron(ctx, false, orgID, id)
	return data, nil
}

func (s *Service) LoadXML(ctx context.Context, url string) LoadResult {
	items, err := fetchFeed(ctx, url)
	if err != nil {
		return LoadResult{Success: false}
	}

	// reduce from { pubDate: 100 years ago } keeping the item whose pubDate
	// is after the current pick; dayjs(undefined) is now, invalid dates lose.
	start := time.Now().AddDate(-100, 0, 0)
	startISO := start.UTC().Format("2006-01-02T15:04:05.000Z")
	var last *feedItem
	lastDate, lastValid := start, true
	dateOf := func(v *string) (time.Time, bool) {
		if v == nil {
			return time.Now(), true
		}
		return parseDate(*v)
	}
	for i := range items {
		current, ok := dateOf(items[i].PubDate)
		if ok && lastValid && current.After(lastDate) {
			last = &items[i]
			lastDate, lastValid = dateOf(items[i].PubDate)
		}
	}

	if last == nil {
		empty := ""
		return LoadResult{Success: true, Date: &startISO, Description: &empty}
	}
	content := ""
	for _, v := range []*string{last.ContentEncoded, last.Content} {
		if v != nil && *v != "" {
			content = *v
			break
		}
	}
	description := strings.TrimSpace(strings.ReplaceAll(helpers.StripTags(content, nil), "\n", " "))
	return LoadResult{Success: true, Date: last.PubDate, URL: last.Link, Description: &description}
}

// workflowState is the LangGraph state of startAutopost.
type workflowState struct {
	integrations []*ent.Integration
	body         *ent.AutoPost
	description  string
	image        string
	id           string
	load         LoadResult
}

func (s *Service) loadURL(ctx context.Context, url *string) string {
	if url == nil {
		return ""
	}
	text, err := pageText(ctx, *url)
	if err != nil {
		return ""
	}
	// remove all html, script and styles
	return helpers.StripTags(text, nil)
}

const descriptionPrompt = "\n        You are an assistant that gets raw 'description' of a content and generate a social media post content.\n        Rules:\n        - Maximum 100 chars\n        - Try to make it a short as possible to fit any social media\n        - Add line breaks between sentences (\\n) \n        - Don't add hashtags\n        - Add emojis when needed\n        \n        'description':\n        {content}\n      "

const picturePrompt = "\n        You are an assistant that gets description and generate a prompt that will be sent to DallE to generate pictures.\n        \n        content:\n        {content}\n      "

func (s *Service) generateDescription(ctx context.Context, state *workflowState) error {
	if !state.body.GenerateContent {
		state.description = ""
		if state.body.Content != nil {
			state.description = *state.body.Content
		}
		return nil
	}

	description := ""
	if state.load.Description != nil {
		description = *state.load.Description
	}
	if description == "" {
		description = s.loadURL(ctx, state.load.URL)
	}
	if description == "" {
		state.description = ""
		return nil
	}

	var out struct {
		SocialMediaPostContent string `json:"socialMediaPostContent"`
	}
	if err := structuredOutput(ctx, strings.Replace(descriptionPrompt, "{content}", description, 1),
		"socialMediaPostContent", "Content for social media posts max 120 chars", &out); err != nil {
		return err
	}
	state.description = out.SocialMediaPostContent
	return nil
}

func (s *Service) generatePicture(ctx context.Context, state *workflowState) error {
	content := state.description
	if state.load.Description != nil && *state.load.Description != "" {
		content = *state.load.Description
	}
	var out struct {
		GeneratedTextToBeSentToDallE string `json:"generatedTextToBeSentToDallE"`
	}
	if err := structuredOutput(ctx, strings.Replace(picturePrompt, "{content}", content, 1),
		"generatedTextToBeSentToDallE", "Generated prompt from description to be sent to DallE", &out); err != nil {
		return err
	}
	image, err := dalle(ctx, out.GeneratedTextToBeSentToDallE)
	if err != nil {
		return err
	}
	state.image = image
	return nil
}

func jsString(v *string) string {
	if v == nil {
		return "undefined"
	}
	return *v
}

func (s *Service) schedulePost(ctx context.Context, state *workflowState) error {
	orgID := state.integrations[0].OrganizationID
	nextTime, err := s.posts.FindFreeDateTime(ctx, orgID, "")
	if err != nil {
		return err
	}
	posts := make([]PostBody, 0, len(state.integrations))
	for _, i := range state.integrations {
		images := []PostImage{}
		if state.image != "" {
			images = append(images, PostImage{ID: ids.Make(10), Name: ids.Make(10), Path: state.image, OrganizationID: orgID})
		}
		posts = append(posts, PostBody{
			Settings:    PostSettings{Type: i.ProviderIdentifier, Title: "", Tags: []any{}, Subreddit: []any{}},
			Group:       ids.Make(10),
			Integration: PostIntegration{ID: i.ID},
			Value: []PostValue{{
				ID:      ids.Make(10),
				Delay:   0,
				Content: strings.ReplaceAll(state.description, "\n", "\n\n") + "\n\n" + jsString(state.load.URL),
				Image:   images,
			}},
		})
	}
	return s.posts.CreatePost(ctx, orgID, CreatePostBody{
		Date: nextTime + "Z", Order: ids.Make(10), ShortLink: false, Type: "draft", Tags: []any{}, Posts: posts,
	}, "AUTOPOST")
}

// StartAutopost runs one autopost: read the feed, and when its newest item
// is new, write a post (optionally AI generated, with a picture), schedule
// it as a draft on the autopost's channels and remember the item.
func (s *Service) StartAutopost(ctx context.Context, id string) error {
	getPost, err := s.repo.GetAutopost(ctx, id)
	if err != nil {
		return err
	}
	if getPost == nil || !getPost.Active {
		return nil
	}

	load := s.LoadXML(ctx, getPost.URL)
	if !load.Success || (load.URL != nil && *load.URL == getPost.LastURL) {
		return nil
	}

	integrations, err := s.integrations.GetIntegrationsList(ctx, getPost.OrganizationID)
	if err != nil {
		return err
	}
	var parseIntegrations []struct {
		ID string `json:"id"`
	}
	raw := getPost.Integrations
	if raw == "" {
		raw = "[]"
	}
	if err := json.Unmarshal([]byte(raw), &parseIntegrations); err != nil {
		return err
	}
	var needed []*ent.Integration
	for _, i := range integrations {
		for _, p := range parseIntegrations {
			if p.ID == i.ID {
				needed = append(needed, i)
				break
			}
		}
	}
	integrationsToSend := needed
	if len(parseIntegrations) == 0 {
		integrationsToSend = integrations
	}
	if len(integrationsToSend) == 0 {
		return nil
	}

	// generate-description -> [generate-picture] -> schedule-post -> update-url
	state := &workflowState{id: id, body: getPost, load: load, integrations: integrationsToSend}
	if err := s.generateDescription(ctx, state); err != nil {
		return err
	}
	if state.description != "" && state.body.AddPicture {
		if err := s.generatePicture(ctx, state); err != nil {
			return err
		}
	}
	if err := s.schedulePost(ctx, state); err != nil {
		return err
	}
	_, err = s.repo.UpdateURL(ctx, state.id, state.load.URL)
	return err
}

// OpenAI calls of the LangChain ChatOpenAI (gpt-4.1, temperature 0.7,
// withStructuredOutput) and DallEAPIWrapper (chatgpt-image-latest) models.

var openAIBaseURL = func() string {
	if base := os.Getenv("OPENAI_BASE_URL"); base != "" {
		return strings.TrimRight(base, "/")
	}
	return "https://api.openai.com/v1"
}

func openAIKey() string {
	if key := os.Getenv("OPENAI_API_KEY"); key != "" {
		return key
	}
	return "sk-proj-"
}

func openAI(ctx context.Context, path string, payload, out any) error {
	data, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, openAIBaseURL()+path, bytes.NewReader(data))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+openAIKey())
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	body, err := io.ReadAll(res.Body)
	if err != nil {
		return err
	}
	if res.StatusCode >= 300 {
		return fmt.Errorf("openai %s: %d %s", path, res.StatusCode, body)
	}
	return json.Unmarshal(body, out)
}

// structuredOutput sends prompt as one user message and decodes the single
// string field the zod schema describes.
func structuredOutput(ctx context.Context, prompt, field, description string, out any) error {
	var res struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	err := openAI(ctx, "/chat/completions", map[string]any{
		"model":       "gpt-4.1",
		"temperature": 0.7,
		"messages":    []map[string]any{{"role": "user", "content": prompt}},
		"response_format": map[string]any{
			"type": "json_schema",
			"json_schema": map[string]any{
				"name":   "extract",
				"strict": true,
				"schema": map[string]any{
					"type":                 "object",
					"properties":           map[string]any{field: map[string]any{"type": "string", "description": description}},
					"required":             []string{field},
					"additionalProperties": false,
				},
			},
		},
	}, &res)
	if err != nil {
		return err
	}
	if len(res.Choices) == 0 {
		return fmt.Errorf("openai: no choices")
	}
	return json.Unmarshal([]byte(res.Choices[0].Message.Content), out)
}

// dalle is DallEAPIWrapper.invoke with its defaults: the first image URL.
func dalle(ctx context.Context, prompt string) (string, error) {
	var res struct {
		Data []struct {
			URL string `json:"url"`
		} `json:"data"`
	}
	err := openAI(ctx, "/images/generations", map[string]any{
		"model":           "chatgpt-image-latest",
		"prompt":          prompt,
		"n":               1,
		"size":            "1024x1024",
		"response_format": "url",
		"style":           "vivid",
		"quality":         "standard",
	}, &res)
	if err != nil {
		return "", err
	}
	for _, d := range res.Data {
		if d.URL != "" {
			return d.URL, nil
		}
	}
	return "", nil
}
