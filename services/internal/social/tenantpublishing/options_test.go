package tenantpublishing

import (
	"encoding/json"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/postoptions"
)

func decode(t *testing.T, raw json.RawMessage) map[string]any {
	t.Helper()
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatal(err)
	}
	return out
}

func TestPostSettingsMapEachPlatformsFields(t *testing.T) {
	base := map[string]any{"custom": "kept"}
	x, err := postSettings("x", base, &postoptions.PublishOptions{ReplySettings: "following", MadeWithAI: true,
		CommunityID: "1493446837214187523", QuoteRemoteID: "42"}, "")
	if err != nil {
		t.Fatal(err)
	}
	got := decode(t, x)
	if got["who_can_reply_post"] != "following" || got["made_with_ai"] != true || got["paid_partnership"] != nil ||
		got["community"] != "https://x.com/i/communities/1493446837214187523" || got["share_with_followers"] != false ||
		got["quote_tweet_id"] != "42" || got["custom"] != "kept" {
		t.Fatalf("x settings: %v", got)
	}
	if _, ok := base["who_can_reply_post"]; ok {
		t.Fatal("the connection's settings were changed")
	}
	plain := decode(t, must(postSettings("x", nil, nil, "")))
	if plain["who_can_reply_post"] != "everyone" || len(plain) != 1 {
		t.Fatalf("an X post without options lets everyone reply: %v", plain)
	}
	linkedin := decode(t, must(postSettings("linkedin", nil, &postoptions.PublishOptions{Visibility: "CONNECTIONS",
		DocumentTitle: "Deck", QuoteRemoteID: "urn:li:share:1", ReplySettings: "verified"}, "")))
	if linkedin["visibility"] != "CONNECTIONS" || linkedin["document_title"] != "Deck" || linkedin["reshare_parent"] != "urn:li:share:1" ||
		linkedin["who_can_reply_post"] != nil {
		t.Fatalf("linkedin settings: %v", linkedin)
	}
}

func TestAFinisherQuotesTheFirstPostOnlyOnceItIsLive(t *testing.T) {
	finisher := &postoptions.PublishOptions{QuoteFirstPost: true}
	before := decode(t, must(postSettings("x", nil, finisher, "")))
	if _, ok := before["quote_tweet_id"]; ok {
		t.Fatalf("a quote of a post that does not exist yet: %v", before)
	}
	after := decode(t, must(postSettings("x", nil, finisher, "1800")))
	if after["quote_tweet_id"] != "1800" {
		t.Fatalf("the finisher does not quote the live first post: %v", after)
	}
}

func TestArticleSettings(t *testing.T) {
	article := decode(t, must(postSettings("x", nil, &postoptions.PublishOptions{ArticleTitle: "Why"}, "")))
	if article["post_type"] != "article" || article["article_title"] != "Why" || article["article_status"] != "published" {
		t.Fatalf("article: %v", article)
	}
}

func TestPremiumReadsTheVerifiedSetting(t *testing.T) {
	for raw, want := range map[string]bool{
		`[{"title":"Verified","value":true}]`:   true,
		`[{"title":"Verified","value":false}]`:  false,
		`[{"title":"Verified","value":"true"}]`: false,
		`[{"title":"Something","value":true}]`:  false,
		`not json`:                              false,
	} {
		value := raw
		if got := premium(&value); got != want {
			t.Errorf("%s: %v", raw, got)
		}
	}
	if premium(nil) {
		t.Error("no settings is Premium")
	}
}

func must(raw json.RawMessage, err error) json.RawMessage {
	if err != nil {
		panic(err)
	}
	return raw
}
