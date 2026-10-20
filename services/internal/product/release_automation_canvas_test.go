package product

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
)

// The worker's canvas builder signs the exact body the way the web verifies it,
// posts to the canvas endpoint beside the renderer, and reads back the canvas id.
func TestHTTPCanvasBuilderSignsTheRequestAndReadsTheCanvas(t *testing.T) {
	key := strings.Repeat("k", 32)
	var received AutomationCanvasRequest
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		stamp, signature, _ := strings.Cut(r.Header.Get("x-shots-signature"), ",")
		mac := hmac.New(sha256.New, []byte(key))
		mac.Write([]byte(strings.TrimPrefix(stamp, "t=") + "."))
		mac.Write(body)
		if r.URL.Path != "/api/internal/workflow-canvases" || signature != "v1="+hex.EncodeToString(mac.Sum(nil)) {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		if err := json.Unmarshal(body, &received); err != nil || received.ReleaseID == "missing" {
			w.WriteHeader(http.StatusUnprocessableEntity)
			return
		}
		_, _ = w.Write([]byte(`{"canvasId":"c` + strings.Repeat("b", 24) + `"}`))
	}))
	defer server.Close()
	t.Setenv("PLATFORM_WORKFLOW_RENDER_URL", server.URL+"/")
	t.Setenv("PLATFORM_WORKFLOW_RENDER_KEY", key)
	builder := AutomationRendererFromEnvironment()
	if builder == nil {
		t.Fatal("no builder from the environment")
	}
	request := AutomationCanvasRequest{OrganizationID: "org", RunID: "run", NodeID: "board", ReleaseID: "release", RecipeIDs: []string{"feature-announcement", "social-pack"}}
	id, err := builder.BuildCanvas(context.Background(), request)
	if err != nil || id != "c"+strings.Repeat("b", 24) {
		t.Fatalf("id=%q err=%v", id, err)
	}
	if received.OrganizationID != "org" || received.NodeID != "board" || !slices.Equal(received.RecipeIDs, request.RecipeIDs) {
		t.Fatalf("received=%+v", received)
	}
	// A refusal is permanent: the activity must not retry it.
	request.ReleaseID = "missing"
	if _, err := builder.BuildCanvas(context.Background(), request); !errors.Is(err, ErrRendererRefused) {
		t.Fatalf("refusal not reported: %v", err)
	}
	t.Setenv("PLATFORM_WORKFLOW_RENDER_KEY", "short")
	if AutomationRendererFromEnvironment() != nil {
		t.Fatal("a short key configured the builder")
	}
}
