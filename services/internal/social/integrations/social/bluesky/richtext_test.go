package bluesky

import (
	"encoding/json"
	"slices"
	"strings"
	"testing"
)

// Expected facets were produced by @atproto/api 0.15.27:
// new RichText({ text }).detectFacetsWithoutResolution().
func TestDetectFacetsMatchesAtprotoAPI(t *testing.T) {
	keycap := "#" + string(rune(0xfe0f)) + string(rune(0x20e3)) + "x"
	cases := []struct{ text, want string }{
		{
			"✨ hi @alice.bsky.social and @nobody.invalidtld, see https://example.com/path. or (example.org) #tag 👋 #123 ＃日本語! end",
			`[{"$type":"app.bsky.richtext.facet","index":{"byteStart":7,"byteEnd":25},"features":[{"$type":"app.bsky.richtext.facet#mention","did":"alice.bsky.social"}]},{"index":{"byteStart":54,"byteEnd":78},"features":[{"$type":"app.bsky.richtext.facet#link","uri":"https://example.com/path"}]},{"index":{"byteStart":84,"byteEnd":95},"features":[{"$type":"app.bsky.richtext.facet#link","uri":"https://example.org"}]},{"index":{"byteStart":97,"byteEnd":101},"features":[{"$type":"app.bsky.richtext.facet#tag","tag":"tag"}]},{"index":{"byteStart":112,"byteEnd":124},"features":[{"$type":"app.bsky.richtext.facet#tag","tag":"日本語"}]}]`,
		},
		{
			"@Bob.Bsky.Social x @dev.test\nexample.com/a?b=c, HTTP://UPPER.COM https://x.co/(paren) #a#b " + keycap + " #" + strings.Repeat("a", 70) + " é#notag #ok…",
			`[{"$type":"app.bsky.richtext.facet","index":{"byteStart":19,"byteEnd":28},"features":[{"$type":"app.bsky.richtext.facet#mention","did":"dev.test"}]},{"index":{"byteStart":29,"byteEnd":46},"features":[{"$type":"app.bsky.richtext.facet#link","uri":"https://example.com/a?b=c"}]},{"index":{"byteStart":65,"byteEnd":85},"features":[{"$type":"app.bsky.richtext.facet#link","uri":"https://x.co/(paren)"}]},{"index":{"byteStart":86,"byteEnd":90},"features":[{"$type":"app.bsky.richtext.facet#tag","tag":"a#b"}]},{"index":{"byteStart":181,"byteEnd":184},"features":[{"$type":"app.bsky.richtext.facet#tag","tag":"ok"}]}]`,
		},
		{
			"café @carol.example.com 😀😀 https://😀.com #😀tag. www.test.dev/x)",
			`[{"$type":"app.bsky.richtext.facet","index":{"byteStart":6,"byteEnd":24},"features":[{"$type":"app.bsky.richtext.facet#mention","did":"carol.example.com"}]},{"index":{"byteStart":34,"byteEnd":50},"features":[{"$type":"app.bsky.richtext.facet#link","uri":"https://😀.com"}]},{"index":{"byteStart":51,"byteEnd":59},"features":[{"$type":"app.bsky.richtext.facet#tag","tag":"😀tag"}]},{"index":{"byteStart":61,"byteEnd":75},"features":[{"$type":"app.bsky.richtext.facet#link","uri":"https://www.test.dev/x"}]}]`,
		},
	}
	for _, c := range cases {
		facets := DetectFacets(c.text)
		slices.SortStableFunc(facets, func(x, y Facet) int { return x.Index.ByteStart - y.Index.ByteStart })
		got, err := json.Marshal(facets)
		if err != nil {
			t.Fatal(err)
		}
		var gotV, wantV any
		_ = json.Unmarshal(got, &gotV)
		_ = json.Unmarshal([]byte(c.want), &wantV)
		gotN, _ := json.Marshal(gotV)
		wantN, _ := json.Marshal(wantV)
		if string(gotN) != string(wantN) {
			t.Errorf("text %q\n got %s\nwant %s", c.text, gotN, wantN)
		}
	}
}

func TestDetectFacetsNone(t *testing.T) {
	if facets := DetectFacets("plain text, nothing @here #123"); facets != nil {
		t.Fatalf("want nil, got %+v", facets)
	}
}
