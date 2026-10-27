package product

import (
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
)

func TestSurfaceSlug(t *testing.T) {
	for name, want := range map[string]string{"Invoice Approvals": "invoice-approvals", "  Billing!! ": "billing",
		"Café menu": "caf-menu", "???": "surface", "a/b_c": "a-b-c"} {
		if got := surfaceSlug(name); got != want {
			t.Errorf("surfaceSlug(%q)=%q want %q", name, got, want)
		}
	}
}

func TestMatchSurfaceRanksTagsNamesThenTokens(t *testing.T) {
	description := "Review and approve invoices before payment"
	approvals := &ent.ProductSurface{Name: "Invoice approvals", Slug: "invoice-approvals", FeatureTags: []string{"Payables", "approval queue"}, URL: "https://acme.test/invoices/review", Description: &description}
	cases := []struct {
		feature string
		tags    []string
		reason  string
		score   int
	}{
		{"anything", []string{"payables"}, SurfaceMatchTag, 100},
		{"market our payables", nil, SurfaceMatchTag, 100},
		{"the approval queues", nil, SurfaceMatchTag, 100},
		{"approval", nil, SurfaceMatchTokens, 70},
		{"Invoice Approvals", nil, SurfaceMatchName, 90},
		{"invoice-approvals", nil, SurfaceMatchName, 90},
		{"market the invoice approval flow", nil, SurfaceMatchTokens, 50}, // invoice and approval of invoice, approval, flow
		{"review flow", nil, SurfaceMatchTokens, 40},                      // review from the URL path
		{"pricing page", nil, "", 0},
	}
	for _, tc := range cases {
		reason, score, ok := matchSurface(approvals, tc.feature, tc.tags)
		if reason != tc.reason || score != tc.score || ok != (tc.reason != "") {
			t.Errorf("%q tags=%v: reason=%q score=%d ok=%v, want %q %d", tc.feature, tc.tags, reason, score, ok, tc.reason, tc.score)
		}
	}
}
