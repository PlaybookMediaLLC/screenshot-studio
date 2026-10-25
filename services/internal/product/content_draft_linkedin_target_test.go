package product

import (
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/draftdoc"
	"testing"
)

func TestLinkedInRepostTargets(t *testing.T) {
	for input, expected := range map[string]string{
		"https://www.linkedin.com/feed/update/urn:li:share:123/?utm=copy":                      "urn:li:share:123",
		"https://linkedin.com/feed/update/urn%3Ali%3AugcPost%3A456":                            "urn:li:ugcPost:456",
		"https://www.linkedin.com/posts/anne_release-notes-activity-789-Ab_c?utm_source=share": "urn:li:activity:789",
	} {
		got, err := draftTarget("quote", &draftdoc.Target{URL: input})
		if err != nil || got.Platform != "linkedin" || got.RemoteID != expected {
			t.Fatalf("%s: %+v %v", input, got, err)
		}
	}
	for _, input := range []string{
		"https://linkedin.com.evil.test/feed/update/urn:li:share:123",
		"https://linkedin.com/?url=urn:li:share:123",
		"https://linkedin.com/company/urn:li:share:123",
		"https://linkedin.com/feed/update/urn:li:share:123junk",
		"https://linkedin.com/posts/anne-activity-invalid",
	} {
		if got, err := draftTarget("quote", &draftdoc.Target{URL: input}); err == nil {
			t.Fatalf("invalid target accepted: %+v", got)
		}
	}
}
