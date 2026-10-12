// Package ssrf is Postiz's SSRF guard (dtos/webhooks/ssrf.safe.dispatcher.ts
// and webhook.url.validator.ts). Every outbound request whose URL a user can
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
	addr = addr.Unmap()
	if addr.Is4() {
		b := addr.As4()
		a, s := b[0], b[1]
		return a == 0 || a == 10 || a == 127 || (a == 169 && s == 254) || (a == 172 && s >= 16 && s <= 31) ||
			(a == 192 && s == 168) || (a == 100 && s >= 64 && s <= 127) || (a == 198 && (s == 18 || s == 19)) || a >= 224
	}
	text := strings.ToLower(addr.String())
	return text == "::1" || text == "::" || strings.HasPrefix(text, "fe80:") || strings.HasPrefix(text, "fc") ||
		strings.HasPrefix(text, "fd") || strings.HasPrefix(text, "ff")
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
