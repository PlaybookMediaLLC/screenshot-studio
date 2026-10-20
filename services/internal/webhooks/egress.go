package webhooks

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
	"syscall"
	"time"
)

// ErrUnsafeEndpoint refuses an endpoint the platform will not call.
type ErrUnsafeEndpoint struct{ Reason string }

func (e *ErrUnsafeEndpoint) Error() string { return e.Reason }

var blockedPrefixes = []netip.Prefix{
	netip.MustParsePrefix("100.64.0.0/10"),   // shared address space
	netip.MustParsePrefix("198.18.0.0/15"),   // benchmarking
	netip.MustParsePrefix("192.0.0.0/24"),    // IETF protocol assignments
	netip.MustParsePrefix("192.0.2.0/24"),    // documentation
	netip.MustParsePrefix("198.51.100.0/24"), // documentation
	netip.MustParsePrefix("203.0.113.0/24"),  // documentation
	netip.MustParsePrefix("240.0.0.0/4"),     // reserved
	netip.MustParsePrefix("2001:db8::/32"),   // documentation
	netip.MustParsePrefix("64:ff9b::/96"),    // NAT64 can reach private IPv4
}

// PublicAddress reports whether an address is one a customer endpoint may
// resolve to: global unicast, and not private, loopback, link-local (which
// includes cloud metadata at 169.254.169.254), shared or reserved.
func PublicAddress(address netip.Addr) bool {
	address = address.Unmap()
	if !address.IsGlobalUnicast() || address.IsPrivate() || address.IsLoopback() || address.IsLinkLocalUnicast() ||
		address.IsLinkLocalMulticast() || address.IsMulticast() || address.IsUnspecified() {
		return false
	}
	for _, prefix := range blockedPrefixes {
		if prefix.Contains(address) {
			return false
		}
	}
	return true
}

// Resolver looks up a host's addresses; tests replace it.
type Resolver interface {
	LookupNetIP(ctx context.Context, network, host string) ([]netip.Addr, error)
}

// ValidateEndpoint checks a destination when it is saved: HTTPS, no
// credentials, no fragment, a host name rather than an address, and every
// address it resolves to public. Delivery checks the dialed address again,
// because DNS can change between now and then.
func ValidateEndpoint(ctx context.Context, resolver Resolver, raw string) (string, error) {
	if len(raw) > 2048 {
		return "", &ErrUnsafeEndpoint{"Keep the URL under 2,048 characters."}
	}
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Host == "" {
		return "", &ErrUnsafeEndpoint{"Enter a full URL, such as https://example.com/hooks."}
	}
	if u.Scheme != "https" {
		return "", &ErrUnsafeEndpoint{"Webhook URLs must use https."}
	}
	if u.User != nil {
		return "", &ErrUnsafeEndpoint{"Remove the user name or password from the URL; use the signing secret instead."}
	}
	if u.Fragment != "" {
		return "", &ErrUnsafeEndpoint{"Remove the #fragment from the URL."}
	}
	host := u.Hostname()
	if _, err := netip.ParseAddr(host); err == nil {
		return "", &ErrUnsafeEndpoint{"Use a host name, not an IP address."}
	}
	lower := strings.ToLower(strings.TrimSuffix(host, "."))
	if lower == "localhost" || strings.HasSuffix(lower, ".localhost") || strings.HasSuffix(lower, ".internal") ||
		strings.HasSuffix(lower, ".local") || !strings.Contains(lower, ".") {
		return "", &ErrUnsafeEndpoint{"Use a public host name."}
	}
	lookupCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	addresses, err := resolver.LookupNetIP(lookupCtx, "ip", lower)
	if err != nil || len(addresses) == 0 {
		return "", &ErrUnsafeEndpoint{"The host name does not resolve."}
	}
	for _, address := range addresses {
		if !PublicAddress(address) {
			return "", &ErrUnsafeEndpoint{"The host resolves to a private or reserved address."}
		}
	}
	u.Host = lower + portSuffix(u)
	return u.String(), nil
}

func portSuffix(u *url.URL) string {
	if port := u.Port(); port != "" {
		return ":" + port
	}
	return ""
}

// errBlockedDestination marks a dial refused because the address is not public.
var errBlockedDestination = errors.New("blocked destination")

// NewHTTPClient is the delivery client: it dials only public addresses
// (checked on the address actually dialed, so DNS rebinding cannot reach a
// private one), uses no environment proxy, never follows a redirect, and
// gives up after ten seconds.
func NewHTTPClient() *http.Client {
	dialer := &net.Dialer{Timeout: 5 * time.Second, Control: func(_, address string, _ syscall.RawConn) error {
		host, _, err := net.SplitHostPort(address)
		if err != nil {
			return err
		}
		parsed, err := netip.ParseAddr(host)
		if err != nil || !PublicAddress(parsed) {
			return fmt.Errorf("%w: %s", errBlockedDestination, host)
		}
		return nil
	}}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil
	transport.DialContext = dialer.DialContext
	transport.MaxResponseHeaderBytes = 16 << 10
	return &http.Client{Transport: transport, Timeout: 10 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
}
