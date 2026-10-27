package linkedin

import (
	"encoding/json"
	"testing"
)

// Images carry their descriptions as altText; a PDF document does not.
func TestPostContentAltText(t *testing.T) {
	single, _ := json.Marshal(buildPostContent(false, []string{"urn:li:image:1"}, "", "A chart"))
	if string(single) != `{"media":{"altText":"A chart","id":"urn:li:image:1"}}` {
		t.Fatalf("single = %s", single)
	}
	multi, _ := json.Marshal(buildPostContent(false, []string{"urn:li:image:1", "urn:li:image:2"}, "", "", "Second"))
	if string(multi) != `{"multiImage":{"images":[{"id":"urn:li:image:1"},{"altText":"Second","id":"urn:li:image:2"}]}}` {
		t.Fatalf("multi = %s", multi)
	}
	pdf, _ := json.Marshal(buildPostContent(true, []string{"urn:li:document:1"}, "Deck", "ignored"))
	if string(pdf) != `{"media":{"id":"urn:li:document:1","title":"Deck"}}` {
		t.Fatalf("pdf = %s", pdf)
	}
}
