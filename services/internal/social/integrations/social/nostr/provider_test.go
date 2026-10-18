package nostr

import (
	"context"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations"
	"github.com/coder/websocket"
)

const testKey = "0000000000000000000000000000000000000000000000000000000000000003"

// Vector from nostr-tools 2.23.3: getPublicKey / getEventHash.
func TestEventHashMatchesNostrTools(t *testing.T) {
	priv, err := secretKey(testKey)
	if err != nil {
		t.Fatal(err)
	}
	pk := publicKey(priv)
	if pk != "f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9" {
		t.Fatalf("pubkey %s", pk)
	}
	content := "hi \"<>&" + string(rune(0x2028)) + " é 👋\n\t" + string(rune(1)) + "\\"
	e := &Event{Kind: 1, Content: content, Tags: [][]string{{"e", "abc", "", "reply"}, {"p", pk}}, CreatedAt: 1700000000, PubKey: pk}
	hash := eventHash(e)
	if got := hex.EncodeToString(hash[:]); got != "76c7b5d4a51e379adf503df1d4bd6ea2e4223e99fd7f72535de6e44a00f415c9" {
		t.Fatalf("hash %s", got)
	}

	signed, err := finalizeEvent(priv, 1, content, e.Tags, 1700000000)
	if err != nil || !verifyEvent(signed) {
		t.Fatalf("signature does not verify: %v", err)
	}
	signed.Content += "x"
	if verifyEvent(signed) {
		t.Fatal("tampered event verified")
	}

	for _, bad := range []string{"abc", strings.Repeat("00", 32), strings.Repeat("ff", 32)} {
		if _, err := secretKey(bad); err == nil {
			t.Fatalf("key %q accepted", bad)
		}
	}
}

// fakeRelay behaves like a real relay: a REQ replays every stored event that
// matches, then EOSE; an EVENT is stored, sent to live subscriptions and
// answered with OK. A rejecting relay answers every EVENT with OK false.
func fakeRelay(t *testing.T, profile *Event, reject bool) (url string, published *[]*Event) {
	var mu sync.Mutex
	stored, notes := []*Event{}, []*Event{}
	if profile != nil {
		stored = append(stored, profile)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		defer conn.CloseNow()
		ctx := r.Context()
		subs := map[string]filter{}
		send := func(v ...any) {
			data, _ := json.Marshal(v)
			_ = conn.Write(ctx, websocket.MessageText, data)
		}
		for {
			_, data, err := conn.Read(ctx)
			if err != nil {
				return
			}
			var msg []json.RawMessage
			if json.Unmarshal(data, &msg) != nil {
				continue
			}
			switch messageType(msg) {
			case "REQ":
				var f filter
				_ = json.Unmarshal(msg[2], &f)
				sub := messageString(msg, 1)
				subs[sub] = f
				mu.Lock()
				for _, e := range stored {
					if f.matches(e) {
						send("EVENT", sub, e)
					}
				}
				mu.Unlock()
				send("EOSE", sub)
			case "EVENT":
				var e Event
				_ = json.Unmarshal(msg[1], &e)
				if reject {
					send("OK", e.ID, false, "blocked: not on whitelist")
					continue
				}
				if !verifyEvent(&e) {
					send("OK", e.ID, false, "invalid: bad signature")
					continue
				}
				mu.Lock()
				stored, notes = append(stored, &e), append(notes, &e)
				mu.Unlock()
				for sub, f := range subs {
					if f.matches(&e) {
						send("EVENT", sub, e)
					}
				}
				send("OK", e.ID, true, "")
			}
		}
	}))
	t.Cleanup(server.Close)
	return "ws" + strings.TrimPrefix(server.URL, "http"), &notes
}

func useRelays(t *testing.T, urls ...string) {
	old := relays
	relays = urls
	poolEoseTimeout, publishTimeout = 500*time.Millisecond, 500*time.Millisecond
	t.Cleanup(func() { relays = old })
}

