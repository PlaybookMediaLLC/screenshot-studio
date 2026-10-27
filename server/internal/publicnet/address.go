// Package publicnet defines the outbound network boundary shared by fetchers and webhooks.
package publicnet

import "net/netip"

var globalIPv6 = netip.MustParsePrefix("2000::/3")
var excluded = []netip.Prefix{
	netip.MustParsePrefix("0.0.0.0/8"),
	netip.MustParsePrefix("100.64.0.0/10"),
	netip.MustParsePrefix("192.0.0.0/24"),
	netip.MustParsePrefix("192.0.2.0/24"),
	netip.MustParsePrefix("198.18.0.0/15"),
	netip.MustParsePrefix("198.51.100.0/24"),
	netip.MustParsePrefix("203.0.113.0/24"),
	netip.MustParsePrefix("240.0.0.0/4"),
	netip.MustParsePrefix("2001::/32"),    // Teredo embeds IPv4 destinations.
	netip.MustParsePrefix("2001:2::/48"),  // Benchmarking.
	netip.MustParsePrefix("2001:10::/28"), // ORCHID.
	netip.MustParsePrefix("2001:20::/28"), // ORCHIDv2.
	netip.MustParsePrefix("2001:db8::/32"),
	netip.MustParsePrefix("2002::/16"), // 6to4 embeds IPv4 destinations.
	netip.MustParsePrefix("3fff::/20"), // Documentation.
}

// IsPublic rejects private, reserved, scoped, and transition addresses. NAT64,
// IPv4-compatible addresses, and site-local IPv6 are outside globalIPv6.
func IsPublic(address netip.Addr) bool {
	if !address.IsValid() || address.Zone() != "" {
		return false
	}
	address = address.Unmap()
	if !address.IsGlobalUnicast() || address.IsPrivate() || address.IsLoopback() || address.IsLinkLocalUnicast() {
		return false
	}
	if address.Is6() && !globalIPv6.Contains(address) {
		return false
	}
	for _, prefix := range excluded {
		if prefix.Contains(address) {
			return false
		}
	}
	return true
}
