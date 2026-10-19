// Package openai is the original app's openai/* folder: OpenaiService (chat and image
// generation over the OpenAI REST API), ExtractContentService, FalService
// and generationError.
package openai

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math/rand/v2"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf16"
)

// The zod schemas, as zodResponseFormat sends them.
const (
	picturePromptSchema = `{"type":"object","properties":{"prompt":{"type":"string"}},"required":["prompt"],"additionalProperties":false}`
	voicePromptSchema   = `{"type":"object","properties":{"voice":{"type":"string"}},"required":["voice"],"additionalProperties":false}`
	clipsPromptSchema   = `{"type":"object","properties":{"clips":{"type":"array","items":{"type":"object","properties":{` +
		`"from":{"type":"number","description":"Number of the first line of the clip"},` +
		`"to":{"type":"number","description":"Number of the last line of the clip"},` +
		`"title":{"type":"string","description":"Short title of the clip"},` +
		`"content":{"type":"string","description":"Social media post to publish the clip with, no hashtags"}},` +
		`"required":["from","to","title","content"],"additionalProperties":false}}},"required":["clips"],"additionalProperties":false}`
	separatePostsSchema = `{"type":"object","properties":{"posts":{"type":"array","items":{"type":"string"}}},"required":["posts"],"additionalProperties":false}`
	slidesSchema        = `{"type":"object","properties":{"slides":{"type":"array","items":{"type":"object","properties":{` +
		`"imagePrompt":{"type":"string"},"voiceText":{"type":"string"}},"required":["imagePrompt","voiceText"],"additionalProperties":false},` +
		`"description":"an array of slides"}},"required":["slides"],"additionalProperties":false}`
)

func separatePostSchema(length int) string {
	return `{"type":"object","properties":{"post":{"type":"string","maxLength":` + strconv.Itoa(length) + `}},"required":["post"],"additionalProperties":false}`
}

// Service is OpenaiService.
type Service struct{}

func NewService() *Service { return &Service{} }

// Segment is one transcript line handed to PickClips.
type Segment struct {
	Start float64 `json:"start"`
	End   float64 `json:"end"`
	Text  string  `json:"text"`
}

// Clip is one clip the model picked.
type Clip struct {
	From    float64 `json:"from"`
	To      float64 `json:"to"`
	Title   string  `json:"title"`
	Content string  `json:"content"`
}

// PickClips asks for clips by line number and not by time, so a clip can
// only start and end where the transcript really has a boundary.
func (s *Service) PickClips(ctx context.Context, title, language string, segments []Segment, maxClips int) ([]Clip, error) {
	lines := make([]string, len(segments))
	for i, p := range segments {
		lines[i] = fmt.Sprintf("%d [%s - %s] %s", i, strconv.FormatFloat(p.Start, 'f', 1, 64), strconv.FormatFloat(p.End, 'f', 1, 64), p.Text)
	}

	var out struct {
		Clips []Clip `json:"clips"`
	}
	parsed, err := parseChat(ctx, chatRequest{
		Model: "gpt-4.1",
		Messages: []message{
			{Role: "system", Content: fmt.Sprintf(`You are an assistant that takes the transcript of a video and picks the parts that will work best as short vertical clips for social media.
Every line of the transcript is "number [start seconds - end seconds] text".
Pick up to %d clips, best first. A clip is a range of consecutive lines that starts with a hook, makes one complete point and is understandable without the rest of the video.
The length of a clip is the end of its last line minus the start of its first line: it must be between 20 and 90 seconds, never longer, so check the numbers before answering.
Clips must not overlap. Write the title and the post in this language, whatever the language of these instructions: %s.`, maxClips, language)},
			{Role: "user", Content: "title: " + title + "\n\n" + strings.Join(lines, "\n")},
		},
		ResponseFormat: responseFormat("clipsPrompt", clipsPromptSchema),
	},
		// shorter than the activity: an attempt that was given up on must
		// not still be running, and storing clips, when its retry gets there
		requestOptions{timeout: 8 * time.Minute, maxRetries: 0}, &out)
	if err != nil {
		return nil, err
	}
	if !parsed || out.Clips == nil {
		return []Clip{}, nil
	}
	return out.Clips, nil
}

