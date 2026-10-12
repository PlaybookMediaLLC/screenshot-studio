package auth

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/httpx"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/redis"
)

// ProviderUser is getUser's { email, id }.
type ProviderUser struct {
	Email string
	ID    string
}

// Provider is AuthProviderAbstract. postRegistration is a no-op on every
// Postiz provider, so it is not part of the port.
type Provider interface {
	GenerateLink(ctx context.Context, query map[string]string) (string, error)
	GetToken(ctx context.Context, code, redirectURI string) (string, error)
	GetUser(ctx context.Context, providerToken string) (*ProviderUser, error)
}

// AuthProviderManager resolves the login provider by Prisma Provider name.
type AuthProviderManager struct {
	providers map[string]Provider
}

func NewAuthProviderManager(store redis.Store) *AuthProviderManager {
	return &AuthProviderManager{providers: map[string]Provider{
		"GITHUB":    githubProvider{},
		"GOOGLE":    googleProvider{},
		"APPLE":     appleProvider{},
		"FARCASTER": farcasterProvider{},
		"WALLET":    walletProvider{store: store},
		"GENERIC":   oauthProvider{},
	}}
}

func (m *AuthProviderManager) GetProvider(provider string) (Provider, error) {
	p, ok := m.providers[provider]
	if !ok {
		return nil, fmt.Errorf("Auth provider %s not found", provider)
	}
	return p, nil
}

// Endpoints, overridden in tests.
var (
	githubURL         = "https://github.com"
	githubAPIURL      = "https://api.github.com"
	googleAuthURL     = "https://accounts.google.com/o/oauth2/v2/auth"
	googleTokenURL    = "https://oauth2.googleapis.com/token"
	googleUserInfoURL = "https://www.googleapis.com/oauth2/v2/userinfo"
	appleURL          = "https://appleid.apple.com"
	neynarURL         = "https://api.neynar.com"
)

const appleIssuer = "https://appleid.apple.com"

