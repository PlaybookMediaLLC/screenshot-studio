// Package agent is the post generation agent: the
// LangGraph post generator streamed by POST /posts/generator
// (AgentGraphService) and the popular posts classifier
// (AgentGraphInsertService), run as plain Go steps over the OpenAI API.
package agent

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/chat/llm"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/dtos/generator"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/httpx"
)

// The graph's models: ChatOpenAI gpt-4.1 at 0.7 and DallEAPIWrapper
// chatgpt-image-latest.
const (
	graphModel       = "gpt-4.1"
	graphTemperature = 0.7
	imageModel       = "chatgpt-image-latest"
)

// TavilyBaseURL is the Tavily API root; tests point it elsewhere.
var TavilyBaseURL = "https://api.tavily.com"

// PostsService is the part of posts.Service the generator uses.
type PostsService interface {
	FindAllExistingCategories(ctx context.Context) ([]*ent.PopularPosts, error)
	FindAllExistingTopicsOfCategory(ctx context.Context, category string) ([]*ent.PopularPosts, error)
	// FindPopularPosts filters by topic when it is not "".
	FindPopularPosts(ctx context.Context, category, topic string) ([]*ent.PopularPosts, error)
	FindFreeDateTime(ctx context.Context, orgID string) (string, error)
	CreatePopularPosts(ctx context.Context, post PopularPost) (*ent.PopularPosts, error)
}

// PopularPost is the createPopularPosts body.
type PopularPost struct {
	Category string `json:"category"`
	Topic    string `json:"topic"`
	Content  string `json:"content"`
	Hook     string `json:"hook"`
}

// MediaService is the part of media.Service the generator uses.
type MediaService interface {
	SaveFile(ctx context.Context, orgID, fileName, filePath string) (*ent.Media, error)
}

// Storage is the part of the upload provider the generator uses.
type Storage interface {
	UploadSimple(ctx context.Context, path string) (string, error)
}

// GraphService is AgentGraphService.
type GraphService struct {
	posts   PostsService
	media   MediaService
	storage Storage
}

func NewGraphService(posts PostsService, media MediaService, storage Storage) *GraphService {
	return &GraphService{posts: posts, media: media, storage: storage}
}

// message is a LangChain message, serialized the way BaseMessage.toJSON does.
type message struct {
	kind   string // HumanMessage | AIMessage | ToolMessage
	kwargs map[string]any
}

func (m message) MarshalJSON() ([]byte, error) {
	return json.Marshal(map[string]any{"lc": 1, "type": "constructor", "id": []string{"langchain_core", "messages", m.kind}, "kwargs": m.kwargs})
}

func (m message) content() string { s, _ := m.kwargs["content"].(string); return s }

type contentItem struct {
	Content string  `json:"content"`
	Website *string `json:"website,omitempty"`
	Prompt  string  `json:"prompt,omitempty"`
	// Image is the generated picture url, then the saved media row.
	Image any `json:"image,omitempty"`
}

// state is WorkflowChannelsState; unset channels are left out.
type state struct {
	Messages     []message      `json:"messages"`
	IsPicture    bool           `json:"isPicture"`
	Format       string         `json:"format"`
	Tone         string         `json:"tone"`
	OrgID        string         `json:"orgId"`
	Fresearch    []message      `json:"fresearch,omitempty"`
	Category     string         `json:"category,omitempty"`
	Topic        *string        `json:"topic,omitempty"`
	PopularPosts []popularPost  `json:"popularPosts,omitempty"`
	Hook         string         `json:"hook,omitempty"`
	Content      []*contentItem `json:"content,omitempty"`
	Date         string         `json:"date,omitempty"`
}

type popularPost struct {
	Content string `json:"content"`
	Hook    string `json:"hook"`
}

