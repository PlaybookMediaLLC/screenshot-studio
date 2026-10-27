package farcaster

import (
	"context"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations"
)

const testMnemonic = "test test test test test test test test test test test junk"

func TestMnemonicAndTypedDataMatchViem(t *testing.T) {
	priv, err := mnemonicToKey(testMnemonic)
	if err != nil {
		t.Fatal(err)
	}
	pub := priv.PubKey().SerializeUncompressed()
	address := "0x" + hex.EncodeToString(keccak(pub[1:])[12:])
	if address != strings.ToLower("0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266") {
		t.Fatalf("address %s", address)
	}
	key, _ := hex.DecodeString(strings.Repeat("ab", 32))
	// viem: mnemonicToAccount(testMnemonic).signTypedData({ ...SignedKeyRequest,
	// message: { requestFid: 12345n, key: 0xabab.., deadline: 1700000000n } })
	want := "0xd6cc25cb44c55f7c7463a3f67170dd75674aa507a1acbadb7c9b088f27a03f687fd58eb7cbad4725de5df2affa7e96e39d32f55d49a1d8cce6f141912c2044e41b"
	if got := signTypedData(priv, 12345, key, 1700000000); got != want {
		t.Fatalf("signature\n got %s\nwant %s", got, want)
	}
	if _, err := mnemonicToKey("too short"); err == nil {
		t.Fatal("want invalid mnemonic")
	}
}

type fakeNeynar struct {
	*httptest.Server
	mu     sync.Mutex
	bodies map[string][]map[string]any
}

func newFakeNeynar(t *testing.T) *fakeNeynar {
	t.Helper()
	t.Setenv("NEYNAR_SECRET_KEY", "key")
	f := &fakeNeynar{bodies: map[string][]map[string]any{}}
	f.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		if r.Header.Get("x-api-key") != "key" {
			w.WriteHeader(401)
			return
		}
		body, _ := io.ReadAll(r.Body)
		var in map[string]any
		_ = json.Unmarshal(body, &in)
		f.bodies[r.URL.Path] = append(f.bodies[r.URL.Path], in)
		switch r.Method + " " + r.URL.Path {
		case "POST /v2/farcaster/signer/":
			_, _ = w.Write([]byte(`{"signer_uuid":"u1","public_key":"0x` + strings.Repeat("ab", 32) + `","status":"generated"}`))
		case "POST /v2/farcaster/signer/signed_key/":
			_, _ = w.Write([]byte(`{"signer_uuid":"u1","signer_approval_url":"https://client.warpcast.com/deeplinks/signed-key-request?token=0x1","status":"pending_approval"}`))
		case "GET /v2/farcaster/signer/":
			if r.URL.Query().Get("signer_uuid") == "pending" {
				_, _ = w.Write([]byte(`{"status":"pending_approval"}`))
				return
			}
			_, _ = w.Write([]byte(`{"status":"approved","fid":99}`))
		case "GET /v2/farcaster/user/bulk/":
			if r.URL.Query().Get("fids") != "99" {
				w.WriteHeader(400)
				return
			}
			_, _ = w.Write([]byte(`{"users":[{"username":"alice","display_name":"Alice","pfp_url":"https://p/a.png"}]}`))
		case "POST /v2/farcaster/cast/":
			if in["text"] == "fail" {
				w.WriteHeader(500)
				return
			}
			hash := "0xh" + itoa(len(f.bodies[r.URL.Path]))
			_, _ = w.Write([]byte(`{"success":true,"cast":{"hash":"` + hash + `","author":{"username":"alice"}}}`))
		case "GET /v2/farcaster/channel/search/":
			_, _ = w.Write([]byte(`{"channels":[{"id":"golang","name":"Go"}]}`))
		default:
			w.WriteHeader(404)
		}
	}))
	t.Cleanup(f.Close)
	neynarURL = f.URL
	return f
}

func itoa(n int) string { b, _ := json.Marshal(n); return string(b) }