// fetch sends a request and returns the status and body (fetch never fails
// on HTTP errors).
func fetch(ctx context.Context, method, target string, headers map[string]string, body []byte) (int, []byte, error) {
	var reader io.Reader
	if body != nil {
		reader = bytes.NewReader(body)
	}
	req, err := http.NewRequestWithContext(ctx, method, target, reader)
	if err != nil {
		return 0, nil, err
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer res.Body.Close()
	data, err := io.ReadAll(res.Body)
	return res.StatusCode, data, err
}

// query renders ordered key/value pairs; spaces become %20 when plus is false
// (Node querystring) and + otherwise (URLSearchParams).
func query(plus bool, pairs ...string) string {
	parts := make([]string, 0, len(pairs)/2)
	for i := 0; i+1 < len(pairs); i += 2 {
		value := url.QueryEscape(pairs[i+1])
		if !plus {
			value = strings.ReplaceAll(value, "+", "%20")
		}
		parts = append(parts, url.QueryEscape(pairs[i])+"="+value)
	}
	return strings.Join(parts, "&")
}

func or(value, fallback string) string {
	if value != "" {
		return value
	}
	return fallback
}

// ---- GitHub ----

type githubProvider struct{}

func (githubProvider) GenerateLink(_ context.Context, q map[string]string) (string, error) {
	return githubURL + "/login/oauth/authorize?client_id=" + os.Getenv("GITHUB_CLIENT_ID") +
		"&scope=user:email&state=" + or(q["state"], "login") +
		"&redirect_uri=" + url.QueryEscape(os.Getenv("FRONTEND_URL")+"/settings"), nil
}

func (githubProvider) GetToken(ctx context.Context, code, _ string) (string, error) {
	body, _ := json.Marshal(map[string]string{
		"client_id":     os.Getenv("GITHUB_CLIENT_ID"),
		"client_secret": os.Getenv("GITHUB_CLIENT_SECRET"),
		"code":          code,
		"redirect_uri":  os.Getenv("FRONTEND_URL") + "/settings",
	})
	_, data, err := fetch(ctx, http.MethodPost, githubURL+"/login/oauth/access_token", map[string]string{
		"Content-Type": "application/json",
		"Accept":       "application/json",
	}, body)
	if err != nil {
		return "", err
	}
	var res struct {
		AccessToken string `json:"access_token"`
	}
	if err := json.Unmarshal(data, &res); err != nil {
		return "", err
	}
	return res.AccessToken, nil
}

func (githubProvider) GetUser(ctx context.Context, accessToken string) (*ProviderUser, error) {
	headers := map[string]string{"Authorization": "token " + accessToken}
	_, data, err := fetch(ctx, http.MethodGet, githubAPIURL+"/user", headers, nil)
	if err != nil {
		return nil, err
	}
	var profile struct {
		ID json.Number `json:"id"`
	}
	if err := json.Unmarshal(data, &profile); err != nil {
		return nil, err
	}
	_, data, err = fetch(ctx, http.MethodGet, githubAPIURL+"/user/emails", headers, nil)
	if err != nil {
		return nil, err
	}
	var emails []struct {
		Email string `json:"email"`
	}
	if err := json.Unmarshal(data, &emails); err != nil {
		return nil, err
	}
	if len(emails) == 0 {
		return nil, errors.New("GitHub returned no emails")
	}
	return &ProviderUser{Email: emails[0].Email, ID: profile.ID.String()}, nil
}

// ---- Google ----

type googleProvider struct{}

func googleDefaultRedirect() string {
	return os.Getenv("FRONTEND_URL") + "/integrations/social/youtube"
}

// GenerateLink is OAuth2Client.generateAuthUrl with the same option order.
func (googleProvider) GenerateLink(_ context.Context, q map[string]string) (string, error) {
	return googleAuthURL + "?" + query(false,
		"access_type", "online",
		"prompt", "consent",
		"state", or(q["state"], "login"),
		"redirect_uri", or(q["redirect_uri"], googleDefaultRedirect()),
		"scope", "https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email",
		"response_type", "code",
		"client_id", os.Getenv("YOUTUBE_CLIENT_ID"),
	), nil
}

func (googleProvider) GetToken(ctx context.Context, code, redirectURI string) (string, error) {
	body := query(true,
		"client_id", os.Getenv("YOUTUBE_CLIENT_ID"),
		"code", code,
		"grant_type", "authorization_code",
		"redirect_uri", or(redirectURI, googleDefaultRedirect()),
		"client_secret", os.Getenv("YOUTUBE_CLIENT_SECRET"),
	)
	status, data, err := fetch(ctx, http.MethodPost, googleTokenURL, map[string]string{
		"Content-Type": "application/x-www-form-urlencoded",
	}, []byte(body))
	if err != nil {
		return "", err
	}
	var res struct {
		AccessToken string `json:"access_token"`
		Error       string `json:"error"`
	}
	_ = json.Unmarshal(data, &res)
	if status < 200 || status >= 300 {
		// The code is single use and short lived (callback reloaded or too slow)
		if res.Error == "invalid_grant" {
			return "", httpx.HTTPException("Google sign-in expired, please sign in again", http.StatusBadRequest)
		}
		return "", fmt.Errorf("google token request failed (%d): %s", status, data)
	}
	return res.AccessToken, nil
}

func (googleProvider) GetUser(ctx context.Context, providerToken string) (*ProviderUser, error) {
	status, data, err := fetch(ctx, http.MethodGet, googleUserInfoURL, map[string]string{
		"Authorization": "Bearer " + providerToken,
	}, nil)
	if err != nil {
		return nil, err
	}
	if status < 200 || status >= 300 {
		return nil, fmt.Errorf("google userinfo request failed (%d): %s", status, data)
	}
	var info struct {
		ID    string `json:"id"`
		Email string `json:"email"`
	}
	if err := json.Unmarshal(data, &info); err != nil {
		return nil, err
	}
	return &ProviderUser{ID: info.ID, Email: info.Email}, nil
}

// ---- Apple ----

type appleProvider struct{}

type appleConfig struct{ clientID, teamID, keyID, privateKey string }

func appleGetConfig() (appleConfig, error) {
	cfg := appleConfig{
		clientID:   os.Getenv("APPLE_CLIENT_ID"),
		teamID:     os.Getenv("APPLE_TEAM_ID"),
		keyID:      os.Getenv("APPLE_KEY_ID"),
		privateKey: os.Getenv("APPLE_PRIVATE_KEY"),
	}
	if cfg.clientID == "" || cfg.teamID == "" || cfg.keyID == "" || cfg.privateKey == "" {
		return cfg, errors.New("APPLE environment variables are not set")
	}
	cfg.privateKey = strings.ReplaceAll(cfg.privateKey, `\n`, "\n")
	return cfg, nil
}

func appleDefaultRedirect() string {
	backend := os.Getenv("NEXT_PUBLIC_BACKEND_URL")
	prefix := ""
	if !strings.Contains(backend, "https") {
		prefix = "https://redirectmeto.com/"
	}
	return prefix + backend + "/auth/oauth/apple/redirect"
}

// appleClientSecret is the ES256 client secret JWT Apple requires.
func appleClientSecret(cfg appleConfig) (string, error) {
	key, err := jwt.ParseECPrivateKeyFromPEM([]byte(cfg.privateKey))
	if err != nil {
		return "", err
	}
	now := time.Now().Unix()
	token := jwt.NewWithClaims(jwt.SigningMethodES256, jwt.MapClaims{
		"iat": now,
		"exp": now + 300,
		"aud": "https://appleid.apple.com",
		"iss": cfg.teamID,
		"sub": cfg.clientID,
	})
	token.Header["kid"] = cfg.keyID
	return token.SignedString(key)
}

func (appleProvider) GenerateLink(_ context.Context, q map[string]string) (string, error) {
	cfg, err := appleGetConfig()
	if err != nil {
		return "", err
	}
	return appleURL + "/auth/authorize?" + query(true,
		"client_id", cfg.clientID,
		"redirect_uri", or(q["redirect_uri"], appleDefaultRedirect()),
		"response_type", "code",
		"response_mode", "form_post",
		"scope", "name email",
		"state", or(q["state"], "login"),
	), nil
}

// decodeJWT is jsonwebtoken's decode(token, { complete: true }) without
// verification; ok is false when it is not a JWT.
func decodeJWT(token string) (header, payload map[string]any, ok bool) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return nil, nil, false
	}
	decode := func(s string, out *map[string]any) bool {
		data, err := base64.RawURLEncoding.DecodeString(strings.TrimRight(s, "="))
		return err == nil && json.Unmarshal(data, out) == nil
	}
	if !decode(parts[0], &header) || !decode(parts[1], &payload) {
		return nil, nil, false
	}
	return header, payload, true
}