// fromTemplate is ChatPromptTemplate.fromTemplate(...).format: {name}
// placeholders, non-strings JSON encoded.
func fromTemplate(template string, values map[string]any) string {
	return placeholder.ReplaceAllStringFunc(template, func(match string) string {
		value, ok := values[match[1:len(match)-1]]
		if !ok {
			return match
		}
		if s, ok := value.(string); ok {
			return s
		}
		data, _ := json.Marshal(value)
		return string(data)
	})
}

var placeholder = regexp.MustCompile(`\{[A-Za-z_]+\}`)

func strictObject(props string, required ...string) json.RawMessage {
	req, _ := json.Marshal(required)
	return json.RawMessage(`{"type":"object","properties":{` + props + `},"required":` + string(req) + `,"additionalProperties":false}`)
}

var (
	categorySchema = strictObject(`"category":{"type":"string","description":"The category for the post"}`, "category")
	topicSchema    = strictObject(`"topic":{"type":"string","description":"The topic for the post"}`, "topic")
	hookSchema     = strictObject(`"hook":{"type":"string","description":"Hook for the new post, don't take it from \"the request of the user\""}`, "hook")
)

func contentSchema(isPicture bool, format string) json.RawMessage {
	props := `"content":{"type":"string","description":"Content for the new post"},"website":{"type":["string","null"],"description":"Website for the new post if exists, If one of the post present a brand, website link must be to the root domain of the brand or don't include it, website url should contain the brand name"}`
	required := []string{"content", "website"}
	if isPicture {
		props += `,"prompt":{"type":"string","description":"Prompt to generate a picture for this post later, make sure it doesn't contain brand names and make it very descriptive in terms of style"}`
		required = append(required, "prompt")
	}
	item := strictObject(props, required...)
	if format == "one_short" || format == "one_long" {
		return strictObject(`"content":`+string(item), "content")
	}
	return strictObject(`"content":{"type":"array","items":`+string(item)+`,"minItems":2,"description":"Content for the new post"}`, "content")
}

// tavilyTool is @langchain/tavily TavilySearch({ maxResults: 3 }).
var tavilyTool = llm.ToolDef{Type: "function", Function: llm.FunctionDef{
	Name:        "tavily_search",
	Description: "A search engine optimized for comprehensive, accurate, and trusted results. Useful for when you need to answer questions about current events. Input should be a search query.",
	Parameters:  json.RawMessage(tavilyParameters),
}}

const tavilyParameters = `{"type":"object","properties":{"query":{"type":"string","description":"Search query to look up"},"includeDomains":{"type":"array","items":{"type":"string"},"description":"A list of domains to restrict search results to.\n\nUse this parameter when:\n1. The user explicitly requests information from specific websites (e.g., \"Find climate data from nasa.gov\")\n2. The user mentions an organization or company without specifying the domain (e.g., \"Find information about iPhones from Apple\")\n\nIn both cases, you should determine the appropriate domains (e.g., [\"nasa.gov\"] or [\"apple.com\"]) and set this parameter.\n\nResults will ONLY come from the specified domains - no other sources will be included.\nDefault is None (no domain restriction)."},"excludeDomains":{"type":"array","items":{"type":"string"},"description":"A list of domains to exclude from search results.\n\nUse this parameter when:\n1. The user explicitly requests to avoid certain websites (e.g., \"Find information about climate change but not from twitter.com\")\n2. The user mentions not wanting results from specific organizations without naming the domain (e.g., \"Find phone reviews but nothing from Apple\")\n\nIn both cases, you should determine the appropriate domains to exclude (e.g., [\"twitter.com\"] or [\"apple.com\"]) and set this parameter.\n\nResults will filter out all content from the specified domains.\nDefault is None (no domain exclusion)."},"searchDepth":{"type":"string","enum":["basic","advanced"],"description":"Controls search thoroughness and result comprehensiveness.\n\nUse \"basic\" (default) for simple queries requiring quick, straightforward answers.\n\nUse \"advanced\" for complex queries, specialized topics, \nrare information, or when in-depth analysis is needed."},"includeImages":{"type":"boolean","description":"Determines if the search returns relevant images along with text results.\n\nSet to True when the user explicitly requests visuals or when images would \nsignificantly enhance understanding (e.g., \"Show me what black holes look like,\" \n\"Find pictures of Renaissance art\").\n\nLeave as False (default) for most informational queries where text is sufficient."},"timeRange":{"type":"string","enum":["day","week","month","year"],"description":"Limits results to content published within a specific timeframe.\n\nONLY set this when the user explicitly mentions a time period \n(e.g., \"latest AI news,\" \"articles from last week\").\n\nFor less popular or niche topics, use broader time ranges \n(\"month\" or \"year\") to ensure sufficient relevant results.\n\nOptions: \"day\" (24h), \"week\" (7d), \"month\" (30d), \"year\" (365d).\n\nDefault is None."},"topic":{"type":"string","enum":["general","news","finance"],"description":"Specifies search category for optimized results.\n\nUse \"general\" (default) for most queries, INCLUDING those with terms like \n\"latest,\" \"newest,\" or \"recent\" when referring to general information.\n\nUse \"finance\" for markets, investments, economic data, or financial news.\n\nUse \"news\" ONLY for politics, sports, or major current events covered by \nmainstream media - NOT simply because a query asks for \"new\" information."}},"required":["query"],"additionalProperties":false}`

