package product

import "testing"

// The same cases as test/content-draft-when.test.ts: both sides must agree.
func TestXLengthMatchesTheComposer(t *testing.T) {
	cases := map[string]int{
		"hello": 5,
		"see https://example.com/a/very/long/path?with=query.": 4 + 23 + 1,
		"www.example.com": 23,
		"日本語":             6,
		"🚀":               2,
		"👍🏽":              2,
		"👨‍👩‍👧":           2,
		"🇫🇷":              2,
		"café — “quoted”": 15,
	}
	for text, want := range cases {
		if got := xLength(text); got != want {
			t.Errorf("xLength(%q) = %d, want %d", text, got, want)
		}
	}
}