func (appleProvider) GetToken(ctx context.Context, code, redirectURI string) (string, error) {
	// the native iOS flow has no code exchange - the app sends the id_token
	// directly, which getUser verifies against Apple's public keys
	if _, payload, ok := decodeJWT(code); ok && payload["iss"] == appleIssuer {
		return code, nil
	}

	cfg, err := appleGetConfig()
	if err != nil {
		return "", err
	}
	secret, err := appleClientSecret(cfg)
	if err != nil {
		return "", err
	}
	status, data, err := fetch(ctx, http.MethodPost, appleURL+"/auth/token", map[string]string{
		"Content-Type": "application/x-www-form-urlencoded",
	}, []byte(query(true,
		"grant_type", "authorization_code",
		"code", code,
		"redirect_uri", or(redirectURI, appleDefaultRedirect()),
		"client_id", cfg.clientID,
		"client_secret", secret,
	)))
	if err != nil {
		return "", err
	}
	if status < 200 || status >= 300 {
		return "", errors.New("Token request failed: " + string(data))
	}
	var res struct {
		IDToken string `json:"id_token"`
	}
	if err := json.Unmarshal(data, &res); err != nil {
		return "", err
	}
	if res.IDToken == "" {
		return "", errors.New("Invalid provider token")
	}
	return res.IDToken, nil
}

