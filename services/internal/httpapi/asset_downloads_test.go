package httpapi

import (
	"net/http/httptest"
	"strings"
	"testing"
)

func TestAssetContentKeepsRangeAndPrivateCacheSemantics(t *testing.T) {
	for _, method := range []string{"GET", "POST"} {
		for _, scenario := range []struct {
			rangeHeader        string
			status             int
			body, contentRange string
		}{
			{"", 200, "private bytes", ""},
			{"bytes=0-6", 206, "private", "bytes 0-6/13"},
			{"bytes=99-100", 416, "invalid range", "bytes */13"},
		} {
			r := httptest.NewRequest(method, "/asset", nil)
			r.Header.Set("Range", scenario.rangeHeader)
			w := httptest.NewRecorder()
			serveAssetBytes(w, r, []byte("private bytes"), "image/png")
			if w.Code != scenario.status || !strings.Contains(w.Body.String(), scenario.body) || w.Header().Get("Content-Range") != scenario.contentRange {
				t.Fatalf("%s %q: status=%d body=%q range=%q", method, scenario.rangeHeader, w.Code, w.Body, w.Header().Get("Content-Range"))
			}
			if w.Header().Get("Cache-Control") != "private, no-store" || w.Header().Get("X-Content-Type-Options") != "nosniff" || w.Header().Get("Location") != "" {
				t.Fatalf("unsafe response headers: %v", w.Header())
			}
		}
	}
}
