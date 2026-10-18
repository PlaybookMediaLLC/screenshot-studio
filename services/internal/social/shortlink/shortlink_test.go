package shortlink

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

type fake struct {
	mu        sync.Mutex
	converted []string
	stats     []string
}

func (f *fake) ShortLinkDomain() string { return "short.ly" }
func (f *fake) LinksStatistics(_ context.Context, links []string) ([]Statistic, error) {
	f.stats = links
	return []Statistic{{Short: links[0]}}, nil
}
func (f *fake) ConvertLinkToShortLink(_ context.Context, id, link string) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.converted = append(f.converted, link)
	return "https://short.ly/" + id + "-" + string(rune('a'+len(f.converted)-1)), nil
}
func (f *fake) ConvertShortLinkToLink(_ context.Context, shortLink string) (string, error) {
	return "https://long.example.com/" + lastSegment(shortLink), nil
}
func (f *fake) GetAllLinksStatistics(context.Context, string, int) ([]Statistic, error) {
	return nil, nil
}

func TestAskShortLinkedin(t *testing.T) {
	s := &Service{provider: &fake{}}
	if s.AskShortLinkedin([]string{"no links here"}) {
		t.Error("no urls")
	}
	if s.AskShortLinkedin([]string{"see https://short.ly/abc"}) {
		t.Error("already short")
	}
	if !s.AskShortLinkedin([]string{"hello", "read https://www.example.com/post?id=1 now"}) {
		t.Error("long url")
	}
	if (&Service{provider: Empty{}}).AskShortLinkedin([]string{"https://example.com"}) {
		t.Error("empty provider never asks")
	}
}

func TestConvertTextToShortLinks(t *testing.T) {
	f := &fake{}
	s := &Service{provider: f}
	out, err := s.ConvertTextToShortLinks(context.Background(), "org", []string{
		"a https://example.com/x?a=1&amp;b=2 and https://example.com/x?a=1&b=2 and https://short.ly/keep",
		"nothing",
	})
	if err != nil {
		t.Fatal(err)
	}
	// &amp; is decoded first, so both spellings are the same URL, shortened once
	if len(f.converted) != 1 || f.converted[0] != "https://example.com/x?a=1&b=2" {
		t.Fatalf("converted %v", f.converted)
	}
	if out[0] != "a https://short.ly/org-a and https://short.ly/org-a and https://short.ly/keep" || out[1] != "nothing" {
		t.Errorf("got %q", out)
	}

	empty, _ := (&Service{provider: Empty{}}).ConvertTextToShortLinks(context.Background(), "org", []string{"https://example.com &amp;"})
	if empty[0] != "https://example.com &amp;" {
		t.Errorf("empty provider returns input untouched: %q", empty[0])
	}
}

func TestURLRegex(t *testing.T) {
	text := "x https://example.com/path_(1)?q=a+b#frag, http://sub.domain.io. https://localhost:3000/a"
	got := urlRegex.FindAllString(text, -1)
	want := []string{"https://example.com/path_(1)?q=a+b#frag", "http://sub.domain.io."}
	if strings.Join(got, "|") != strings.Join(want, "|") {
		t.Errorf("got %q", got)
	}
}

func TestConvertShortLinksToLinksAndStatistics(t *testing.T) {
	f := &fake{}
	s := &Service{provider: f}
	out, err := s.ConvertShortLinksToLinks(context.Background(), []string{"go https://short.ly/abc and https://other.com/x"})
	if err != nil || out[0] != "go https://long.example.com/abc and https://other.com/x" {
		t.Errorf("got %q %v", out, err)
	}

	stats, err := s.GetStatistics(context.Background(), []string{`<p><a href="x">https://short.ly/abc</a></p>`, "https://other.com"})
	if err != nil || len(stats) != 1 || strings.Join(f.stats, ",") != "https://short.ly/abc" {
		t.Errorf("stats %v %v %v", stats, f.stats, err)
	}
}