func (appleProvider) GetUser(ctx context.Context, providerToken string) (*ProviderUser, error) {
	cfg, err := appleGetConfig()
	if err != nil {
		return nil, err
	}
	header, _, _ := decodeJWT(providerToken)
	_, data, err := fetch(ctx, http.MethodGet, appleURL+"/auth/keys", nil, nil)
	if err != nil {
		return nil, err
	}
	var jwks struct {
		Keys []struct {
			Kid string `json:"kid"`
			N   string `json:"n"`
			E   string `json:"e"`
		} `json:"keys"`
	}
	if err := json.Unmarshal(data, &jwks); err != nil {
		return nil, err
	}
	var key *rsa.PublicKey
	for _, k := range jwks.Keys {
		if header != nil && header["kid"] == k.Kid {
			key, err = rsaKeyFromJWK(k.N, k.E)
			if err != nil {
				return nil, err
			}
			break
		}
	}
	if key == nil {
		return nil, errors.New("Invalid provider token")
	}

	// native tokens carry the app bundle id as audience instead of the
	// web services id
	audience := []string{cfg.clientID}
	if bundle := os.Getenv("APPLE_APP_BUNDLE_ID"); bundle != "" {
		audience = append(audience, bundle)
	}

	// the id_token must be verified against Apple's public keys because it is
	// sent back from the client as the providerToken during registration
	claims := jwt.MapClaims{}
	if _, err := jwt.ParseWithClaims(providerToken, claims, func(*jwt.Token) (any, error) { return key, nil },
		jwt.WithValidMethods([]string{"RS256"}), jwt.WithAudience(audience...), jwt.WithIssuer(appleIssuer)); err != nil {
		return nil, err
	}
	sub, _ := claims["sub"].(string)
	email, _ := claims["email"].(string)
	return &ProviderUser{ID: sub, Email: email}, nil
}

func rsaKeyFromJWK(n, e string) (*rsa.PublicKey, error) {
	nb, err := base64.RawURLEncoding.DecodeString(n)
	if err != nil {
		return nil, err
	}
	eb, err := base64.RawURLEncoding.DecodeString(e)
	if err != nil {
		return nil, err
	}
	return &rsa.PublicKey{N: new(big.Int).SetBytes(nb), E: int(new(big.Int).SetBytes(eb).Int64())}, nil
}

// decodeBase64 is Buffer.from(s, 'base64'), which also accepts url-safe
// characters and missing padding.
func decodeBase64(s string) ([]byte, error) {
	s = strings.NewReplacer("-", "+", "_", "/").Replace(strings.TrimRight(strings.TrimSpace(s), "="))
	return base64.RawStdEncoding.DecodeString(s)
}

// ---- Farcaster (Neynar) ----

type farcasterProvider struct{}

type neynarSigner struct {
	Status string      `json:"status"`
	FID    json.Number `json:"fid"`
}

// lookupSigner is NeynarAPIClient.lookupSigner.
func lookupSigner(ctx context.Context, signerUUID string) (*neynarSigner, error) {
	apiKey := or(os.Getenv("NEYNAR_SECRET_KEY"), "00000000-000-0000-000-000000000000")
	status, data, err := fetch(ctx, http.MethodGet, neynarURL+"/v2/farcaster/signer?"+query(true, "signer_uuid", signerUUID),
		map[string]string{"x-api-key": apiKey, "Accept": "application/json"}, nil)
	if err != nil {
		return nil, err
	}
	if status < 200 || status >= 300 {
		return nil, fmt.Errorf("Request failed with status code %d", status)
	}
	signer := &neynarSigner{}
	return signer, json.Unmarshal(data, signer)
}

// GenerateLink: no OAuth redirect here, the frontend only needs the state
// nonce that pairs with the oauth_state cookie set by /auth/oauth/FARCASTER.
func (farcasterProvider) GenerateLink(_ context.Context, q map[string]string) (string, error) {
	return q["state"], nil
}

