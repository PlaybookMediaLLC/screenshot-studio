package auth

import (
	"context"
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"io"
	"math/big"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/httpx"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/redis"
)

func override(t *testing.T, target *string, value string) {
	old := *target
	*target = value
	t.Cleanup(func() { *target = old })
}

func TestGithubProvider(t *testing.T) {
	t.Setenv("GITHUB_CLIENT_ID", "cid")
	t.Setenv("GITHUB_CLIENT_SECRET", "secret")
	t.Setenv("FRONTEND_URL", "https://app.sample.com")
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/login/oauth/access_token":
			var body map[string]string
			_ = json.NewDecoder(r.Body).Decode(&body)
			if body["code"] != "c1" || body["client_secret"] != "secret" || body["redirect_uri"] != "https://app.sample.com/settings" || r.Header.Get("Accept") != "application/json" {
				t.Errorf("token body %v", body)
			}
			_, _ = io.WriteString(w, `{"access_token":"gho"}`)
		case "/user":
			if r.Header.Get("Authorization") != "token gho" {
				t.Errorf("auth %q", r.Header.Get("Authorization"))
			}
			_, _ = io.WriteString(w, `{"id":12345}`)
		case "/user/emails":
			_, _ = io.WriteString(w, `[{"email":"me@gh.com"},{"email":"other@gh.com"}]`)
		}
	}))
	defer srv.Close()
	override(t, &githubURL, srv.URL)
	override(t, &githubAPIURL, srv.URL)

	p := githubProvider{}
	link, _ := p.GenerateLink(context.Background(), map[string]string{})
	if link != srv.URL+"/login/oauth/authorize?client_id=cid&scope=user:email&state=login&redirect_uri=https%3A%2F%2Fapp.sample.com%2Fsettings" {
		t.Fatal(link)
	}
	token, err := p.GetToken(context.Background(), "c1", "")
	if err != nil || token != "gho" {
		t.Fatal(token, err)
	}
	u, err := p.GetUser(context.Background(), token)
	if err != nil || *u != (ProviderUser{Email: "me@gh.com", ID: "12345"}) {
		t.Fatal(u, err)
	}
}

func TestGoogleProvider(t *testing.T) {
	t.Setenv("YOUTUBE_CLIENT_ID", "gid")
	t.Setenv("YOUTUBE_CLIENT_SECRET", "gsecret")
	t.Setenv("FRONTEND_URL", "https://app.sample.com")
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/token":
			_ = r.ParseForm()
			switch r.Form.Get("code") {
			case "expired":
				w.WriteHeader(400)
				_, _ = io.WriteString(w, `{"error":"invalid_grant"}`)
			case "broken":
				w.WriteHeader(401)
				_, _ = io.WriteString(w, `{"error":"invalid_client"}`)
			default:
				if r.Form.Get("redirect_uri") != "https://app.sample.com/integrations/social/youtube" || r.Form.Get("client_secret") != "gsecret" {
					t.Errorf("form %v", r.Form)
				}
				_, _ = io.WriteString(w, `{"access_token":"ya29"}`)
			}
		case "/userinfo":
			if r.Header.Get("Authorization") != "Bearer ya29" {
				w.WriteHeader(401)
				return
			}
			_, _ = io.WriteString(w, `{"id":"g1","email":"me@gmail.com"}`)
		}
	}))
	defer srv.Close()
	override(t, &googleTokenURL, srv.URL+"/token")
	override(t, &googleUserInfoURL, srv.URL+"/userinfo")

	p := googleProvider{}
	link, _ := p.GenerateLink(context.Background(), map[string]string{"state": "s1"})
	if link != "https://accounts.google.com/o/oauth2/v2/auth?access_type=online&prompt=consent&state=s1&redirect_uri=https%3A%2F%2Fapp.sample.com%2Fintegrations%2Fsocial%2Fyoutube&scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fuserinfo.profile%20https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fuserinfo.email&response_type=code&client_id=gid" {
		t.Fatal(link)
	}
	token, err := p.GetToken(context.Background(), "ok", "")
	if err != nil || token != "ya29" {
		t.Fatal(token, err)
	}
	u, err := p.GetUser(context.Background(), token)
	if err != nil || *u != (ProviderUser{ID: "g1", Email: "me@gmail.com"}) {
		t.Fatal(u, err)
	}

	_, err = p.GetToken(context.Background(), "expired", "")
	var httpErr *httpx.Error
	if !errors.As(err, &httpErr) || httpErr.Status != 400 || httpErr.Message() != "Google sign-in expired, please sign in again" {
		t.Fatal(err)
	}
	if _, err = p.GetToken(context.Background(), "broken", ""); err == nil || errors.As(err, &httpErr) {
		t.Fatal(err)
	}
}