func TestKuttProvider(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-API-Key") != "k" {
			w.WriteHeader(401)
			return
		}
		switch {
		case r.Method == "POST" && r.URL.Path == "/links":
			w.Write([]byte(`{"link":"https://kutt.it/xyz"}`))
		case r.URL.Path == "/links/xyz/stats":
			w.Write([]byte(`{"address":"https://long","lastDay":{"stats":[1,2,3]}}`))
		default:
			w.WriteHeader(500)
		}
	}))
	defer srv.Close()
	t.Setenv("KUTT_API_KEY", "k")
	t.Setenv("KUTT_API_ENDPOINT", srv.URL)
	t.Setenv("DUB_TOKEN", "")
	t.Setenv("SHORT_IO_SECRET_KEY", "")

	s := NewService()
	out, err := s.ConvertTextToShortLinks(context.Background(), "org", []string{"https://example.com/a"})
	if err != nil || out[0] != "https://kutt.it/xyz" {
		t.Fatalf("%q %v", out, err)
	}
	stats, _ := s.GetStatistics(context.Background(), []string{"https://kutt.it/xyz", "https://kutt.it/bad"})
	if stats[0].Original != "https://long" || stats[0].Clicks != "6" || stats[1].Clicks != "0" {
		t.Errorf("stats %+v", stats)
	}
	t.Setenv("KUTT_API_KEY", "wrong")
	if _, err := s.ConvertTextToShortLinks(context.Background(), "org", []string{"https://example.com/a"}); err == nil ||
		err.Error() != "Failed to create short link: Error: HTTP error! status: 401" {
		t.Errorf("error %v", err)
	}
}

// Short.io: every page is read (nextPageToken) and each link gets its own
// statistics request. Postiz returned {} rows and looped on 100+ links.
func TestShortIoAllLinksStatistics(t *testing.T) {
	var mu sync.Mutex
	pages := []string{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer sk" {
			w.WriteHeader(401)
			return
		}
		switch {
		case r.URL.Path == "/api/links":
			q := r.URL.Query()
			if q.Get("domain_id") != "77" || q.Get("limit") != "150" {
				w.WriteHeader(400)
				return
			}
			mu.Lock()
			pages = append(pages, q.Get("pageToken"))
			mu.Unlock()
			if q.Get("pageToken") == "" {
				w.Write([]byte(`{"count":2,"links":[{"id":"lnk_1","shortURL":"https://s.io/a","originalURL":"https://a"},{"id":"lnk_2","shortURL":"https://s.io/b","originalURL":"https://b"}],"nextPageToken":"t2"}`))
				return
			}
			w.Write([]byte(`{"count":1,"links":[{"id":"lnk_3","shortURL":"https://s.io/c","originalURL":"https://c"}],"nextPageToken":null}`))
		case strings.HasPrefix(r.URL.Path, "/statistics/link/"):
			if r.URL.Query().Get("period") != "last30" {
				w.WriteHeader(400)
				return
			}
			clicks := map[string]string{"lnk_1": "5", "lnk_2": "0", "lnk_3": "12"}[strings.TrimPrefix(r.URL.Path, "/statistics/link/")]
			w.Write([]byte(`{"totalClicks":` + clicks + `}`))
		default:
			w.WriteHeader(404)
		}
	}))
	defer srv.Close()
	oldAPI, oldStats := shortIoAPI, shortIoStatistics
	shortIoAPI, shortIoStatistics = srv.URL, srv.URL
	t.Cleanup(func() { shortIoAPI, shortIoStatistics = oldAPI, oldStats })
	t.Setenv("SHORT_IO_SECRET_KEY", "sk")

	out, err := (&ShortIo{}).GetAllLinksStatistics(context.Background(), "77", 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(pages) != 2 || pages[1] != "t2" {
		t.Fatalf("pages %q", pages)
	}
	want := []Statistic{{"https://s.io/a", "https://a", 5.0}, {"https://s.io/b", "https://b", 0.0}, {"https://s.io/c", "https://c", 12.0}}
	if len(out) != len(want) {
		t.Fatalf("got %+v", out)
	}
	for i := range want {
		if out[i] != want[i] {
			t.Fatalf("row %d: got %+v want %+v", i, out[i], want[i])
		}
	}

	t.Setenv("SHORT_IO_SECRET_KEY", "wrong")
	if _, err := (&ShortIo{}).GetAllLinksStatistics(context.Background(), "77", 1); err == nil {
		t.Fatal("want an error on a failed list request")
	}
}