// GenerateImage returns the base64 image. gpt-image models always return
// base64 (b64_json) and do not accept the `response_format` parameter,
// unlike the deprecated dall-e-3.
func (s *Service) GenerateImage(ctx context.Context, prompt string, isVertical bool) (string, error) {
	size := "1024x1024"
	if isVertical {
		size = "1024x1536"
	}
	var res struct {
		Data []struct {
			B64JSON string `json:"b64_json"`
		} `json:"data"`
	}
	if err := post(ctx, "/images/generations", map[string]any{
		"prompt": prompt,
		"model":  "chatgpt-image-latest",
		"size":   size,
	}, &res, defaultOptions); err != nil {
		return "", err
	}
	if len(res.Data) == 0 {
		return "", errors.New("Cannot read properties of undefined (reading 'b64_json')")
	}
	return res.Data[0].B64JSON, nil
}

func (s *Service) GeneratePromptForPicture(ctx context.Context, prompt string) (string, error) {
	var out struct {
		Prompt string `json:"prompt"`
	}
	_, err := parseChat(ctx, chatRequest{
		Model: "gpt-4.1",
		Messages: []message{
			{Role: "system", Content: "You are an assistant that take a description and style and generate a prompt that will be used later to generate images, make it a very long and descriptive explanation, and write a lot of things for the renderer like, if it's realistic describe the camera"},
			{Role: "user", Content: "prompt: " + prompt},
		},
		ResponseFormat: responseFormat("picturePrompt", picturePromptSchema),
	}, defaultOptions, &out)
	return out.Prompt, err
}

func (s *Service) GenerateVoiceFromText(ctx context.Context, prompt string) (string, error) {
	var out struct {
		Voice string `json:"voice"`
	}
	_, err := parseChat(ctx, chatRequest{
		Model: "gpt-4.1",
		Messages: []message{
			{Role: "system", Content: `You are an assistant that takes a social media post and convert it to a normal human voice, to be later added to a character, when a person talk they don't use "-", and sometimes they add pause with "..." to make it sounds more natural, make sure you use a lot of pauses and make it sound like a real person`},
			{Role: "user", Content: "prompt: " + prompt},
		},
		ResponseFormat: responseFormat("voice", voicePromptSchema),
	}, defaultOptions, &out)
	return out.Voice, err
}

// jsSlice is String.prototype.slice(start, end) over UTF-16 units.
func jsSlice(s string, start, end int) string {
	units := utf16.Encode([]rune(s))
	clamp := func(i int) int {
		if i < 0 {
			i += len(units)
		}
		return max(0, min(i, len(units)))
	}
	start, end = clamp(start), clamp(end)
	if start >= end {
		return ""
	}
	return string(utf16.Decode(units[start:end]))
}

func utf16Index(s, sub string, last bool) int {
	i := strings.Index(s, sub)
	if last {
		i = strings.LastIndex(s, sub)
	}
	if i < 0 {
		return -1
	}
	return len(utf16.Encode([]rune(s[:i])))
}

var spaces = strings.NewReplacer("\n", " ")

func collapseSpaces(s string) string {
	s = spaces.Replace(s)
	for strings.Contains(s, "  ") {
		s = strings.ReplaceAll(s, "  ", " ")
	}
	return s
}

// GeneratePosts asks for five single posts and five threads and returns
// each answer's JSON array (an empty one when it does not parse), shuffled.
func (s *Service) GeneratePosts(ctx context.Context, content string) ([]any, error) {
	temperature := 1.0
	prompts := []string{
		`Generate a Twitter post from the content without emojis in the following JSON format: { "post": string } put it in an array with one element`,
		`Generate a thread for social media in the following JSON format: Array<{ "post": string }> without emojis`,
	}
	results := make([]*chatResponse, len(prompts))
	errs := make([]error, len(prompts))
	var wg sync.WaitGroup
	for i, prompt := range prompts {
		wg.Go(func() {
			results[i], errs[i] = createChat(ctx, chatRequest{
				Messages:    []message{{Role: "assistant", Content: prompt}, {Role: "user", Content: content}},
				N:           5,
				Temperature: &temperature,
				Model:       "gpt-4.1",
			}, defaultOptions)
		})
	}
	wg.Wait()
	if err := errors.Join(errs...); err != nil {
		return nil, err
	}

	posts := []any{}
	for _, res := range results {
		for _, c := range res.Choices {
			text := ""
			if c.Message.Content != nil {
				text = *c.Message.Content
			}
			start, end := utf16Index(text, "[", false), utf16Index(text, "]", true)
			var parsed any
			if json.Unmarshal([]byte("["+collapseSpaces(jsSlice(text, start+1, end))+"]"), &parsed) != nil {
				parsed = []any{}
			}
			posts = append(posts, parsed)
		}
	}
	rand.Shuffle(len(posts), func(i, j int) { posts[i], posts[j] = posts[j], posts[i] })
	return posts, nil
}