func TestGenericOAuthProvider(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/token":
			_ = r.ParseForm()
			if r.Form.Get("code") == "bad" {
				w.WriteHeader(400)
				_, _ = io.WriteString(w, "nope")
				return
			}
			_, _ = io.WriteString(w, `{"access_token":"at"}`)
		case "/userinfo":
			if r.Header.Get("Authorization") != "Bearer at" {
				w.WriteHeader(401)
				_, _ = io.WriteString(w, "denied")
				return
			}
			_, _ = io.WriteString(w, `{"sub":"s1","email":"me@idp.com"}`)
		}
	}))
	defer srv.Close()

	p := oauthProvider{}
	if _, err := p.GenerateLink(context.Background(), nil); err == nil || err.Error() != "SOCIAL_OAUTH environment variables are not set" {
		t.Fatal(err)
	}
	t.Setenv("SOCIAL_OAUTH_AUTH_URL", srv.URL+"/authorize")
	t.Setenv("SOCIAL_OAUTH_CLIENT_ID", "cid")
	t.Setenv("SOCIAL_OAUTH_CLIENT_SECRET", "cs")
	t.Setenv("SOCIAL_OAUTH_TOKEN_URL", srv.URL+"/token")
	t.Setenv("SOCIAL_OAUTH_USERINFO_URL", srv.URL+"/userinfo")
	t.Setenv("FRONTEND_URL", "https://app.sample.com")

	link, _ := p.GenerateLink(context.Background(), map[string]string{"state": "st"})
	if link != srv.URL+"/authorize?client_id=cid&scope=openid+profile+email&response_type=code&state=st&redirect_uri=https%3A%2F%2Fapp.sample.com%2Fsettings" {
		t.Fatal(link)
	}
	if _, err := p.GetToken(context.Background(), "bad", ""); err == nil || err.Error() != "Token request failed: nope" {
		t.Fatal(err)
	}
	token, _ := p.GetToken(context.Background(), "good", "")
	u, err := p.GetUser(context.Background(), token)
	if err != nil || *u != (ProviderUser{ID: "s1", Email: "me@idp.com"}) {
		t.Fatal(u, err)
	}
	if _, err := p.GetUser(context.Background(), "x"); err == nil || err.Error() != "User info request failed: denied" {
		t.Fatal(err)
	}
}

func TestAppleProvider(t *testing.T) {
	ecKey, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	der, _ := x509.MarshalPKCS8PrivateKey(ecKey)
	pemKey := strings.ReplaceAll(string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der})), "\n", `\n`)
	t.Setenv("APPLE_CLIENT_ID", "com.shots.web")
	t.Setenv("APPLE_TEAM_ID", "TEAM")
	t.Setenv("APPLE_KEY_ID", "KEY")
	t.Setenv("APPLE_PRIVATE_KEY", pemKey)
	t.Setenv("APPLE_APP_BUNDLE_ID", "com.shots.app")
	t.Setenv("NEXT_PUBLIC_BACKEND_URL", "https://api.sample.com")

	rsaKey, _ := rsa.GenerateKey(rand.Reader, 2048)
	idToken := func(aud string) string {
		tok := jwt.NewWithClaims(jwt.SigningMethodRS256, jwt.MapClaims{
			"iss": appleIssuer, "aud": aud, "sub": "apple-1", "email": "me@icloud.com", "exp": time.Now().Add(time.Hour).Unix(),
		})
		tok.Header["kid"] = "k1"
		s, _ := tok.SignedString(rsaKey)
		return s
	}

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/auth/keys":
			_ = json.NewEncoder(w).Encode(map[string]any{"keys": []map[string]string{{
				"kid": "k1", "kty": "RSA", "alg": "RS256",
				"n": base64.RawURLEncoding.EncodeToString(rsaKey.N.Bytes()),
				"e": base64.RawURLEncoding.EncodeToString(big.NewInt(int64(rsaKey.E)).Bytes()),
			}}})
		case "/auth/token":
			_ = r.ParseForm()
			secret, err := jwt.Parse(r.Form.Get("client_secret"), func(*jwt.Token) (any, error) { return &ecKey.PublicKey, nil },
				jwt.WithValidMethods([]string{"ES256"}), jwt.WithAudience("https://appleid.apple.com"), jwt.WithIssuer("TEAM"))
			if err != nil || secret.Header["kid"] != "KEY" || r.Form.Get("redirect_uri") != "https://api.sample.com/auth/oauth/apple/redirect" {
				w.WriteHeader(400)
				_, _ = io.WriteString(w, `{"error":"invalid_client"}`)
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]string{"id_token": idToken("com.shots.web")})
		}
	}))
	defer srv.Close()
	override(t, &appleURL, srv.URL)

	p := appleProvider{}
	link, _ := p.GenerateLink(context.Background(), map[string]string{"state": "s"})
	parsed, _ := url.Parse(link)
	if q := parsed.Query(); q.Get("response_mode") != "form_post" || q.Get("scope") != "name email" || q.Get("client_id") != "com.shots.web" {
		t.Fatal(link)
	}

	token, err := p.GetToken(context.Background(), "auth-code", "")
	if err != nil {
		t.Fatal(err)
	}
	u, err := p.GetUser(context.Background(), token)
	if err != nil || *u != (ProviderUser{ID: "apple-1", Email: "me@icloud.com"}) {
		t.Fatal(u, err)
	}

	// native iOS sends the id_token itself, with the bundle id as audience
	native := idToken("com.shots.app")
	if got, _ := p.GetToken(context.Background(), native, ""); got != native {
		t.Fatal("native id_token must pass through")
	}
	if _, err := p.GetUser(context.Background(), native); err != nil {
		t.Fatal(err)
	}
	if _, err := p.GetUser(context.Background(), idToken("someone.else")); err == nil {
		t.Fatal("wrong audience accepted")
	}
	if _, err := p.GetUser(context.Background(), "not-a-jwt"); err == nil || err.Error() != "Invalid provider token" {
		t.Fatal(err)
	}
}

