// Package deepgram is the original app's DeepgramService: transcribes a media URL.
package deepgram

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/upload"
)

// listenURL is overridden in tests.
var listenURL = "https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true&utterances=true&detect_language=true"

// Service is DeepgramService.
type Service struct{}

func NewService() *Service { return &Service{} }

// TranscribeURL has Deepgram fetch the file itself, so media bytes never
// pass through here. The answer comes back on the same request: an hour of
// audio takes about a minute, and Deepgram gives up on its side after ten.
func (s *Service) TranscribeURL(ctx context.Context, url string) (*upload.ClippingTranscript, error) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Minute)
	defer cancel()

	body, _ := json.Marshal(map[string]string{"url": url})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, listenURL, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Token "+os.Getenv("DEEPGRAM_API_KEY"))
	req.Header.Set("Content-Type", "application/json")

	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	data, err := io.ReadAll(res.Body)
	if err != nil {
		return nil, err
	}
	if res.StatusCode < 200 || res.StatusCode > 299 {
		text := []rune(string(data))
		if len(text) > 500 {
			text = text[:500]
		}
		return nil, fmt.Errorf("Deepgram %d: %s", res.StatusCode, string(text))
	}

	var out struct {
		Results *struct {
			Channels []struct {
				DetectedLanguage string `json:"detected_language"`
				Alternatives     []struct {
					Words []struct {
						Word           string  `json:"word"`
						PunctuatedWord string  `json:"punctuated_word"`
						Start          float64 `json:"start"`
						End            float64 `json:"end"`
					} `json:"words"`
				} `json:"alternatives"`
			} `json:"channels"`
			Utterances []struct {
				Start      float64 `json:"start"`
				End        float64 `json:"end"`
				Transcript string  `json:"transcript"`
			} `json:"utterances"`
		} `json:"results"`
	}
	if err := json.Unmarshal(data, &out); err != nil {
		return nil, err
	}

	transcript := &upload.ClippingTranscript{
		Version:   1,
		Language:  "en",
		Origin:    "transcribed",
		WordLevel: true,
		Segments:  []upload.ClippingSegment{},
		Words:     []upload.ClippingWord{},
	}
	if out.Results == nil {
		return transcript, nil
	}
	for _, p := range out.Results.Utterances {
		transcript.Segments = append(transcript.Segments, upload.ClippingSegment{Start: p.Start, End: p.End, Text: p.Transcript})
	}
	if len(out.Results.Channels) == 0 {
		return transcript, nil
	}
	channel := out.Results.Channels[0]
	if channel.DetectedLanguage != "" {
		transcript.Language = channel.DetectedLanguage
	}
	if len(channel.Alternatives) > 0 {
		for _, p := range channel.Alternatives[0].Words {
			text := p.PunctuatedWord
			if text == "" {
				text = p.Word
			}
			transcript.Words = append(transcript.Words, upload.ClippingWord{Text: text, Start: p.Start, End: p.End})
		}
	}
	return transcript, nil
}
