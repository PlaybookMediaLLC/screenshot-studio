package openai

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"math/rand/v2"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

// This file is the slice of the openai npm SDK the original app uses: authenticated
// JSON requests with the SDK's retry rules, and chat.completions.parse.

// baseURL is the SDK default; OPENAI_BASE_URL overrides it like in the SDK.
// Overridden in tests.
var baseURL = "https://api.openai.com/v1"

// APIError is the SDK's APIError: the HTTP status and the `error` object of
// the body. Its message is "<status> <error.message>".
type APIError struct {
	Status int
	Body   map[string]any
	msg    string
}

func (e *APIError) Error() string { return e.msg }

// ErrorMessage is err.error.message, what generationError reads first.
func (e *APIError) ErrorMessage() string {
	if s, ok := e.Body["message"].(string); ok {
		return s
	}
	return ""
}

func newAPIError(status int, data []byte) *APIError {
	var body struct {
		Error map[string]any `json:"error"`
	}
	_ = json.Unmarshal(data, &body)
	e := &APIError{Status: status, Body: body.Error}
	msg := e.ErrorMessage()
	if msg == "" && body.Error != nil {
		encoded, _ := json.Marshal(body.Error)
		msg = string(encoded)
	}
	if msg == "" {
		e.msg = fmt.Sprintf("%d status code (no body)", status)
	} else {
		e.msg = fmt.Sprintf("%d %s", status, msg)
	}
	return e
}

type requestOptions struct {
	timeout    time.Duration
	maxRetries int
}

var defaultOptions = requestOptions{timeout: 10 * time.Minute, maxRetries: 2}

func apiKey() string {
	if key := os.Getenv("OPENAI_API_KEY"); key != "" {
		return key
	}
	return "sk-proj-"
}

func apiBase() string {
	if base := os.Getenv("OPENAI_BASE_URL"); base != "" {
		return strings.TrimRight(base, "/")
	}
	return baseURL
}

func shouldRetry(res *http.Response) bool {
	switch res.Header.Get("x-should-retry") {
	case "true":
		return true
	case "false":
		return false
	}
	return res.StatusCode == 408 || res.StatusCode == 409 || res.StatusCode == 429 || res.StatusCode >= 500
}

// retryDelay honors retry-after-ms / retry-after under a minute, otherwise
// backs off exponentially from 0.5s to 8s with up to 25% jitter.
func retryDelay(res *http.Response, retriesLeft, maxRetries int) time.Duration {
	if res != nil {
		if ms, err := strconv.ParseFloat(res.Header.Get("retry-after-ms"), 64); err == nil && ms >= 0 && ms < 60000 {
			return time.Duration(ms * float64(time.Millisecond))
		}
		if s, err := strconv.ParseFloat(res.Header.Get("retry-after"), 64); err == nil && s >= 0 && s < 60 {
			return time.Duration(s * float64(time.Second))
		}
		if t, err := http.ParseTime(res.Header.Get("retry-after")); err == nil {
			if d := time.Until(t); d >= 0 && d < time.Minute {
				return d
			}
		}
	}
	numRetries := maxRetries - retriesLeft
	sleep := math.Min(0.5*math.Pow(2, float64(numRetries)), 8)
	return time.Duration(sleep * (1 - rand.Float64()*0.25) * float64(time.Second))
}

// post sends body to path and decodes the JSON answer into out.
func post(ctx context.Context, path string, body, out any, opts requestOptions) error {
	data, err := json.Marshal(body)
	if err != nil {
		return err
	}
	for retriesLeft := opts.maxRetries; ; retriesLeft-- {
		res, respBody, err := send(ctx, path, data, opts.timeout)
		if err != nil {
			// connection errors and timeouts are retried too
			if ctx.Err() != nil || retriesLeft <= 0 {
				return err
			}
		} else if res.StatusCode >= 200 && res.StatusCode <= 299 {
			return json.Unmarshal(respBody, out)
		} else if retriesLeft <= 0 || !shouldRetry(res) {
			return newAPIError(res.StatusCode, respBody)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(retryDelay(res, retriesLeft, opts.maxRetries)):
		}
	}
}

func send(ctx context.Context, path string, data []byte, timeout time.Duration) (*http.Response, []byte, error) {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, apiBase()+path, bytes.NewReader(data))
	if err != nil {
		return nil, nil, err
	}
	req.Header.Set("Authorization", "Bearer "+apiKey())
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	if org := os.Getenv("OPENAI_ORG_ID"); org != "" {
		req.Header.Set("OpenAI-Organization", org)
	}
	if project := os.Getenv("OPENAI_PROJECT_ID"); project != "" {
		req.Header.Set("OpenAI-Project", project)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, nil, err
	}
	defer res.Body.Close()
	respBody, err := io.ReadAll(res.Body)
	if err != nil {
		return nil, nil, err
	}
	return res, respBody, nil
}

type message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type chatRequest struct {
	Model          string          `json:"model"`
	Messages       []message       `json:"messages"`
	ResponseFormat json.RawMessage `json:"response_format,omitempty"`
	N              int             `json:"n,omitempty"`
	Temperature    *float64        `json:"temperature,omitempty"`
}

type choice struct {
	FinishReason string `json:"finish_reason"`
	Message      struct {
		Content *string `json:"content"`
		Refusal *string `json:"refusal"`
	} `json:"message"`
}

type chatResponse struct {
	Choices []choice `json:"choices"`
}

func createChat(ctx context.Context, req chatRequest, opts requestOptions) (*chatResponse, error) {
	var res chatResponse
	if err := post(ctx, "/chat/completions", req, &res, opts); err != nil {
		return nil, err
	}
	return &res, nil
}

// responseFormat is zodResponseFormat(schema, name): a strict JSON schema.
func responseFormat(name, schema string) json.RawMessage {
	return json.RawMessage(`{"type":"json_schema","json_schema":{"name":"` + name + `","strict":true,"schema":` + schema + `}}`)
}

// parseChat is chat.completions.parse: it rejects truncated and filtered
// answers and decodes the first choice into out. parsed is false when the
// model refused or sent no content (message.parsed is null).
func parseChat(ctx context.Context, req chatRequest, opts requestOptions, out any) (parsed bool, err error) {
	res, err := createChat(ctx, req, opts)
	if err != nil {
		return false, err
	}
	for _, c := range res.Choices {
		switch c.FinishReason {
		case "length":
			return false, errors.New("Could not parse response content as the length limit was reached")
		case "content_filter":
			return false, errors.New("Could not parse response content as the request was rejected by the content filter")
		}
	}
	if len(res.Choices) == 0 {
		return false, errors.New("Cannot read properties of undefined (reading 'message')")
	}
	msg := res.Choices[0].Message
	if msg.Content == nil || msg.Refusal != nil {
		return false, nil
	}
	if err := json.Unmarshal([]byte(*msg.Content), out); err != nil {
		return false, err
	}
	return true, nil
}
