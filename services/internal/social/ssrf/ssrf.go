// Package ssrf is the SSRF guard for webhooks and other user-supplied
// URLs. Every outbound request whose URL a user can
// influence goes through Client, which checks the address actually dialed,
// so DNS rebinding cannot slip past a check done earlier.
package ssrf

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"os"
	"strings"
	"syscall"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publicnet"
)

// ErrBlocked is returned when a request would reach a private address.
var ErrBlocked = errors.New("Blocked IP")

// IsBlockedIP reports loopback, private, link-local, CGNAT, benchmark,
// multicast, reserved and unparseable addresses.
func IsBlockedIP(ip string) bool {
	addr, err := netip.ParseAddr(strings.Trim(ip, "[]"))
	if err != nil {
		return true
	}
	return !publicnet.IsPublic(addr)
}

// IsSafePublicHTTPSURL is the IsSafeWebhookUrl validator.
func IsSafePublicHTTPSURL(ctx context.Context, value string) bool {
	if strings.TrimSpace(value) == "" {
		return false
	}
	parsed, err := url.Parse(value)
	if err != nil || parsed.Scheme != "https" || parsed.Hostname() == "" {
		return false
	}
	host := strings.ToLower(parsed.Hostname())
	if host == "localhost" {
		return false
	}
	if _, err := netip.ParseAddr(host); err == nil {
		return !IsBlockedIP(host)
	}
	addrs, err := net.DefaultResolver.LookupHost(ctx, host)
	if err != nil || len(addrs) == 0 {
		return false
	}
	for _, addr := range addrs {
		if IsBlockedIP(addr) {
			return false
		}
	}
	return true
}

// Disabled reports DISABLE_SSRF_PROTECTION=true (self-hosters reaching
// services on a private network).
func Disabled() bool { return os.Getenv("DISABLE_SSRF_PROTECTION") == "true" }

var guarded = &http.Client{Transport: newTransport()}

var publicOnly = &http.Client{
	Transport: newTransport(),
	Timeout:   10 * time.Second,
	CheckRedirect: func(*http.Request, []*http.Request) error {
		return errors.New("instance redirects are not allowed")
	},
}

// PublicClient keeps public instance discovery and credentials off private
// networks even when a self-hosted deployment disables the general guard.
// Redirects are refused so credentials cannot leave the chosen instance.
func PublicClient() *http.Client { return publicOnly }

func newTransport() *http.Transport {
	dialer := &net.Dialer{
		Timeout:   30 * time.Second,
		KeepAlive: 30 * time.Second,
		Control: func(_, address string, _ syscall.RawConn) error {
			host, _, err := net.SplitHostPort(address)
			if err != nil {
				return err
			}
			if IsBlockedIP(host) {
				return ErrBlocked
			}
			return nil
		},
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.DialContext = dialer.DialContext
	transport.Proxy = nil
	return transport
}

// Client returns the SSRF-safe client, or the default client when protection
// is disabled. It has no overall timeout; callers bound requests with ctx.
func Client() *http.Client {
	if Disabled() {
		return http.DefaultClient
	}
	return guarded
}
