package communityutil

import "testing"

func TestSlugify(t *testing.T) {
	// Expected values produced by slugify@1.6.6 in node.
	cases := map[string]string{
		"Hello World!":               "hello-world",
		"  Ünïcödé — Title & More  ": "unicode-title-and-more",
		"a-b_c  d":                   "a-bc-d",
		"Ça va? 100% €5 «x»":         "ca-va-100percent-euro5-x",
		"Ѐ hello there　x":            "hello-there-x",
		"x\u0085y":                   "xy",
	}
	for in, want := range cases {
		if got := Slugify(in); got != want {
			t.Errorf("Slugify(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestJSHelpers(t *testing.T) {
	if got := EncodeURIComponent("a b/c!'()*~"); got != "a%20b%2Fc!'()*~" {
		t.Errorf("EncodeURIComponent = %q", got)
	}
	if got := DecodeBase64("eyJhIjoxfQ"); got != `{"a":1}` {
		t.Errorf("DecodeBase64 unpadded = %q", got)
	}
	if got := DecodeBase64("eyJh\nIjoxfQ=="); got != `{"a":1}` {
		t.Errorf("DecodeBase64 whitespace = %q", got)
	}
	if got := Substring16("a😀b", 2); got != "a�" && got != "a" {
		t.Errorf("Substring16 = %q", got)
	}
	if n, ok := JSNumber("12"); !ok || n != 12 {
		t.Errorf("JSNumber(12) = %v %v", n, ok)
	}
	if _, ok := JSNumber("x"); ok {
		t.Error("JSNumber(x) should be NaN")
	}
	if MimeType("a/b.mp4") != "video/mp4" || MimeType("x.png") != "image/png" || MimeType("noext") != "" {
		t.Error("MimeType")
	}
}
