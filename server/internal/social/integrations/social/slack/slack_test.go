package slack

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations"
	"go.temporal.io/sdk/temporal"
	"strings"
	"testing"
)

var _ integrations.Provider = (*Provider)(nil)
var _ integrations.Commenter = (*Provider)(nil)

type lifecycleFunc func(context.Context, string, string, string, map[string]any) (map[string]json.RawMessage, error)

func (f lifecycleFunc) SocialSlackCall(ctx context.Context, org, id, method string, payload map[string]any) (map[string]json.RawMessage, error) {
	return f(ctx, org, id, method, payload)
}
func raw(value string) map[string]json.RawMessage {
	var out map[string]json.RawMessage
	_ = json.Unmarshal([]byte(value), &out)
	return out
}
func TestPublishingUsesManagedIdentityAndAccessibleSafeText(t *testing.T) {
	calls := 0
	p := New(lifecycleFunc(func(_ context.Context, org, id, method string, payload map[string]any) (map[string]json.RawMessage, error) {
		if org != "org" || id != "integration" {
			t.Fatal("tenant identity lost")
		}
		calls++
		if method == "chat.getPermalink" {
			return nil, errors.New("permalink unavailable")
		}
		if payload["text"] != "hello &lt;!channel&gt;" || payload["unfurl_links"] != false || payload["unfurl_media"] != false || payload["link_names"] != false {
			t.Fatalf("unsafe fallback: %+v", payload)
		}
		if payload["username"] != "Bot" {
			t.Fatal("publishing profile lost")
		}
		return raw(`{"ok":true,"ts":"1.2","channel":"C1"}`), nil
	}))
	result, err := p.Post(context.Background(), "team", "ignored-legacy-token", []integrations.PostDetails{{ID: "post", Message: "hello <!channel>", Settings: json.RawMessage(`{"channel":"C1"}`)}}, &ent.Integration{ID: "integration", OrganizationID: "org", Name: "Bot"})
	if err != nil || len(result) != 1 || result[0].PostID != "1.2" || result[0].Status != "posted" || calls != 2 {
		t.Fatalf("result=%+v err=%v calls=%d", result, err, calls)
	}
}
func TestChannelsFollowEmptyPagesAndRejectLoops(t *testing.T) {
	count := 0
	loop := false
	p := New(lifecycleFunc(func(_ context.Context, _, _, _ string, payload map[string]any) (map[string]json.RawMessage, error) {
		count++
		if count == 1 || loop {
			return raw(`{"channels":[],"response_metadata":{"next_cursor":"next"}}`), nil
		}
		if payload["cursor"] != "next" {
			t.Fatal("cursor lost")
		}
		return raw(`{"channels":[{"id":"C1","name":"launch"}],"response_metadata":{"next_cursor":""}}`), nil
	}))
	result, err := p.channels(context.Background(), &ent.Integration{ID: "i"})
	if err != nil || len(result) != 1 || count != 2 {
		t.Fatalf("%+v %v", result, err)
	}
	loop = true
	if _, err = p.channels(context.Background(), &ent.Integration{ID: "i"}); err == nil {
		t.Fatal("cursor loop accepted")
	}
}
func TestProviderFailsClosedWithoutLifecycleAndOAuthUsesPlatformSession(t *testing.T) {
	p := New()
	if _, err := p.Post(context.Background(), "", "legacy-token", []integrations.PostDetails{{Settings: json.RawMessage(`{"channel":"C1"}`)}}, &ent.Integration{}); err == nil {
		t.Fatal("unmanaged send accepted")
	}
	t.Setenv("BETTER_AUTH_URL", "https://studio.example")
	result, err := p.GenerateAuthURL(context.Background(), nil)
	if err != nil || !strings.Contains(result.URL, "/api/integrations/slack/connect?purpose=publishing") || result.State != "" {
		t.Fatalf("%+v %v", result, err)
	}
	if _, err = p.Authenticate(context.Background(), integrations.AuthenticateParams{Code: "code"}, nil); err == nil {
		t.Fatal("legacy code exchange accepted")
	}
}
func TestMalformedReceiptAndVideoValidation(t *testing.T) {
	p := New(lifecycleFunc(func(context.Context, string, string, string, map[string]any) (map[string]json.RawMessage, error) {
		return raw(`{"ok":true}`), nil
	}))
	_, err := p.Post(context.Background(), "", "", []integrations.PostDetails{{Settings: json.RawMessage(`{"channel":"C1"}`)}}, &ent.Integration{})
	var uncertain *temporal.ApplicationError
	if !errors.As(err, &uncertain) || !uncertain.NonRetryable() || uncertain.Type() != "slack_uncertain" {
		t.Fatalf("ambiguous send is retryable: %v", err)
	}
	msg, _ := p.CheckValidity(context.Background(), [][]integrations.ValidityMedia{{{Path: "video.mp4"}}}, nil, nil)
	if msg == "" {
		t.Fatal("video accepted")
	}
}
