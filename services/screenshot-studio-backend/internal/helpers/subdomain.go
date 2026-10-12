package helpers

import (
	"net"
	"net/url"
	"strings"

	"golang.org/x/net/publicsuffix"
)

// GetCookieURLFromDomain is subdomain.management.ts getCookieUrlFromDomain:
// tldts' registrable domain (ICANN rules only, its default) prefixed with a
// dot, or the bare hostname when there is none (localhost, IPs).
func GetCookieURLFromDomain(domain string) string {
	hostname := extractHostname(domain)
	if d := registrableDomain(hostname); d != "" {
		return "." + d
	}
	return hostname
}

// extractHostname follows tldts: the host of a URL, or the leading host of a
// bare "host[:port][/path]" string, lowercased, without a trailing dot.
func extractHostname(s string) string {
	s = strings.TrimSpace(s)
	if strings.Contains(s, "://") {
		if u, err := url.Parse(s); err == nil {
			s = u.Hostname()
		}
	} else {
		if i := strings.IndexAny(s, "/?#"); i >= 0 {
			s = s[:i]
		}
		if i := strings.LastIndex(s, "@"); i >= 0 {
			s = s[i+1:]
		}
		if h, _, err := net.SplitHostPort(s); err == nil {
			s = h
		}
		s = strings.Trim(s, "[]")
	}
	return strings.TrimSuffix(strings.ToLower(s), ".")
}

func registrableDomain(hostname string) string {
	if hostname == "" || net.ParseIP(hostname) != nil {
		return ""
	}
	suffix, icann := publicsuffix.PublicSuffix(hostname)
	// tldts ignores the private section of the list by default
	for !icann {
		i := strings.IndexByte(suffix, '.')
		if i < 0 {
			break
		}
		suffix, icann = publicsuffix.PublicSuffix(suffix[i+1:])
	}
	if hostname == suffix || !strings.HasSuffix(hostname, "."+suffix) {
		return ""
	}
	rest := strings.TrimSuffix(hostname, "."+suffix)
	return rest[strings.LastIndexByte(rest, '.')+1:] + "." + suffix
}
