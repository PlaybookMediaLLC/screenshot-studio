package mastodoncustom

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"
)

const responseLimit = 1 << 20

// credentialClient bounds instance responses and removes remote error bodies
// before the shared publisher can put them in logs or Temporal failure details.
// A server can echo client secrets or Authorization headers in an error body.
func credentialClient(client *http.Client) *http.Client {
	copy := *client
	transport := client.Transport
	if transport == nil {
		transport = http.DefaultTransport
	}
	copy.Transport = credentialTransport{transport}
	copy.CheckRedirect = func(*http.Request, []*http.Request) error { return errConnection }
	return &copy
}

type credentialTransport struct{ inner http.RoundTripper }

func (t credentialTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	response, err := t.inner.RoundTrip(request)
	if err != nil {
		if request.Context().Err() != nil {
			return nil, request.Context().Err()
		}
		return nil, errConnection
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		response.Body.Close()
		response.Body = io.NopCloser(strings.NewReader(`{"error":"Mastodon request failed"}`))
	} else {
		response.Body = &boundedBody{ReadCloser: response.Body, remaining: responseLimit}
	}
	return response, nil
}

type boundedBody struct {
	io.ReadCloser
	remaining int
}

func (b *boundedBody) Read(buffer []byte) (int, error) {
	if len(buffer) > b.remaining+1 {
		buffer = buffer[:b.remaining+1]
	}
	n, err := b.ReadCloser.Read(buffer)
	if n > b.remaining {
		return 0, errConnection
	}
	b.remaining -= n
	return n, err
}

// requestJSON deliberately does not retry authorization-code exchange or app
// registration: a lost response may already have consumed the code or created
// the app. Errors carry neither request credentials nor provider response text.
func (p *Provider) requestJSON(ctx context.Context, endpoint string, form url.Values, token string, out any) error {
	method := http.MethodGet
	var body io.Reader
	if form != nil {
		method, body = http.MethodPost, strings.NewReader(form.Encode())
	}
	request, err := http.NewRequestWithContext(ctx, method, endpoint, body)
	if err != nil {
		return errConnection
	}
	request.Header.Set("Accept", "application/json")
	if form != nil {
		request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	}
	if token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	response, err := p.client.Do(request)
	if err != nil {
		return errConnection
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK && response.StatusCode != http.StatusCreated {
		return errConnection
	}
	data, err := io.ReadAll(response.Body)
	if err != nil || json.Unmarshal(data, out) != nil {
		return errConnection
	}
	return nil
}