func TestSignerFlowAndAuthenticate(t *testing.T) {
	f := newFakeNeynar(t)
	p := New()
	ctx := context.Background()

	t.Setenv("NEYNAR_APP_FID", "")
	if _, err := p.CreateSigner(ctx); err == nil || err.Error() != "Farcaster is not configured: set NEYNAR_APP_FID and NEYNAR_APP_MNEMONIC" {
		t.Fatalf("want not configured, got %v", err)
	}
	t.Setenv("NEYNAR_APP_FID", "12345")
	t.Setenv("NEYNAR_APP_MNEMONIC", testMnemonic)
	t.Setenv("NEYNAR_SPONSOR_SIGNERS", "true")
	signer, err := p.CreateSigner(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if signer.SignerUUID != "u1" || !strings.HasPrefix(signer.QRCode, "data:image/png;base64,iVBORw0KGgo") || !strings.Contains(signer.ApprovalURL, "signed-key-request") {
		t.Fatalf("signer %+v", signer)
	}
	registered := f.bodies["/v2/farcaster/signer/signed_key/"][0]
	sig, _ := registered["signature"].(string)
	if registered["signer_uuid"] != "u1" || registered["app_fid"] != 12345.0 || len(sig) != 132 ||
		!reflect.DeepEqual(registered["sponsor"], map[string]any{"sponsored_by_neynar": true}) {
		t.Fatalf("register body %v", registered)
	}

	status, err := p.SignerStatus(ctx, "pending")
	if err != nil || status.Status != "pending_approval" || status.Code != "" {
		t.Fatalf("pending: %v %+v", err, status)
	}
	status, err = p.SignerStatus(ctx, "u1")
	if err != nil || status.Status != "approved" {
		t.Fatalf("approved: %v %+v", err, status)
	}
	auth, err := p.Authenticate(ctx, integrations.AuthenticateParams{Code: status.Code}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if auth.ID != "99" || auth.Name != "Alice" || auth.AccessToken != "u1" || auth.Username != "alice" || auth.Picture != "https://p/a.png" {
		t.Fatalf("auth %+v", auth)
	}
	decoded, _ := base64.StdEncoding.DecodeString(status.Code)
	if string(decoded) != `{"signer_uuid":"u1","fid":99,"username":"alice","display_name":"Alice","pfp_url":"https://p/a.png"}` {
		t.Fatalf("code %s", decoded)
	}
}

func TestPostAndComment(t *testing.T) {
	f := newFakeNeynar(t)
	p := New()
	ctx := context.Background()
	res, err := p.Post(ctx, "", "signer", []integrations.PostDetails{{
		ID: "p", Message: "gm", Settings: json.RawMessage(`{"subreddit":[{"value":{"id":"golang"}},{"value":{"id":"base"}}]}`),
		Media: []integrations.MediaContent{{Path: "https://cdn/a.png"}},
	}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if res[0].PostID != "0xh1,0xh2" || res[0].ReleaseURL != "https://warpcast.com/alice/0xh1,https://warpcast.com/alice/0xh2" || res[0].Status != "published" {
		t.Fatalf("post %+v", res[0])
	}
	first := f.bodies["/v2/farcaster/cast/"][0]
	if first["channel_id"] != "golang" || first["signer_uuid"] != "signer" || !reflect.DeepEqual(first["embeds"], []any{map[string]any{"url": "https://cdn/a.png"}}) {
		t.Fatalf("cast body %v", first)
	}

	res, err = p.Comment(ctx, "", "0xh1,0xh2", "", "signer", []integrations.PostDetails{{ID: "c", Message: "reply"}}, nil)
	if err != nil || res[0].PostID != "0xh3,0xh4" {
		t.Fatalf("comment %v %+v", err, res)
	}
	if parent := f.bodies["/v2/farcaster/cast/"][3]["parent"]; parent != "0xh2" {
		t.Fatalf("parent %v", parent)
	}

	_, err = p.Post(ctx, "", "signer", []integrations.PostDetails{{ID: "p", Message: "fail"}}, nil)
	if err == nil || err.Error() != "Request failed with status code 500" {
		t.Fatalf("want axios-style error, got %v", err)
	}
	if _, ok := f.bodies["/v2/farcaster/cast/"][4]["channel_id"]; ok {
		t.Fatal("no channel: channel_id must be omitted")
	}

	channels, err := p.Subreddits(ctx, json.RawMessage(`{"word":"go"}`))
	if err != nil || !reflect.DeepEqual(channels, []Channel{{Title: "Go", Name: "Go", ID: "golang"}}) {
		t.Fatalf("channels %v %+v", err, channels)
	}
}

func TestValidityAndDTO(t *testing.T) {
	msg, _ := New().CheckValidity(context.Background(), [][]integrations.ValidityMedia{{{Path: "a.png"}, {Path: "b.mp4"}}}, nil, nil)
	if msg != "Can only accept images" {
		t.Fatalf("got %q", msg)
	}
	var dto FarcasterDTO
	_ = json.Unmarshal([]byte(`{"subreddit":[{"value":{}},{"value":{"id":"x"}},{}]}`), &dto)
	if got := dto.Validate(); !reflect.DeepEqual(got, []string{"id must be a string"}) {
		t.Fatalf("got %v", got)
	}
}

func TestGenerateAuthURL(t *testing.T) {
	t.Setenv("NEYNAR_CLIENT_ID", "client-1")
	got, err := New().GenerateAuthURL(context.Background(), nil)
	if err != nil || got.URL != "client-1||"+got.State || got.State == "" || got.CodeVerifier == "" {
		t.Fatalf("got %+v, %v", got, err)
	}

	// Unset: a clear error, never "undefined||<state>".
	t.Setenv("NEYNAR_CLIENT_ID", "")
	if got, err := New().GenerateAuthURL(context.Background(), nil); err == nil || err.Error() != "NEYNAR_CLIENT_ID is not set" {
		t.Fatalf("unset: got %+v, %v", got, err)
	}
}