func (farcasterProvider) GetToken(ctx context.Context, code, _ string) (string, error) {
	raw, err := decodeBase64(code)
	if err != nil {
		return "", err
	}
	var data struct {
		SignerUUID string `json:"signer_uuid"`
	}
	if err := json.Unmarshal(raw, &data); err != nil {
		return "", err
	}
	signer, err := lookupSigner(ctx, data.SignerUUID)
	if err != nil {
		return "", err
	}
	if signer.Status == "approved" {
		return data.SignerUUID, nil
	}
	return "", nil
}

func (farcasterProvider) GetUser(ctx context.Context, providerToken string) (*ProviderUser, error) {
	signer, err := lookupSigner(ctx, providerToken)
	if err != nil {
		return nil, err
	}
	if signer.Status != "approved" {
		return &ProviderUser{}, nil
	}
	id := "farcaster_" + signer.FID.String()
	return &ProviderUser{ID: id, Email: id}, nil
}

// ---- Wallet (Solana, ed25519 over a Redis challenge) ----

type walletProvider struct{ store redis.Store }

func (p walletProvider) GenerateLink(ctx context.Context, q map[string]string) (string, error) {
	publicKey := q["publicKey"]
	if publicKey == "" {
		return "", nil
	}
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	challenge := hex.EncodeToString(buf)
	if err := p.store.Set(ctx, "wallet:"+publicKey, challenge, 60*time.Second); err != nil {
		return "", err
	}
	return challenge, nil
}

type walletCode struct {
	PublicKey string `json:"publicKey"`
	Challenge string `json:"challenge"`
	Signature string `json:"signature"`
}

func parseWalletCode(code string) (walletCode, error) {
	var data walletCode
	raw, err := decodeBase64(code)
	if err != nil {
		return data, err
	}
	return data, json.Unmarshal(raw, &data)
}

func (p walletProvider) GetToken(ctx context.Context, code, _ string) (string, error) {
	data, err := parseWalletCode(code)
	if err != nil {
		return "", err
	}
	if data.PublicKey == "" || data.Challenge == "" || data.Signature == "" {
		return "", nil
	}
	stored, _, err := p.store.Get(ctx, "wallet:"+data.PublicKey)
	if err != nil {
		return "", err
	}
	if stored != data.Challenge {
		return "", nil
	}
	valid, err := verifyWalletSignature(data.PublicKey, data.Challenge, data.Signature)
	if err != nil {
		return "", err
	}
	if !valid {
		return "", nil
	}
	return code, nil
}

func (p walletProvider) GetUser(ctx context.Context, providerToken string) (*ProviderUser, error) {
	token, err := p.GetToken(ctx, providerToken, "")
	if err != nil {
		return nil, err
	}
	if token == "" {
		return &ProviderUser{}, nil
	}
	data, err := parseWalletCode(providerToken)
	if err != nil {
		return nil, err
	}
	id := "wallet_" + data.PublicKey
	return &ProviderUser{ID: id, Email: id}, nil
}

// verifyWalletSignature is nacl.sign.detached.verify(challenge, hex signature,
// bs58 public key), with tweetnacl's size errors.
func verifyWalletSignature(publicKey, challenge, signature string) (bool, error) {
	pk, err := base58Decode(publicKey)
	if err != nil {
		return false, err
	}
	sig, err := hexToBytes(signature)
	if err != nil {
		return false, err
	}
	if len(sig) != ed25519.SignatureSize {
		return false, errors.New("bad signature size")
	}
	if len(pk) != ed25519.PublicKeySize {
		return false, errors.New("bad public key size")
	}
	return ed25519.Verify(pk, []byte(challenge), sig), nil
}

// hexToBytes is wallet.provider.ts hexToUint8Array: parseInt per byte, so an
// invalid pair decodes its leading hex digits (or 0).
func hexToBytes(s string) ([]byte, error) {
	s = strings.TrimPrefix(s, "0x")
	if len(s)%2 != 0 {
		return nil, errors.New("Invalid hex string. It must have an even length.")
	}
	out := make([]byte, len(s)/2)
	for i := range out {
		pair := s[i*2 : i*2+2]
		if n, err := strconv.ParseUint(pair, 16, 8); err == nil {
			out[i] = byte(n)
		} else if n, err := strconv.ParseUint(pair[:1], 16, 8); err == nil {
			out[i] = byte(n)
		}
	}
	return out, nil
}

