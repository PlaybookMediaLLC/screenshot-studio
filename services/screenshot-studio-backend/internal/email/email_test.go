package email

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestSelectProvider(t *testing.T) {
	for env, want := range map[string]string{"resend": "resend", "nodemailer": "nodemailer", "": "no provider", "ses": "no provider"} {
		t.Setenv("EMAIL_PROVIDER", env)
		s := NewService(nil)
		if s.EmailService.Name() != want {
			t.Errorf("%q: got %s", env, s.EmailService.Name())
		}
		if s.HasProvider() != (want != "no provider") {
			t.Errorf("%q: HasProvider", env)
		}
	}
}

func TestSendEmailSkipsWithoutRecipient(t *testing.T) {
	run, err := NewService(nil).SendEmail(context.Background(), "", "s", "h", "top", "")
	if run != nil || err != nil {
		t.Errorf("got %v %v", run, err)
	}
}

func TestResendProvider(t *testing.T) {
	var got map[string]any
	var auth string
	status := 200
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		auth = r.Header.Get("Authorization")
		data, _ := io.ReadAll(r.Body)
		json.Unmarshal(data, &got)
		w.WriteHeader(status)
		if status == 200 {
			w.Write([]byte(`{"id":"em_1"}`))
		} else {
			w.Write([]byte(`{"statusCode":429,"name":"rate_limit_exceeded","message":"Too many requests"}`))
		}
	}))
	defer srv.Close()
	resendURL = srv.URL
	t.Setenv("RESEND_API_KEY", "")

	_, err := ResendProvider{}.SendEmail(context.Background(), "a@b.c", "Hi", "<p>x</p>", "Postiz", "no@postiz.com", "")
	if err != nil || auth != "Bearer re_132" || got["from"] != "Postiz <no@postiz.com>" || got["to"] != "a@b.c" {
		t.Fatalf("send: %v %q %v", err, auth, got)
	}
	if _, has := got["reply_to"]; has {
		t.Error("reply_to must be omitted when empty")
	}

	status = 429
	_, err = ResendProvider{}.SendEmail(context.Background(), "a@b.c", "Hi", "x", "P", "n@p.c", "r@p.c")
	if err == nil || err.Error() != "rate_limit_exceeded: Too many requests" || got["reply_to"] != "r@p.c" {
		t.Errorf("error: %v %v", err, got)
	}
}

type flaky struct {
	calls int
	html  string
}

func (f *flaky) Name() string              { return "flaky" }
func (f *flaky) ValidateEnvKeys() []string { return nil }
func (f *flaky) SendEmail(_ context.Context, _, _, html, _, _, _ string) (any, error) {
	f.calls++
	f.html = html
	if f.calls < 3 {
		return nil, errors.New("429")
	}
	return "ok", nil
}

func TestSendEmailSyncRetries(t *testing.T) {
	t.Setenv("EMAIL_FROM_ADDRESS", "no@postiz.com")
	t.Setenv("EMAIL_FROM_NAME", "Postiz")
	t.Setenv("FRONTEND_URL", "https://app")
	provider := &flaky{}
	s := &Service{EmailService: provider}

	s.SendEmailSync(context.Background(), "not-an-email", "s", "h", "")
	if provider.calls != 0 {
		t.Fatal("must skip addresses without @")
	}
	s.SendEmailSync(context.Background(), "a@b.c", "Subject", "<b>body</b>", "")
	if provider.calls != 3 {
		t.Errorf("calls %d", provider.calls)
	}
	for _, want := range []string{">Subject</h1>", "<b>body</b>", ">Postiz</h2>", `href="https://app/settings"`} {
		if !strings.Contains(provider.html, want) {
			t.Errorf("layout misses %q", want)
		}
	}
}