var camelHump = regexp.MustCompile(`[A-Z]`)

// tavilySearch is TavilySearch._call: errors come back as { error }.
func tavilySearch(ctx context.Context, args map[string]any) any {
	params := map[string]any{"maxResults": 3}
	for _, key := range []string{"query", "includeDomains", "excludeDomains", "searchDepth", "includeImages", "timeRange", "topic"} {
		if v, ok := args[key]; ok && v != nil {
			params[key] = v
		}
	}
	body := map[string]any{"client_source": "langchain-js"}
	for k, v := range params {
		body[camelHump.ReplaceAllStringFunc(k, func(s string) string { return "_" + strings.ToLower(s) })] = v
	}
	result, err := func() (any, error) {
		data, _ := json.Marshal(body)
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, TavilyBaseURL+"/search", bytes.NewReader(data))
		if err != nil {
			return nil, err
		}
		req.Header.Set("Authorization", "Bearer "+os.Getenv("TAVILY_API_KEY"))
		req.Header.Set("Content-Type", "application/json")
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			return nil, err
		}
		defer res.Body.Close()
		if res.StatusCode < 200 || res.StatusCode >= 300 {
			var payload struct {
				Detail struct {
					Error string `json:"error"`
				} `json:"detail"`
			}
			_ = json.NewDecoder(res.Body).Decode(&payload)
			message := payload.Detail.Error
			if message == "" {
				message = "Unknown error"
			}
			return nil, fmt.Errorf("Error %d: %s", res.StatusCode, message)
		}
		var out map[string]any
		if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
			return nil, err
		}
		if results, ok := out["results"].([]any); !ok || len(results) == 0 {
			var suggestions []string
			if args["timeRange"] != nil {
				suggestions = append(suggestions, "Remove time_range argument")
			}
			if list, ok := args["includeDomains"].([]any); ok && len(list) > 0 {
				suggestions = append(suggestions, "Remove include_domains argument")
			}
			if list, ok := args["excludeDomains"].([]any); ok && len(list) > 0 {
				suggestions = append(suggestions, "Remove exclude_domains argument")
			}
			if args["searchDepth"] == "basic" {
				suggestions = append(suggestions, "Try a more detailed search using 'advanced' search_depth")
			}
			if topic, ok := args["topic"].(string); ok && topic != "" && topic != "general" {
				suggestions = append(suggestions, "Try a general search using 'general' topic")
			}
			return nil, fmt.Errorf("No search results found for '%v'. Suggestions: %s. Try modifying your search parameters with one of these approaches.", args["query"], strings.Join(suggestions, ", "))
		}
		return out, nil
	}()
	if err != nil {
		return map[string]any{"error": err.Error()}
	}
	return result
}

