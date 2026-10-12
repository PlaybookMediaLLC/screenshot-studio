package openai

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"regexp"
	"strings"
	"time"

	"golang.org/x/net/html"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/httpx"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/ssrf"
)

// falURL is overridden in tests.
var falURL = "https://fal.run/fal-ai/"

// falLimit is the p-limit(10) shared by every fal call.
var falLimit = make(chan struct{}, 10)

// FalService calls fal.ai models.
type FalService struct{}

func NewFalService() *FalService { return &FalService{} }

// GenerateImageFromText returns the video URL when the model made a video,
// the first image URL otherwise.
func (f *FalService) GenerateImageFromText(ctx context.Context, model, text string, isVertical bool) (string, error) {
	aspectRatio := "16:9"
	if isVertical {
		aspectRatio = "9:16"
	}
	body, _ := json.Marshal(map[string]any{
		"prompt":        text,
		"aspect_ratio":  aspectRatio,
		"resolution":    "720p",
		"num_images":    1,
		"output_format": "jpeg",
		"expand_prompt": true,
	})

	ctx, cancel := context.WithTimeout(ctx, 300*time.Second)
	defer cancel()

	select {
	case falLimit <- struct{}{}:
	case <-ctx.Done():
		return "", ctx.Err()
	}
	data, status, err := func() ([]byte, int, error) {
		defer func() { <-falLimit }()
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, falURL+model, bytes.NewReader(body))
		if err != nil {
			return nil, 0, err
		}
		req.Header.Set("Authorization", "Key "+os.Getenv("FAL_KEY"))
		req.Header.Set("Content-Type", "application/json")
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			return nil, 0, err
		}
		defer res.Body.Close()
		data, err := io.ReadAll(res.Body)
		return data, res.StatusCode, err
	}()
	if err != nil {
		return "", err
	}
	if status < 200 || status > 299 {
		return "", fmt.Errorf("fal %d: %s", status, truncate(string(data), 500))
	}

	var res struct {
		Images []struct {
			URL string `json:"url"`
		} `json:"images"`
		Video *struct {
			URL string `json:"url"`
		} `json:"video"`
	}
	if err := json.Unmarshal(data, &res); err != nil {
		return "", err
	}
	slog.Info("fal response", "body", string(data))
	if res.Video != nil {
		return res.Video.URL, nil
	}
	if len(res.Images) == 0 {
		return "", errors.New("Cannot read properties of undefined (reading 'url')")
	}
	return res.Images[0].URL, nil
}

func truncate(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n])
}

// ExtractContentService pulls the article text out of a web page.
type ExtractContentService struct{}

func NewExtractContentService() *ExtractContentService { return &ExtractContentService{} }

var headings = []string{"h1", "h2", "h3", "h4", "h5", "h6"}

// ExtractContent returns the text of the element holding the most heading
// levels (the deepest on ties), with newlines and runs of spaces collapsed;
// "" when the page has no heading.
func (e *ExtractContentService) ExtractContent(ctx context.Context, url string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", err
	}
	res, err := ssrf.Client().Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	doc, err := html.Parse(res.Body)
	if err != nil {
		return "", err
	}

	// querySelectorAll('*') in document order, keeping elements that have a
	// heading descendant, reversed
	var all []*html.Node
	var walk func(n *html.Node)
	walk = func(n *html.Node) {
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			if c.Type == html.ElementNode {
				all = append(all, c)
			}
			walk(c)
		}
	}
	walk(doc)

	type candidate struct {
		total, depth int
		element      *html.Node
	}
	best := candidate{}
	for i := len(all) - 1; i >= 0; i-- {
		current := all[i]
		calculate := 0
		for _, tag := range headings {
			if hasDescendant(current, tag) {
				calculate++
			}
		}
		if calculate == 0 {
			continue
		}
		depth := 0
		for p := current; p.Parent != nil; p = p.Parent {
			depth++
		}
		if calculate > best.total || depth > best.depth {
			best = candidate{total: calculate, depth: depth, element: current}
		}
	}
	if best.element == nil {
		return "", nil
	}
	return multiSpace.ReplaceAllString(strings.ReplaceAll(textContent(best.element), "\n", " "), " "), nil
}

var multiSpace = regexp.MustCompile(` {2,}`)

func hasDescendant(n *html.Node, tag string) bool {
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		if c.Type == html.ElementNode && c.Data == tag || hasDescendant(c, tag) {
			return true
		}
	}
	return false
}

func textContent(n *html.Node) string {
	var b strings.Builder
	var walk func(n *html.Node)
	walk = func(n *html.Node) {
		if n.Type == html.TextNode {
			b.WriteString(n.Data)
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	walk(n)
	return b.String()
}

var (
	// e.g. "400 Your request was rejected by the safety system, safety_violations=[sexual]"
	safetyViolationsRegex = regexp.MustCompile(`(?i)safety_violations=\[([^\]]*)\]`)
	// Match genuine content-safety rejections by message, NOT by a bare 400
	// status: a 400 can just as easily be an invalid-parameter error, which
	// must not be reported to the user as a safety violation.
	safetyMessageRegex = regexp.MustCompile(`(?i)safety system|safety_violations|content[ _]policy|rejected as a result of our safety|moderation`)
)

// GenerationError normalizes errors thrown by AI generation providers
// (OpenAI image/chat, Fal, Seedance, HeyGen, ElevenLabs, ...) into a clean
// HTTP error so a provider rejection (most notably an OpenAI safety
// violation) returns a proper response instead of crashing the backend.
// When the provider reports a content-safety rejection, the flagged
// categories are surfaced back to the user.
func GenerationError(err error) *httpx.Error {
	// Preserve errors we already raised intentionally (e.g. SubscriptionException).
	var httpErr *httpx.Error
	if errors.As(err, &httpErr) {
		return httpErr
	}

	message := ""
	var apiErr *APIError
	if errors.As(err, &apiErr) {
		message = apiErr.ErrorMessage()
	}
	if message == "" && err != nil {
		message = err.Error()
	}

	if safetyMessageRegex.MatchString(message) {
		detail := ""
		if m := safetyViolationsRegex.FindStringSubmatch(message); m != nil && strings.TrimSpace(m[1]) != "" {
			detail = " Flagged categories: " + strings.TrimSpace(m[1]) + "."
		}
		return httpx.HTTPException("Your request was rejected by the AI safety system."+detail+" Please adjust your prompt and try again.", 422)
	}

	// Not a recognized safety rejection (e.g. an invalid-parameter 400):
	// a generic message rather than mislabeling it as a content-safety issue.
	// The real reason (a quota, a bad key, ...) is only useful to the operator.
	slog.Error("AI generation failed: " + message)
	return httpx.HTTPException("AI generation failed, please try again later.", 500)
}
