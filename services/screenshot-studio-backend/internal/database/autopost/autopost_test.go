package autopost

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/database/dbtest"
	dto "github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/dtos/autopost"
)

func TestMain(m *testing.M) {
	time.Local = time.UTC
	os.Exit(m.Run())
}

const rssFeed = `<?xml version="1.0" encoding="ISO-8859-1"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:atom="http://www.w3.org/2005/Atom">
<channel><title>t</title>
<item><title>old</title><link>https://blog.example/old</link><pubDate>Mon, 02 Jan 2006 15:04:05 GMT</pubDate><description>old one</description></item>
<item><title>new</title><atom:link href="https://ignored"/><link>https://blog.example/new</link><pubDate>Tue, 10 Mar 2026 10:00:00 +0000</pubDate>
<description>short</description><content:encoded><![CDATA[<p>Hello
<b>world</b></p>]]></content:encoded></item>
<item><title>bad date</title><link>https://blog.example/bad</link><pubDate>not a date</pubDate></item>
</channel></rss>`

const atomFeed = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
<entry><title>a</title><link rel="self" href="https://a.example/self"/><link rel="alternate" href="https://a.example/post"/>
<updated>2026-03-01T00:00:00Z</updated><content type="html">&lt;p&gt;Atom &amp;amp; body&lt;/p&gt;</content></entry>
</feed>`

func serve(t *testing.T, body string) string {
	t.Helper()
	t.Setenv("DISABLE_SSRF_PROTECTION", "true")
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("User-Agent") != "rss-parser" {
			w.WriteHeader(400)
			return
		}
		io.WriteString(w, body)
	}))
	t.Cleanup(srv.Close)
	return srv.URL
}

func TestLoadXML(t *testing.T) {
	s := &Service{}
	ctx := context.Background()

	got := s.LoadXML(ctx, serve(t, rssFeed))
	data, _ := json.Marshal(got)
	if string(data) != `{"success":true,"date":"Tue, 10 Mar 2026 10:00:00 +0000","url":"https://blog.example/new","description":"Hello world"}` {
		t.Fatalf("rss: %s", data)
	}

	got = s.LoadXML(ctx, serve(t, atomFeed))
	if !got.Success || *got.Date != "2026-03-01T00:00:00.000Z" || *got.URL != "https://a.example/post" || *got.Description != "Atom &amp; body" {
		t.Fatalf("atom: %+v", got)
	}

	if got := s.LoadXML(ctx, serve(t, "<html></html>")); got.Success {
		t.Fatal("html accepted as a feed")
	}
	if data, _ := json.Marshal(s.LoadXML(ctx, "http://127.0.0.1:1/none")); string(data) != `{"success":false}` {
		t.Fatalf("unreachable: %s", data)
	}
}

type fakePosts struct{ bodies []CreatePostBody }

func (f *fakePosts) FindFreeDateTime(context.Context, string, string) (string, error) {
	return "2026-03-11T02:00:00", nil
}

func (f *fakePosts) CreatePost(_ context.Context, _ string, body CreatePostBody, method string) error {
	if method != "AUTOPOST" {
		panic(method)
	}
	f.bodies = append(f.bodies, body)
	return nil
}

type fakeIntegrations struct{ list []*ent.Integration }

func (f fakeIntegrations) GetIntegrationsList(context.Context, string) ([]*ent.Integration, error) {
	return f.list, nil
}

func TestStartAutopost(t *testing.T) {
	client := dbtest.Open(t)
	ctx := context.Background()
	feedURL := serve(t, rssFeed)

	// OpenAI answers the structured output call
	ai := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		if r.URL.Path != "/chat/completions" || !strings.Contains(string(body), `Hello world`) || !strings.Contains(string(body), `"model":"gpt-4.1"`) {
			w.WriteHeader(500)
			return
		}
		io.WriteString(w, `{"choices":[{"message":{"content":"{\"socialMediaPostContent\":\"Line 1\\nLine 2\"}"}}]}`)
	}))
	defer ai.Close()
	t.Setenv("OPENAI_BASE_URL", ai.URL)

	org := client.Organization.Create().SetName("Acme").SaveX(ctx)
	x := client.Integration.Create().SetOrganization(org).SetInternalID("1").SetName("X").SetProviderIdentifier("x").SetType("social").SetToken("t").SaveX(ctx)
	li := client.Integration.Create().SetOrganization(org).SetInternalID("2").SetName("L").SetProviderIdentifier("linkedin").SetType("social").SetToken("t").SaveX(ctx)

	posts := &fakePosts{}
	s := NewService(NewRepository(client), nil, fakeIntegrations{[]*ent.Integration{x, li}}, posts)
	yes, no, last := true, false, "https://blog.example/old"
	created, err := s.CreateAutopost(ctx, org.ID, dto.AutopostDto{
		Title: "feed", URL: feedURL, LastURL: &last, OnSlot: &no, SyncLast: &no, Active: &yes, AddPicture: &no,
		GenerateContent: &yes, Integrations: []dto.Integrations{{ID: li.ID}},
	}, "")
	if err != nil || !created.Active {
		t.Fatal(created, err)
	}

	if err := s.StartAutopost(ctx, created.ID); err != nil {
		t.Fatal(err)
	}
	if len(posts.bodies) != 1 {
		t.Fatalf("posts: %+v", posts.bodies)
	}
	body := posts.bodies[0]
	if body.Date != "2026-03-11T02:00:00Z" || body.Type != "draft" || len(body.Posts) != 1 ||
		body.Posts[0].Integration.ID != li.ID || body.Posts[0].Settings.Type != "linkedin" ||
		body.Posts[0].Value[0].Content != "Line 1\n\nLine 2\n\nhttps://blog.example/new" {
		t.Fatalf("post body: %+v", body)
	}
	row, _ := s.repo.GetAutopost(ctx, created.ID)
	if row.LastURL != "https://blog.example/new" {
		t.Fatalf("lastUrl %s", row.LastURL)
	}

	// same item again: nothing new to post
	if err := s.StartAutopost(ctx, created.ID); err != nil || len(posts.bodies) != 1 {
		t.Fatalf("reposted: %v", err)
	}

	// update keeps the id; deactivated autoposts do nothing
	again, err := s.CreateAutopost(ctx, org.ID, dto.AutopostDto{
		Title: "feed2", URL: feedURL, OnSlot: &no, SyncLast: &no, Active: &no, AddPicture: &no, GenerateContent: &no,
	}, created.ID)
	if err != nil || again.ID != created.ID || again.Active {
		t.Fatal(again, err)
	}
	if n, _ := s.repo.GetTotal(ctx, org.ID); n != 1 {
		t.Fatalf("total %d", n)
	}
	if _, err := s.DeleteAutopost(ctx, org.ID, created.ID); err != nil {
		t.Fatal(err)
	}
	if list, _ := s.GetAutoposts(ctx, org.ID); len(list) != 0 {
		t.Fatal("deleted autopost listed")
	}
}
