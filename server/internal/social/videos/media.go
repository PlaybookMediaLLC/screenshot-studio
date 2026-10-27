package videos

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha512"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"strings"
	"time"
)

// mp3Duration is music-metadata's duration for an MPEG Layer III buffer
// (what ElevenLabs returns): frame count of a Xing/Info header when there is
// one, the CBR size estimate otherwise; 0 when no frame is found.
func mp3Duration(b []byte) float64 {
	offset := 0
	if len(b) >= 10 && string(b[:3]) == "ID3" {
		offset = 10 + (int(b[6]&0x7F)<<21 | int(b[7]&0x7F)<<14 | int(b[8]&0x7F)<<7 | int(b[9]&0x7F))
		if b[5]&0x10 != 0 {
			offset += 10
		}
	}
	for ; offset+4 <= len(b); offset++ {
		if b[offset] != 0xFF || b[offset+1]&0xE0 != 0xE0 {
			continue
		}
		version, layer := b[offset+1]>>3&3, b[offset+1]>>1&3
		bitrateIndex, rateIndex := b[offset+2]>>4, b[offset+2]>>2&3
		if version == 1 || layer != 1 || bitrateIndex == 0 || bitrateIndex == 15 || rateIndex == 3 {
			continue
		}
		mpeg1 := version == 3
		bitrates := []int{0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160}
		rates := map[byte][3]int{3: {44100, 48000, 32000}, 2: {22050, 24000, 16000}, 0: {11025, 12000, 8000}}
		samplesPerFrame, sideInfo := 576.0, 17
		if mpeg1 {
			bitrates = []int{0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320}
			samplesPerFrame, sideInfo = 1152, 32
		}
		mono := b[offset+3]>>6 == 3
		if mono {
			sideInfo = map[bool]int{true: 17, false: 9}[mpeg1]
		}
		bitrate, sampleRate := bitrates[bitrateIndex]*1000, float64(rates[version][rateIndex])

		xing := offset + 4 + sideInfo
		if xing+12 <= len(b) && (string(b[xing:xing+4]) == "Xing" || string(b[xing:xing+4]) == "Info") && b[xing+7]&1 != 0 {
			frames := int(b[xing+8])<<24 | int(b[xing+9])<<16 | int(b[xing+10])<<8 | int(b[xing+11])
			return float64(frames) * samplesPerFrame / sampleRate
		}
		size := len(b) - offset
		if len(b) >= 128 && string(b[len(b)-128:len(b)-125]) == "TAG" {
			size -= 128
		}
		return float64(size) * 8 / float64(bitrate)
	}
	return 0
}

type cue struct {
	start, end float64 // milliseconds
	text       string
}

// srtTimestamp is the subtitle package's formatTimestamp (milliseconds
// floored).
func srtTimestamp(ms float64) string {
	whole := int64(ms)
	return fmt.Sprintf("%02d:%02d:%02d,%03d", whole/3600000, whole/60000%60, whole/1000%60, whole%1000)
}

// stringifySRT is stringifySync(cues, {format: 'SRT'}).
func stringifySRT(cues []cue) string {
	var b strings.Builder
	for i, c := range cues {
		fmt.Fprintf(&b, "%d\n%s --> %s\n%s\n\n", i+1, srtTimestamp(c.start), srtTimestamp(c.end), c.text)
	}
	return b.String()
}

// transloaditURL and assemblyPollInterval are overridden in tests.
var (
	transloaditURL       = "https://api2.transloadit.com"
	assemblyPollInterval = time.Second
)

type assemblyResult struct {
	URL    string `json:"url"`
	SSLURL string `json:"ssl_url"`
}

type assemblyStatus struct {
	OK             string                      `json:"ok"`
	Error          string                      `json:"error"`
	Message        string                      `json:"message"`
	AssemblySSLURL string                      `json:"assembly_ssl_url"`
	Results        map[string][]assemblyResult `json:"results"`
}

func (s *assemblyStatus) err() error {
	if s.Error == "" {
		return nil
	}
	return fmt.Errorf("%s: %s", s.Error, s.Message)
}

// createAssembly is the Transloadit SDK's createAssembly with
// waitForCompletion: it uploads the files with the signed params, then polls
// the assembly until it is no longer uploading or executing.
func createAssembly(ctx context.Context, uploads map[string]string, steps map[string]any, timeout time.Duration) (map[string][]assemblyResult, error) {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	authKey, authSecret := os.Getenv("TRANSLOADIT_AUTH"), os.Getenv("TRANSLOADIT_SECRET")
	if authKey == "" {
		authKey = "just empty text"
	}
	if authSecret == "" {
		authSecret = "just empty text"
	}
	params, _ := json.Marshal(map[string]any{
		"auth":  map[string]any{"key": authKey, "expires": time.Now().UTC().Add(24 * time.Hour).Format("2006-01-02T15:04:05.000Z")},
		"steps": steps,
	})
	mac := hmac.New(sha512.New384, []byte(authSecret))
	mac.Write(params)

	var body bytes.Buffer
	form := multipart.NewWriter(&body)
	_ = form.WriteField("params", string(params))
	_ = form.WriteField("signature", "sha384:"+hex.EncodeToString(mac.Sum(nil)))
	for name, content := range uploads {
		part, err := form.CreateFormFile(name, name)
		if err != nil {
			return nil, err
		}
		_, _ = part.Write([]byte(content))
	}
	_ = form.Close()

	status, err := getAssembly(ctx, http.MethodPost, transloaditURL+"/assemblies", &body, form.FormDataContentType())
	if err != nil {
		return nil, err
	}
	for status.OK == "ASSEMBLY_UPLOADING" || status.OK == "ASSEMBLY_EXECUTING" || status.OK == "ASSEMBLY_REPLAYING" {
		select {
		case <-ctx.Done():
			return nil, errors.New("Polling timed out")
		case <-time.After(assemblyPollInterval):
		}
		if status, err = getAssembly(ctx, http.MethodGet, status.AssemblySSLURL, nil, ""); err != nil {
			return nil, err
		}
	}
	return status.Results, nil
}

func getAssembly(ctx context.Context, method, url string, body io.Reader, contentType string) (*assemblyStatus, error) {
	req, err := http.NewRequestWithContext(ctx, method, url, body)
	if err != nil {
		return nil, err
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	var status assemblyStatus
	if err := json.NewDecoder(res.Body).Decode(&status); err != nil {
		return nil, err
	}
	return &status, status.err()
}