// Event is one LangGraph streamEvents (v2) event.
type Event struct {
	Event     string         `json:"event"`
	Data      map[string]any `json:"data"`
	Name      string         `json:"name"`
	Tags      []string       `json:"tags"`
	RunID     string         `json:"run_id"`
	Metadata  map[string]any `json:"metadata"`
	ParentIDs []string       `json:"parent_ids"`
}

func snapshot(s *state) map[string]any {
	data, _ := json.Marshal(s)
	var out map[string]any
	_ = json.Unmarshal(data, &out)
	return out
}

// Start is AgentGraphService.start: it runs the graph and hands every event
// to emit, in order (the controller writes them as NDJSON). The last event's
// data.output is the final state. A returned *httpx.Error carries a
// user-facing message (generationError).
func (g *GraphService) Start(ctx context.Context, orgID string, body *generator.GeneratorDto, emit func(Event) error) error {
	s := &state{
		Messages:  []message{{kind: "HumanMessage", kwargs: map[string]any{"content": body.Research, "additional_kwargs": map[string]any{}, "response_metadata": map[string]any{}}}},
		IsPicture: body.IsPicture,
		Format:    body.Format,
		Tone:      body.Tone,
		OrgID:     orgID,
	}
	graphRun := uuid.NewString()
	if err := emit(Event{Event: "on_chain_start", Data: map[string]any{"input": snapshot(s)}, Name: "LangGraph", Tags: []string{}, RunID: graphRun, Metadata: map[string]any{}, ParentIDs: []string{}}); err != nil {
		return err
	}

	step := 0
	node := func(name string, fn func() error) error {
		step++
		runID := uuid.NewString()
		meta := map[string]any{"langgraph_step": step, "langgraph_node": name, "langgraph_triggers": []string{}, "langgraph_path": []string{"__pregel_pull", name}, "langgraph_checkpoint_ns": name}
		tags := []string{fmt.Sprintf("graph:step:%d", step)}
		input := snapshot(s)
		if err := emit(Event{Event: "on_chain_start", Data: map[string]any{"input": input}, Name: name, Tags: tags, RunID: runID, Metadata: meta, ParentIDs: []string{graphRun}}); err != nil {
			return err
		}
		if err := fn(); err != nil {
			return err
		}
		return emit(Event{Event: "on_chain_end", Data: map[string]any{"output": snapshot(s), "input": input}, Name: name, Tags: tags, RunID: runID, Metadata: meta, ParentIDs: []string{graphRun}})
	}

	steps := []struct {
		name string
		fn   func(context.Context, *state) error
	}{
		{"agent", g.startCall},
		{"research", g.research},
		{"save-research", g.saveResearch},
		{"find-category", g.findCategories},
		{"find-topic", g.findTopic},
		{"find-popular-posts", g.findPopularPosts},
		{"generate-hook", g.generateHook},
		{"generate-content", g.generateContent},
		{"generate-content-fix", g.fixArray},
	}
	for _, st := range steps {
		st := st
		if err := node(st.name, func() error { return st.fn(ctx, s) }); err != nil {
			return err
		}
	}
	// isGeneratePicture
	if s.IsPicture {
		if err := node("generate-picture", func() error { return g.generatePictures(ctx, s) }); err != nil {
			return err
		}
		if err := node("upload-pictures", func() error { return g.uploadPictures(ctx, s) }); err != nil {
			return err
		}
	}
	if err := node("post-time", func() error { return g.postDateTime(ctx, s) }); err != nil {
		return err
	}
	return emit(Event{Event: "on_chain_end", Data: map[string]any{"output": snapshot(s)}, Name: "LangGraph", Tags: []string{}, RunID: graphRun, Metadata: map[string]any{}, ParentIDs: []string{}})
}