func TestFarcasterProvider(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v2/farcaster/signer" || r.Header.Get("x-api-key") == "" {
			w.WriteHeader(404)
			return
		}
		status := "pending_approval"
		if r.URL.Query().Get("signer_uuid") == "ok" {
			status = "approved"
		}
		_, _ = io.WriteString(w, `{"status":"`+status+`","fid":4242}`)
	}))
	defer srv.Close()
	override(t, &neynarURL, srv.URL)

	p := farcasterProvider{}
	code := base64.StdEncoding.EncodeToString([]byte(`{"signer_uuid":"ok"}`))
	token, err := p.GetToken(context.Background(), code, "")
	if err != nil || token != "ok" {
		t.Fatal(token, err)
	}
	u, _ := p.GetUser(context.Background(), token)
	if *u != (ProviderUser{ID: "farcaster_4242", Email: "farcaster_4242"}) {
		t.Fatal(u)
	}
	pending := base64.StdEncoding.EncodeToString([]byte(`{"signer_uuid":"wait"}`))
	if token, _ := p.GetToken(context.Background(), pending, ""); token != "" {
		t.Fatal(token)
	}
	if u, _ := p.GetUser(context.Background(), "wait"); *u != (ProviderUser{}) {
		t.Fatal(u)
	}
}

func base58Encode(b []byte) string {
	n := new(big.Int).SetBytes(b)
	var out []byte
	mod := new(big.Int)
	for n.Sign() > 0 {
		n.DivMod(n, big.NewInt(58), mod)
		out = append([]byte{base58Alphabet[mod.Int64()]}, out...)
	}
	for _, c := range b {
		if c != 0 {
			break
		}
		out = append([]byte{'1'}, out...)
	}
	return string(out)
}

func TestBase58AndHex(t *testing.T) {
	for in, want := range map[string]string{"": "", "1": "00", "11": "0000", "2g": "61", "1112": "00000001", "StV1DL6CwTryKyV": "68656c6c6f20776f726c64"} {
		got, err := base58Decode(in)
		if err != nil || hex.EncodeToString(got) != want {
			t.Fatalf("%q: %x %v", in, got, err)
		}
	}
	if _, err := base58Decode("0OIl"); err == nil || err.Error() != "Non-base58 character" {
		t.Fatal(err)
	}
	if got, _ := hexToBytes("0xff0g1z"); hex.EncodeToString(got) != "ff0001" {
		t.Fatalf("%x", got)
	}
	if _, err := hexToBytes("abc"); err == nil {
		t.Fatal("odd hex accepted")
	}
}

func TestWalletProvider(t *testing.T) {
	store := redis.NewMemory()
	p := walletProvider{store: store}
	pub, priv, _ := ed25519.GenerateKey(rand.Reader)
	pk := base58Encode(pub)
	ctx := context.Background()

	if link, _ := p.GenerateLink(ctx, map[string]string{}); link != "" {
		t.Fatal("no publicKey must give no challenge")
	}
	challenge, err := p.GenerateLink(ctx, map[string]string{"publicKey": pk})
	if err != nil || len(challenge) != 64 {
		t.Fatal(challenge, err)
	}
	code := func(sig []byte, ch string) string {
		data, _ := json.Marshal(map[string]string{"publicKey": pk, "challenge": ch, "signature": hex.EncodeToString(sig)})
		return base64.StdEncoding.EncodeToString(data)
	}

	good := code(ed25519.Sign(priv, []byte(challenge)), challenge)
	if token, err := p.GetToken(ctx, good, ""); err != nil || token != good {
		t.Fatal(token, err)
	}
	u, err := p.GetUser(ctx, good)
	if err != nil || *u != (ProviderUser{ID: "wallet_" + pk, Email: "wallet_" + pk}) {
		t.Fatal(u, err)
	}

	forged := code(ed25519.Sign(priv, []byte("other")), challenge)
	if token, _ := p.GetToken(ctx, forged, ""); token != "" {
		t.Fatal("forged signature accepted")
	}
	if u, _ := p.GetUser(ctx, forged); *u != (ProviderUser{}) {
		t.Fatal(u)
	}
	stale := code(ed25519.Sign(priv, []byte("stale")), "stale")
	if token, _ := p.GetToken(ctx, stale, ""); token != "" {
		t.Fatal("unknown challenge accepted")
	}
	short := code([]byte{1, 2, 3}, challenge)
	if _, err := p.GetToken(ctx, short, ""); err == nil || err.Error() != "bad signature size" {
		t.Fatal(err)
	}
}