func (s *Service) ExtractWebsiteText(ctx context.Context, content string) ([]any, error) {
	res, err := createChat(ctx, chatRequest{
		Messages: []message{
			{Role: "assistant", Content: "You take a full website text, and extract only the article content"},
			{Role: "user", Content: content},
		},
		Model: "gpt-4.1",
	}, defaultOptions)
	if err != nil {
		return nil, err
	}
	articleContent := ""
	if len(res.Choices) > 0 && res.Choices[0].Message.Content != nil {
		articleContent = *res.Choices[0].Message.Content
	}
	return s.GeneratePosts(ctx, articleContent)
}

// SeparatePostsResult is separatePosts' {posts}.
type SeparatePostsResult struct {
	Posts []string `json:"posts"`
}

func utf16Len(s string) int { return len(utf16.Encode([]rune(s))) }

// SeparatePosts breaks a post into a thread of posts of at most length
// characters, shrinking (up to 4 tries) any the model made too long.
func (s *Service) SeparatePosts(ctx context.Context, content string, length int) (*SeparatePostsResult, error) {
	var out struct {
		Posts []string `json:"posts"`
	}
	if _, err := parseChat(ctx, chatRequest{
		Model: "gpt-4.1",
		Messages: []message{
			{Role: "system", Content: fmt.Sprintf("You are an assistant that take a social media post and break it to a thread, each post must be minimum %d and maximum %d characters, keeping the exact wording and break lines, however make sure you split posts based on context", length-10, length)},
			{Role: "user", Content: content},
		},
		ResponseFormat: responseFormat("separatePosts", separatePostsSchema),
	}, defaultOptions, &out); err != nil {
		return nil, err
	}

	posts := make([]string, len(out.Posts))
	var wg sync.WaitGroup
	for i, post := range out.Posts {
		wg.Go(func() {
			posts[i] = post
			if utf16Len(post) <= length {
				return
			}
			for range 4 {
				var shrunk struct {
					Post string `json:"post"`
				}
				parsed, err := parseChat(ctx, chatRequest{
					Model: "gpt-4.1",
					Messages: []message{
						{Role: "system", Content: fmt.Sprintf("You are an assistant that take a social media post and shrink it to be maximum %d characters, keeping the exact wording and break lines", length)},
						{Role: "user", Content: post},
					},
					ResponseFormat: responseFormat("separatePost", separatePostSchema(length)),
				}, defaultOptions, &shrunk)
				// z.string().max(len) fails the parse, which is retried
				if err == nil && utf16Len(shrunk.Post) > length {
					err = fmt.Errorf("String must contain at most %d character(s)", length)
				}
				if err == nil {
					if !parsed {
						shrunk.Post = ""
					}
					posts[i] = shrunk.Post
					return
				}
			}
		})
	}
	wg.Wait()
	return &SeparatePostsResult{Posts: posts}, nil
}

// Slide is one slide of GenerateSlidesFromText.
type Slide struct {
	ImagePrompt string `json:"imagePrompt"`
	VoiceText   string `json:"voiceText"`
}

// GenerateSlidesFromText tries three times and returns no slides when every
// attempt fails.
func (s *Service) GenerateSlidesFromText(ctx context.Context, text string) []Slide {
	for range 3 {
		var out struct {
			Slides []Slide `json:"slides"`
		}
		_, err := parseChat(ctx, chatRequest{
			Model: "gpt-4.1",
			Messages: []message{
				{Role: "system", Content: "You are an assistant that takes a text and break it into slides, each slide should have an image prompt and voice text to be later used to generate a video and voice, image prompt should capture the essence of the slide and also have a back dark gradient on top, image prompt should not contain text in the picture, generate between 3-5 slides maximum"},
				{Role: "user", Content: text},
			},
			ResponseFormat: responseFormat("slides", slidesSchema),
		}, defaultOptions, &out)
		if err != nil {
			slog.Info("generateSlidesFromText failed", "error", err)
			continue
		}
		if out.Slides == nil {
			return []Slide{}
		}
		return out.Slides
	}
	return []Slide{}
}