func (g *GraphService) structured(ctx context.Context, prompt string, schema json.RawMessage, out any) error {
	return llm.Structured(ctx, graphModel, graphTemperature, prompt, schema, out)
}

func (g *GraphService) startCall(ctx context.Context, s *state) error {
	var tools []llm.ToolDef
	if os.Getenv("TAVILY_API_KEY") != "" {
		tools = []llm.ToolDef{tavilyTool}
	}
	prompt := fromTemplate("\n    Today is "+time.Now().Format("2006-01-02T15:04:05-07:00")+", You are an assistant that gets a social media post or requests for a social media post.\n    You research should be on the most possible recent data.\n    You concat the text of the request together with an internet research based on the text.\n    {text}\n    ",
		map[string]any{"text": s.Messages[len(s.Messages)-1].content()})
	temperature := graphTemperature
	reply, err := llm.Complete(ctx, llm.Request{Model: graphModel, Temperature: &temperature, Messages: []llm.Message{llm.Text("user", prompt)}, Tools: tools})
	if err != nil {
		return err
	}
	var toolCalls []map[string]any
	for _, tc := range reply.ToolCalls {
		var args map[string]any
		_ = json.Unmarshal([]byte(tc.Function.Arguments), &args)
		toolCalls = append(toolCalls, map[string]any{"name": tc.Function.Name, "args": args, "id": tc.ID, "type": "tool_call"})
	}
	if toolCalls == nil {
		toolCalls = []map[string]any{}
	}
	s.Messages = append(s.Messages, message{kind: "AIMessage", kwargs: map[string]any{
		"content": reply.ContentText(), "tool_calls": toolCalls, "invalid_tool_calls": []any{},
		"additional_kwargs": map[string]any{}, "response_metadata": map[string]any{},
	}})
	return nil
}

// research is the ToolNode: it runs the tool calls of the last AI message.
func (g *GraphService) research(ctx context.Context, s *state) error {
	last := s.Messages[len(s.Messages)-1]
	if last.kind != "AIMessage" {
		return fmt.Errorf("ToolNode only accepts AIMessages as input.")
	}
	calls, _ := last.kwargs["tool_calls"].([]map[string]any)
	results := make([]message, len(calls))
	var wg sync.WaitGroup
	for i, call := range calls {
		wg.Add(1)
		go func(i int, call map[string]any) {
			defer wg.Done()
			args, _ := call["args"].(map[string]any)
			var output any
			if call["name"] == tavilyTool.Function.Name {
				output = tavilySearch(ctx, args)
			} else {
				output = fmt.Sprintf("Error: Tool \"%v\" not found.\n Please fix your mistakes.", call["name"])
			}
			content, ok := output.(string)
			if !ok {
				data, _ := json.Marshal(output)
				content = string(data)
			}
			results[i] = message{kind: "ToolMessage", kwargs: map[string]any{
				"status": "success", "name": call["name"], "content": content, "tool_call_id": call["id"],
				"additional_kwargs": map[string]any{}, "response_metadata": map[string]any{},
			}}
		}(i, call)
	}
	wg.Wait()
	s.Messages = append(s.Messages, results...)
	return nil
}

func (g *GraphService) saveResearch(_ context.Context, s *state) error {
	s.Fresearch = []message{}
	for _, m := range s.Messages {
		if m.kind == "ToolMessage" {
			s.Fresearch = append(s.Fresearch, m)
		}
	}
	return nil
}

