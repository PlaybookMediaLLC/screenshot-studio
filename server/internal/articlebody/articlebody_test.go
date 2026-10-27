package articlebody

import (
	"strings"
	"testing"
)

func TestRenderResolvesOnlyAttachedMediaAndRejectsUnsafeContent(t *testing.T) {
	assets := map[string]string{"casset000001": "https://media.example/private.png?signature=1&expires=2"}
	source := `<h1>Title</h1><p><strong>Bold</strong> <em>italic</em><br/>next</p><img data-asset-id="casset000001" alt="A &amp; B"><blockquote data-x-post="123"><a href="https://x.com/i/status/123">Post</a></blockquote>`
	got, err := Render(source, assets)
	if err != nil || !strings.Contains(got, `src="https://media.example/private.png?signature=1&amp;expires=2"`) || strings.Contains(got, "data-asset-id") {
		t.Fatalf("%s %v", got, err)
	}
	for _, bad := range []string{`<script>alert(1)</script>`, `<p onclick="bad">text</p>`, `<a href="javascript:alert(1)">link</a>`, `<img src="http://127.0.0.1/secret">`, `<img data-asset-id="cother000001">`, `<blockquote data-x-post="no">post</blockquote>`} {
		if _, err := Render(bad, assets); err == nil {
			t.Errorf("accepted %s", bad)
		}
	}
}