const base58Alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"

// base58Decode is bs58.decode (Bitcoin alphabet).
func base58Decode(s string) ([]byte, error) {
	n := new(big.Int)
	radix := big.NewInt(58)
	zeros := 0
	for zeros < len(s) && s[zeros] == '1' {
		zeros++
	}
	for _, r := range s {
		i := strings.IndexRune(base58Alphabet, r)
		if i < 0 {
			return nil, errors.New("Non-base58 character")
		}
		n.Mul(n, radix).Add(n, big.NewInt(int64(i)))
	}
	return append(make([]byte, zeros), n.Bytes()...), nil
}

// ---- Generic OAuth / OIDC ----

type oauthProvider struct{}

type oauthConfig struct{ authURL, clientID, clientSecret, tokenURL, userInfoURL, frontendURL string }

func oauthGetConfig() (oauthConfig, error) {
	cfg := oauthConfig{
		authURL:      os.Getenv("POSTIZ_OAUTH_AUTH_URL"),
		clientID:     os.Getenv("POSTIZ_OAUTH_CLIENT_ID"),
		clientSecret: os.Getenv("POSTIZ_OAUTH_CLIENT_SECRET"),
		tokenURL:     os.Getenv("POSTIZ_OAUTH_TOKEN_URL"),
		userInfoURL:  os.Getenv("POSTIZ_OAUTH_USERINFO_URL"),
		frontendURL:  os.Getenv("FRONTEND_URL"),
	}
	if cfg.userInfoURL == "" || cfg.tokenURL == "" || cfg.clientID == "" || cfg.clientSecret == "" || cfg.authURL == "" || cfg.frontendURL == "" {
		return cfg, errors.New("POSTIZ_OAUTH environment variables are not set")
	}
	return cfg, nil
}

func (oauthProvider) GenerateLink(_ context.Context, q map[string]string) (string, error) {
	cfg, err := oauthGetConfig()
	if err != nil {
		return "", err
	}
	return cfg.authURL + "?" + query(true,
		"client_id", cfg.clientID,
		"scope", "openid profile email",
		"response_type", "code",
		"state", or(q["state"], "login"),
		"redirect_uri", cfg.frontendURL+"/settings",
	), nil
}

func (oauthProvider) GetToken(ctx context.Context, code, _ string) (string, error) {
	cfg, err := oauthGetConfig()
	if err != nil {
		return "", err
	}
	status, data, err := fetch(ctx, http.MethodPost, cfg.tokenURL, map[string]string{
		"Content-Type": "application/x-www-form-urlencoded",
		"Accept":       "application/json",
	}, []byte(query(true,
		"grant_type", "authorization_code",
		"client_id", cfg.clientID,
		"client_secret", cfg.clientSecret,
		"code", code,
		"redirect_uri", cfg.frontendURL+"/settings",
	)))
	if err != nil {
		return "", err
	}
	if status < 200 || status >= 300 {
		return "", errors.New("Token request failed: " + string(data))
	}
	var res struct {
		AccessToken string `json:"access_token"`
	}
	if err := json.Unmarshal(data, &res); err != nil {
		return "", err
	}
	return res.AccessToken, nil
}

func (oauthProvider) GetUser(ctx context.Context, accessToken string) (*ProviderUser, error) {
	cfg, err := oauthGetConfig()
	if err != nil {
		return nil, err
	}
	status, data, err := fetch(ctx, http.MethodGet, cfg.userInfoURL, map[string]string{
		"Authorization": "Bearer " + accessToken,
		"Accept":        "application/json",
	}, nil)
	if err != nil {
		return nil, err
	}
	if status < 200 || status >= 300 {
		return nil, errors.New("User info request failed: " + string(data))
	}
	var info struct {
		Email string `json:"email"`
		Sub   string `json:"sub"`
	}
	if err := json.Unmarshal(data, &info); err != nil {
		return nil, err
	}
	return &ProviderUser{Email: info.Email, ID: info.Sub}, nil
}
