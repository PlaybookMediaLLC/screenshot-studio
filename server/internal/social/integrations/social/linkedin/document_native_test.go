package linkedin

import (
	"bytes"
	"context"
	_ "embed"
	"encoding/json"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/temporalx"
	"net/http"
	"testing"
)

// Chromium-generated two-page document, also used in the authenticated browser flow.
//
//go:embed testdata/two-pages.pdf
var nativePDF []byte

func TestNativePDFPreservesBytesAndWaitsForDocumentProcessing(t *testing.T) {
	for _, fails := range []bool{false, true} {
		t.Run(map[bool]string{false: "available", true: "processing failure"}[fails], func(t *testing.T) {
			f, srv := newFake(t, nil)
			f.routes["GET /media/document.pdf"] = func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/pdf")
				_, _ = w.Write(nativePDF)
			}
			f.routes["POST /rest/documents"] = jsonReply(map[string]any{"value": map[string]any{"uploadUrl": srv.URL + "/upload", "document": "urn:li:document:1"}})
			f.routes["PUT /upload"] = func(w http.ResponseWriter, r *http.Request) {}
			status := "PROCESSING"
			f.routes["GET /rest/documents/urn:li:document:1"] = func(w http.ResponseWriter, r *http.Request) {
				_ = json.NewEncoder(w).Encode(map[string]any{"status": status})
			}
			f.routes["POST /rest/posts"] = func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("x-restli-id", "urn:li:share:9")
				w.WriteHeader(201)
			}
			p := New()
			ctx := context.Background()
			posts, err := p.PostPendingAs(ctx, "org1", "fixture-token", []integrations.PostDetails{{ID: "p1", Message: "Native PDF", Settings: json.RawMessage(`{"document_title":"Two pages"}`), Media: []integrations.MediaContent{{Type: "document", Path: srv.URL + "/media/document.pdf"}}}}, Company)
			if err != nil {
				t.Fatal(err)
			}
			upload := f.find("PUT", "/upload")
			if len(upload) != 1 || upload[0].header.Get("Content-Type") != "application/pdf" || !bytes.Equal(upload[0].body, nativePDF) {
				t.Fatal("native PDF bytes were replaced by images or modified")
			}
			raw := posts[0].PendingData
			check, err := p.CheckPostStatus(ctx, "fixture-token", raw, nil)
			if err != nil || check.Status != "pending" || len(f.find("POST", "/rest/posts")) != 0 {
				t.Fatalf("published before processing: %+v %v", check, err)
			}
			if fails {
				status = "PROCESSING_FAILED"
				if _, err = p.CheckPostStatus(ctx, "fixture-token", check.PendingData, nil); temporalx.FailureType(err) != temporalx.TypeBadBody {
					t.Fatalf("processing failure not terminal: %v", err)
				}
				if len(f.find("POST", "/rest/posts")) != 0 {
					t.Fatal("failed document published")
				}
				return
			}
			status = "AVAILABLE"
			check, err = p.CheckPostStatus(ctx, "fixture-token", check.PendingData, nil)
			if err != nil || check.Status != "ready" {
				t.Fatalf("document not ready: %+v %v", check, err)
			}
			armed, err := p.FinalizePost(ctx, "fixture-token", check.PendingData, nil)
			if err != nil || armed.Status != "pending" {
				t.Fatalf("arm: %+v %v", armed, err)
			}
			confirmed, err := p.CheckPostStatus(ctx, "fixture-token", armed.PendingData, nil)
			if err != nil {
				t.Fatal(err)
			}
			complete, err := p.FinalizePost(ctx, "fixture-token", confirmed.PendingData, nil)
			if err != nil || complete.Status != "completed" || complete.PostID != "urn:li:share:9" {
				t.Fatalf("receipt: %+v %v", complete, err)
			}
			var payload postPayload
			_ = json.Unmarshal(f.find("POST", "/rest/posts")[0].body, &payload)
			media := payload.Content["media"].(map[string]any)
			if media["id"] != "urn:li:document:1" || media["title"] != "Two pages" {
				t.Fatalf("not a native document: %+v", media)
			}
			// Reconciliation after an ambiguous create must not create a duplicate.
			if _, err = p.CheckPostStatus(ctx, "fixture-token", confirmed.PendingData, nil); err == nil {
				t.Fatal("ambiguous creation was retried")
			}
			if len(f.find("POST", "/rest/posts")) != 1 || len(f.find("PUT", "/upload")) != 1 {
				t.Fatal("recovery repeated a mutation")
			}
		})
	}
}
