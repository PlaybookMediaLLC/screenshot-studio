// Package llm is the OpenAI HTTP client behind the Postiz agent and the
// post generator: the Go form of what @ai-sdk/openai (Mastra) and
// @langchain/openai (ChatOpenAI, DallEAPIWrapper) send to OpenAI. Only plain
// HTTP: chat completions (streamed or not), structured output and images.
package llm

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
)

// BaseURL is the OpenAI API root; tests point it at an httptest server.
var BaseURL = "https://api.openai.com/v1"

type Message struct {
	Role       string     `json:"role"`
	Content    *string    `json:"content"`
	ToolCalls  []ToolCall `json:"tool_calls,omitempty"`
	ToolCallID string     `json:"tool_call_id,omitempty"`
}

// Text builds a message with string content.
func Text(role, content string) Message { return Message{Role: role, Content: &content} }

// ContentText returns the content or "".
func (m Message) ContentText() string {
	if m.Content == nil {
		return ""
	}
	return *m.Content
}

type ToolCall struct {
	ID       string       `json:"id"`
	Type     string       `json:"type"`
	Function FunctionCall `json:"function"`
}

type FunctionCall struct {
	Name      string `json:"name"`
	Arguments string `json:"arguments"`
}

type ToolDef struct {
	Type     string      `json:"type"`
	Function FunctionDef `json:"function"`
}

type FunctionDef struct {
	Name        string          `json:"name"`
	Description string          `json:"description,omitempty"`
	Parameters  json.RawMessage `json:"parameters"`
	Strict      *bool           `json:"strict,omitempty"`
}

type Request struct {
	Model          string    `json:"model"`
	Messages       []Message `json:"messages"`
	Tools          []ToolDef `json:"tools,omitempty"`
	Temperature    *float64  `json:"temperature,omitempty"`
	ResponseFormat any       `json:"response_format,omitempty"`
	Stream         bool      `json:"stream,omitempty"`
}

// Error is an OpenAI API error, rendered like the openai SDK ("400 message").
type Error struct {
	Status  int
	Message string
}

func (e *Error) Error() string { return fmt.Sprintf("%d %s", e.Status, e.Message) }

func apiKey() string {
	if key := os.Getenv("OPENAI_API_KEY"); key != "" {
		return key
	}
	// LangChain's `process.env.OPENAI_API_KEY || 'sk-proj-'`
	return "sk-proj-"
}

func post(ctx context.Context, path string, body any) (*http.Response, error) {
	data, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, BaseURL+path, bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+apiKey())
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	if res.StatusCode >= 300 {
		defer res.Body.Close()
		raw, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
		var payload struct {
			Error struct {
				Message string `json:"message"`
			} `json:"error"`
		}
		message := strings.TrimSpace(string(raw))
		if json.Unmarshal(raw, &payload) == nil && payload.Error.Message != "" {
			message = payload.Error.Message
		}
		return nil, &Error{Status: res.StatusCode, Message: message}
	}
	return res, nil
}

// Complete runs a non-streamed chat completion and returns the first choice.
func Complete(ctx context.Context, req Request) (*Message, error) {
	req.Stream = false
	res, err := post(ctx, "/chat/completions", req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	var out struct {
		Choices []struct {
			Message Message `json:"message"`
		} `json:"choices"`
	}
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
		return nil, err
	}
	if len(out.Choices) == 0 {
		return nil, fmt.Errorf("no choices in the completion")
	}
	return &out.Choices[0].Message, nil
}

// Stream runs a streamed chat completion: onText receives every text delta,
// the assembled assistant message (text and tool calls) is returned.
func Stream(ctx context.Context, req Request, onText func(delta string)) (*Message, error) {
	req.Stream = true
	res, err := post(ctx, "/chat/completions", req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()

	var text strings.Builder
	var calls []ToolCall
	scanner := bufio.NewScanner(res.Body)
	scanner.Buffer(make([]byte, 64*1024), 16<<20)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if data == "[DONE]" {
			break
		}
		var chunk struct {
			Choices []struct {
				Delta struct {
					Content   string `json:"content"`
					ToolCalls []struct {
						Index    int    `json:"index"`
						ID       string `json:"id"`
						Function struct {
							Name      string `json:"name"`
							Arguments string `json:"arguments"`
						} `json:"function"`
					} `json:"tool_calls"`
				} `json:"delta"`
			} `json:"choices"`
			Error *struct {
				Message string `json:"message"`
			} `json:"error"`
		}
		if err := json.Unmarshal([]byte(data), &chunk); err != nil {
			continue
		}
		if chunk.Error != nil {
			return nil, &Error{Status: http.StatusInternalServerError, Message: chunk.Error.Message}
		}
		for _, choice := range chunk.Choices {
			if choice.Delta.Content != "" {
				text.WriteString(choice.Delta.Content)
				if onText != nil {
					onText(choice.Delta.Content)
				}
			}
			for _, tc := range choice.Delta.ToolCalls {
				for len(calls) <= tc.Index {
					calls = append(calls, ToolCall{Type: "function"})
				}
				if tc.ID != "" {
					calls[tc.Index].ID = tc.ID
				}
				calls[tc.Index].Function.Name += tc.Function.Name
				calls[tc.Index].Function.Arguments += tc.Function.Arguments
			}
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	msg := Message{Role: "assistant", ToolCalls: calls}
	if text.Len() > 0 {
		content := text.String()
		msg.Content = &content
	}
	return &msg, nil
}

// Structured is ChatOpenAI.withStructuredOutput(zodSchema) with the default
// jsonSchema method: response_format json_schema named "extract", strict as
// openai's zodResponseFormat sets it. The answer is decoded into out.
func Structured(ctx context.Context, model string, temperature float64, prompt string, schema json.RawMessage, out any) error {
	msg, err := Complete(ctx, Request{
		Model:       model,
		Temperature: &temperature,
		Messages:    []Message{Text("user", prompt)},
		ResponseFormat: map[string]any{
			"type": "json_schema",
			"json_schema": map[string]any{
				"name":   "extract",
				"schema": schema,
				"strict": true,
			},
		},
	})
	if err != nil {
		return err
	}
	return json.Unmarshal([]byte(msg.ContentText()), out)
}

// GenerateImage is DallEAPIWrapper._call: one image, the url it answers with.
func GenerateImage(ctx context.Context, model, prompt string) (string, error) {
	res, err := post(ctx, "/images/generations", map[string]any{
		"model":           model,
		"prompt":          prompt,
		"n":               1,
		"size":            "1024x1024",
		"response_format": "url",
		"style":           "vivid",
		"quality":         "standard",
	})
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	var out struct {
		Data []struct {
			URL string `json:"url"`
		} `json:"data"`
	}
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
		return "", err
	}
	if len(out.Data) == 0 {
		return "", nil
	}
	return out.Data[0].URL, nil
}
