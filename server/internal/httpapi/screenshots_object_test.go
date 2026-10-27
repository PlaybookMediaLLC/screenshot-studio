package httpapi

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

type cacheObjectConfiguration struct {
	fakeConfiguration
	body []byte
}

func (c *cacheObjectConfiguration) PutScreenshotCacheObject(_ context.Context, _ string, body []byte) error {
	c.body = append([]byte(nil), body...)
	return nil
}

func (c *cacheObjectConfiguration) GetScreenshotCacheObject(context.Context, string) ([]byte, error) {
	return c.body, nil
}

func TestScreenshotCacheObjectRequiresServiceAuthAndPreservesBytes(t *testing.T) {
	config := &cacheObjectConfiguration{}
	handler := NewWithConfiguration(&fakeStore{}, &fakeScheduler{}, &fakeVerifier{}, "secret", config)
	path := "/v1/internal/screenshot-cache/" + string(bytes.Repeat([]byte{'a'}, 64)) + "/object"
	call := func(method string, body []byte, authorize bool, contentType string) *httptest.ResponseRecorder {
		request := httptest.NewRequest(method, path, bytes.NewReader(body))
		if authorize {
			request.Header.Set("Authorization", "Bearer secret")
		}
		if contentType != "" {
			request.Header.Set("Content-Type", contentType)
		}
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		return response
	}
	if response := call(http.MethodPut, []byte("png"), false, "image/png"); response.Code != http.StatusUnauthorized {
		t.Fatalf("unauthorized upload returned %d", response.Code)
	}
	if response := call(http.MethodPut, []byte("png"), true, "text/plain"); response.Code != http.StatusBadRequest {
		t.Fatalf("wrong content type returned %d", response.Code)
	}
	image := []byte{137, 80, 78, 71, 13, 10, 26, 10}
	if response := call(http.MethodPut, image, true, "image/png"); response.Code != http.StatusOK || !bytes.Equal(config.body, image) {
		t.Fatalf("upload returned %d; saved %v", response.Code, config.body)
	}
	response := call(http.MethodGet, nil, true, "")
	var result struct {
		Base64 string `json:"base64"`
	}
	if response.Code != http.StatusOK || json.Unmarshal(response.Body.Bytes(), &result) != nil || result.Base64 != base64.StdEncoding.EncodeToString(image) {
		t.Fatalf("download returned %d: %s", response.Code, response.Body.String())
	}
}
