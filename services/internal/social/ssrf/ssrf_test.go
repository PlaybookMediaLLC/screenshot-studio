package ssrf

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

func TestPrivateAddresses(t *testing.T) {
	for _, address := range []string{"127.0.0.1", "10.0.0.1", "169.254.169.254", "192.168.1.1", "172.31.255.1", "100.64.0.1", "198.18.0.1", "0.0.0.0", "255.255.255.255", "::", "::1", "::ffff:127.0.0.1", "fe80::1", "fe90::1", "febf::1", "fec0::1", "fd12::1", "fc00::1", "ff02::1", "2001:db8::1", "garbage"} {
		if !IsBlockedIP(address) {
			t.Errorf("allowed %s", address)
		}
	}
	for _, address := range []string{"1.1.1.1", "2606:4700:4700::1111"} {
		if IsBlockedIP(address) {
			t.Errorf("blocked public %s", address)
		}
	}
}

func TestPublicClientIgnoresSelfHostingBypass(t *testing.T) {
	t.Setenv("DISABLE_SSRF_PROTECTION", "true")
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { requests.Add(1) }))
	defer server.Close()
	response, err := PublicClient().Get(server.URL)
	if response != nil {
		response.Body.Close()
	}
	if err == nil || requests.Load() != 0 {
		t.Fatalf("private request reached server: %v, %d", err, requests.Load())
	}
	if PublicClient().Timeout <= 0 {
		t.Fatal("public requests have no deadline")
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestPublicClientDoesNotFollowRedirects(t *testing.T) {
	client := *PublicClient()
	requests := 0
	client.Transport = roundTripFunc(func(request *http.Request) (*http.Response, error) {
		requests++
		return &http.Response{StatusCode: http.StatusFound, Header: http.Header{"Location": {"https://127.0.0.1/credentials"}}, Body: io.NopCloser(strings.NewReader("")), Request: request}, nil
	})
	response, err := client.Get("https://social.example/api/v2/instance")
	if response != nil {
		response.Body.Close()
	}
	if err == nil || requests != 1 {
		t.Fatalf("followed redirect: %v, %d", err, requests)
	}
}