func (g *GraphService) findCategories(ctx context.Context, s *state) error {
	all, err := g.posts.FindAllExistingCategories(ctx)
	if err != nil {
		return err
	}
	var categories []string
	for _, p := range all {
		categories = append(categories, p.Category)
	}
	var out struct {
		Category string `json:"category"`
	}
	if err := g.structured(ctx, fromTemplate("\n        You are an assistant that gets a text that will be later summarized into a social media post\n        and classify it to one of the following categories: {categories}\n        text: {text}\n      ",
		map[string]any{"categories": strings.Join(categories, ", "), "text": s.Fresearch}), categorySchema, &out); err != nil {
		return err
	}
	s.Category = out.Category
	return nil
}

func (g *GraphService) findTopic(ctx context.Context, s *state) error {
	all, err := g.posts.FindAllExistingTopicsOfCategory(ctx, s.Category)
	if err != nil {
		return err
	}
	if len(all) == 0 {
		s.Topic = nil
		return nil
	}
	var topics []string
	for _, p := range all {
		topics = append(topics, p.Topic)
	}
	var out struct {
		Topic string `json:"topic"`
	}
	if err := g.structured(ctx, fromTemplate("\n        You are an assistant that gets a text that will be later summarized into a social media post\n        and classify it to one of the following topics: {topics}\n        text: {text}\n      ",
		map[string]any{"topics": strings.Join(topics, ", "), "text": s.Fresearch}), topicSchema, &out); err != nil {
		return err
	}
	s.Topic = &out.Topic
	return nil
}

func (g *GraphService) findPopularPosts(ctx context.Context, s *state) error {
	topic := ""
	if s.Topic != nil {
		topic = *s.Topic
	}
	list, err := g.posts.FindPopularPosts(ctx, s.Category, topic)
	if err != nil {
		return err
	}
	s.PopularPosts = []popularPost{}
	for _, p := range list {
		s.PopularPosts = append(s.PopularPosts, popularPost{Content: p.Content, Hook: p.Hook})
	}
	return nil
}

func person(tone string) string {
	if tone == "personal" {
		return "1st"
	}
	return "3rd"
}

func (g *GraphService) generateHook(ctx context.Context, s *state) error {
	var hooks []string
	for _, p := range s.PopularPosts {
		hooks = append(hooks, p.Hook)
	}
	prompt := "\n        You are an assistant that gets content for a social media post, and generate only the hook.\n        The hook is the 1-2 sentences of the post that will be used to grab the attention of the reader.\n        You will be provided existing hooks you should use as inspiration.\n        - Avoid weird hook that starts with \"Discover the secret...\", \"The best...\", \"The most...\", \"The top...\"\n        - Make sure it sounds " + s.Tone + "\n        - Use " + person(s.Tone) + " person mode\n        - Make sure it's engaging\n        - Don't be cringy\n        - Use simple english\n        - Make sure you add \"\n\" between the lines\n        - Don't take the hook from \"request of the user\"\n\n        <!-- BEGIN request of the user -->\n        {request}\n        <!-- END request of the user -->\n        \n        <!-- BEGIN existing hooks -->\n        {hooks}\n        <!-- END existing hooks -->\n        \n        <!-- BEGIN current content -->\n        {text}\n        <!-- END current content -->\n       \n      "
	var out struct {
		Hook string `json:"hook"`
	}
	if err := g.structured(ctx, fromTemplate(prompt, map[string]any{"request": s.Messages[0].content(), "hooks": strings.Join(hooks, "\n"), "text": s.Fresearch}), hookSchema, &out); err != nil {
		return err
	}
	s.Hook = out.Hook
	return nil
}