func TestAuthenticatePostAndComment(t *testing.T) {
	t.Setenv("JWT_SECRET", "secret")
	priv, _ := secretKey(testKey)
	profile, _ := finalizeEvent(priv, 0, `{"name":"satoshi","display_name":"Satoshi","picture":"https://p/s.png"}`, [][]string{}, 1700000000)
	relayURL, published := fakeRelay(t, profile, false)
	useRelays(t, "ws://127.0.0.1:1", relayURL)

	code, _ := json.Marshal(map[string]string{"password": testKey})
	auth, err := New().Authenticate(context.Background(), integrations.AuthenticateParams{Code: base64.StdEncoding.EncodeToString(code)}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if auth.ID != publicKey(priv) || auth.Name != "Satoshi" || auth.Username != "satoshi" || auth.Picture != "https://p/s.png" || auth.AccessToken == "" {
		t.Fatalf("auth %+v", auth)
	}

	res, err := New().Post(context.Background(), auth.ID, auth.AccessToken, []integrations.PostDetails{{
		ID: "p", Message: "gm", Media: []integrations.MediaContent{{Path: "https://cdn/a.png"}, {Path: "https://cdn/b.png"}},
	}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(*published) != 1 {
		t.Fatalf("published %d events", len(*published))
	}
	note := (*published)[0]
	if note.Content != "gm\n\nhttps://cdn/a.png\n\nhttps://cdn/b.png" || res[0].PostID != note.ID || res[0].ReleaseURL != "https://primal.net/e/"+note.ID {
		t.Fatalf("post %+v note %+v", res[0], note)
	}

	// The relay already holds the first note and replays it to an author
	// subscription; the comment must still return its own event id.
	comment, err := New().Comment(context.Background(), auth.ID, note.ID, "", auth.AccessToken, []integrations.PostDetails{{ID: "c", Message: "reply"}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	reply := (*published)[1]
	tags, _ := json.Marshal(reply.Tags)
	if string(tags) != `[["e","`+note.ID+`","","reply"],["p","`+auth.ID+`"]]` {
		t.Fatalf("tags %s", tags)
	}
	if comment[0].PostID != reply.ID || comment[0].ReleaseURL != "https://primal.net/e/"+reply.ID {
		t.Fatalf("comment %+v, want reply %s (not older note %s)", comment[0], reply.ID, note.ID)
	}

	_, err = New().Authenticate(context.Background(), integrations.AuthenticateParams{Code: base64.StdEncoding.EncodeToString([]byte(`{"password":"zz"}`))}, nil)
	if msg, ok := err.(integrations.AuthMessage); !ok || msg != "Invalid credentials" {
		t.Fatalf("want Invalid credentials, got %v", err)
	}
}

func TestPublishNeedsARelayOK(t *testing.T) {
	t.Setenv("JWT_SECRET", "secret")
	priv, _ := secretKey(testKey)
	token := mustToken(t)
	rejectURL, _ := fakeRelay(t, nil, true)
	acceptURL, published := fakeRelay(t, nil, false)

	// A rejecting relay is skipped; the accepted event's own id is returned.
	useRelays(t, rejectURL, acceptURL)
	res, err := New().Post(context.Background(), publicKey(priv), token, []integrations.PostDetails{{ID: "p", Message: "gm"}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(*published) != 1 || res[0].PostID != (*published)[0].ID {
		t.Fatalf("post %+v published %d", res[0], len(*published))
	}

	// No relay accepts: the post fails instead of completing with an empty id.
	useRelays(t, "ws://127.0.0.1:1", rejectURL)
	_, err = New().Post(context.Background(), publicKey(priv), token, []integrations.PostDetails{{ID: "p", Message: "gm"}}, nil)
	if err == nil || !strings.Contains(err.Error(), "blocked: not on whitelist") {
		t.Fatalf("want relay rejection, got %v", err)
	}
}

func mustToken(t *testing.T) string {
	t.Helper()
	code, _ := json.Marshal(map[string]string{"password": testKey})
	useRelays(t)
	auth, err := New().Authenticate(context.Background(), integrations.AuthenticateParams{Code: base64.StdEncoding.EncodeToString(code)}, nil)
	if err != nil {
		t.Fatal(err)
	}
	return auth.AccessToken
}
