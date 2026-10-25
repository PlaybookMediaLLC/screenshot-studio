package publicnet_test

import (
	"net/netip"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publicnet"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ssrf"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/webhooks"
)

func TestOutboundGuardsAgreeOnSpecialAddresses(t *testing.T) {
	for _, value := range []string{
		"0.1.2.3", "100.64.0.1", "192.0.0.8", "192.0.2.1", "198.51.100.1", "203.0.113.1",
		"127.0.0.1", "10.0.0.1", "169.254.169.254", "224.0.0.1", "240.0.0.1",
		"::ffff:7f00:1", "::127.0.0.1", "64:ff9b::a9fe:a9fe", "64:ff9b:1::a00:1",
		"2002:7f00:1::", "2001::1", "2001:2::1", "2001:10::1", "2001:20::1",
		"2001:db8::1", "3fff::1", "2::1", "fd00::1", "fec0::1", "fe80::1%eth0",
	} {
		a := netip.MustParseAddr(value)
		if publicnet.IsPublic(a) || webhooks.PublicAddress(a) || !ssrf.IsBlockedIP(value) {
			t.Errorf("an outbound guard accepted %s", value)
		}
	}
	for _, value := range []string{"1.1.1.1", "8.8.8.8", "2606:4700:4700::1111", "2001:4860:4860::8888", "::ffff:8.8.8.8"} {
		a := netip.MustParseAddr(value)
		if !publicnet.IsPublic(a) || !webhooks.PublicAddress(a) || ssrf.IsBlockedIP(value) {
			t.Errorf("an outbound guard refused %s", value)
		}
	}
}