func (g *GraphService) generateContent(ctx context.Context, s *state) error {
	length := "Post should be long"
	if s.Format == "one_short" || s.Format == "thread_short" {
		length = "Post should be maximum 200 chars to fit twitter"
	}
	items := "Post should have minimum 2 items"
	if s.Format == "one_short" || s.Format == "one_long" {
		items = "Post should have only 1 item"
	}
	prompt := "\n        You are an assistant that gets existing hook of a social media, content and generate only the content.\n        - Don't add any hashtags\n        - Make sure it sounds " + s.Tone + "\n        - Use " + person(s.Tone) + " person mode\n        - " + length + "\n        - " + items + "\n        - Use the hook as inspiration\n        - Make sure it's engaging\n        - Don't be cringy\n        - Use simple english\n        - The Content should not contain the hook\n        - Try to put some call to action at the end of the post\n        - Make sure you add \"\n\" between the lines\n        - Add \"\n\" after every \".\"\n        \n        Hook:\n        {hook}\n        \n        User request:\n        {request}\n        \n        current content information:\n        {information}\n      "
	var out struct {
		Content json.RawMessage `json:"content"`
	}
	if err := g.structured(ctx, fromTemplate(prompt, map[string]any{"hook": s.Hook, "request": s.Messages[0].content(), "information": s.Fresearch}), contentSchema(s.IsPicture, s.Format), &out); err != nil {
		return err
	}
	// one_* answers one object, generate-content-fix wraps it
	var list []*contentItem
	if json.Unmarshal(out.Content, &list) != nil {
		var one contentItem
		if err := json.Unmarshal(out.Content, &one); err != nil {
			return err
		}
		list = []*contentItem{&one}
	}
	s.Content = list
	return nil
}

// fixArray: the one_* formats already hold a one-item list (see
// generateContent), so there is nothing left to wrap.
func (g *GraphService) fixArray(_ context.Context, s *state) error { return nil }

func (g *GraphService) generatePictures(ctx context.Context, s *state) error {
	if !s.IsPicture {
		return nil
	}
	errs := make([]error, len(s.Content))
	var wg sync.WaitGroup
	for i, p := range s.Content {
		wg.Add(1)
		go func(i int, p *contentItem) {
			defer wg.Done()
			image, err := llm.GenerateImage(ctx, imageModel, p.Prompt)
			if err != nil {
				errs[i] = err
				return
			}
			p.Image = image
		}(i, p)
	}
	wg.Wait()
	for _, err := range errs {
		if err != nil {
			return generationError(err)
		}
	}
	return nil
}

func (g *GraphService) uploadPictures(ctx context.Context, s *state) error {
	for _, p := range s.Content {
		image, ok := p.Image.(string)
		if !ok || image == "" {
			continue
		}
		upload, err := g.storage.UploadSimple(ctx, image)
		if err != nil {
			return err
		}
		parts := strings.Split(upload, "/")
		media, err := g.media.SaveFile(ctx, s.OrgID, parts[len(parts)-1], upload)
		if err != nil {
			return err
		}
		p.Image = media
	}
	return nil
}

func (g *GraphService) postDateTime(ctx context.Context, s *state) error {
	date, err := g.posts.FindFreeDateTime(ctx, s.OrgID)
	if err != nil {
		return err
	}
	s.Date = date
	return nil
}

var (
	safetyViolations = regexp.MustCompile(`(?i)safety_violations=\[([^\]]*)\]`)
	safetyMessage    = regexp.MustCompile(`(?i)safety system|safety_violations|content[ _]policy|rejected as a result of our safety|moderation`)
)

// generationError turns a provider error into a
// user-facing HttpException, surfacing AI safety rejections.
func generationError(err error) error {
	if httpErr, ok := err.(*httpx.Error); ok {
		return httpErr
	}
	message := err.Error()
	if safetyMessage.MatchString(message) {
		detail := ""
		if m := safetyViolations.FindStringSubmatch(message); m != nil && strings.TrimSpace(m[1]) != "" {
			detail = fmt.Sprintf(" Flagged categories: %s.", strings.TrimSpace(m[1]))
		}
		return httpx.HTTPException(fmt.Sprintf("Your request was rejected by the AI safety system.%s Please adjust your prompt and try again.", detail), 422)
	}
	slog.Error("AI generation failed:", "message", message)
	return httpx.HTTPException("AI generation failed, please try again later.", 500)
}
