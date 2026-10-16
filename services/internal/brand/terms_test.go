package brand

import (
	"encoding/json"
	"testing"
)

func TestCheckMatchesNormalizedTermsOnWordBoundaries(t *testing.T) {
	cases := []struct {
		name  string
		term  ProhibitedTerm
		text  string
		match bool
	}{
		{"exact word", ProhibitedTerm{Term: "Acme", MatchMode: MatchWord}, "Better than Acme today", true},
		{"case folded", ProhibitedTerm{Term: "acme", MatchMode: MatchWord}, "ACME is slow", true},
		{"possessive", ProhibitedTerm{Term: "Acme", MatchMode: MatchWord}, "Acme's pricing", true},
		{"inside a word", ProhibitedTerm{Term: "Acme", MatchMode: MatchWord}, "Acmeville is a town", false},
		{"phrase inside a word", ProhibitedTerm{Term: "Acme", MatchMode: MatchPhrase}, "Acmeville is a town", true},
		{"full width NFKC", ProhibitedTerm{Term: "acme", MatchMode: MatchWord}, "Try ＡＣＭＥ now", true},
		{"ligature NFKC", ProhibitedTerm{Term: "office", MatchMode: MatchWord}, "the oﬃce suite", true},
		{"sharp s folds", ProhibitedTerm{Term: "strasse", MatchMode: MatchWord}, "Die STRAßE", true},
		{"collapsed whitespace", ProhibitedTerm{Term: "game changer", MatchMode: MatchWord}, "a real game \n  changer", true},
		{"hyphenated", ProhibitedTerm{Term: "game-changing", MatchMode: MatchWord}, "This is game-changing.", true},
		{"unicode letters bound", ProhibitedTerm{Term: "café", MatchMode: MatchWord}, "cafés", false},
		{"second occurrence bounded", ProhibitedTerm{Term: "pro", MatchMode: MatchWord}, "product pro", true},
		{"legacy empty mode is word", ProhibitedTerm{Term: "pro"}, "product", false},
		{"no match", ProhibitedTerm{Term: "Acme", MatchMode: MatchWord}, "nothing here", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := Check([]ProhibitedTerm{tc.term}, tc.text)
			if (len(got) == 1) != tc.match {
				t.Fatalf("Check(%q, %q) = %+v, want match=%v", tc.term.Term, tc.text, got, tc.match)
			}
		})
	}
}

func TestCheckReportsEachTermOnceWithItsReason(t *testing.T) {
	terms := []ProhibitedTerm{{Term: "Acme", Reason: "Competitor", MatchMode: MatchWord}, {Term: "free", MatchMode: MatchWord}}
	got := Check(terms, "Acme and Acme", "", "Acme")
	if len(got) != 1 || got[0].Term != "Acme" || got[0].Reason != "Competitor" {
		t.Fatalf("matches=%+v", got)
	}
}

func TestProhibitedTermsDecodeLegacyAndStructured(t *testing.T) {
	var terms []ProhibitedTerm
	if err := json.Unmarshal([]byte(`["Acme",{"term":"cheap","reason":"Off brand","matchMode":"phrase"},{"term":"x"}]`), &terms); err != nil {
		t.Fatal(err)
	}
	if terms[0] != (ProhibitedTerm{Term: "Acme", MatchMode: MatchWord}) ||
		terms[1] != (ProhibitedTerm{Term: "cheap", Reason: "Off brand", MatchMode: MatchPhrase}) ||
		terms[2].MatchMode != MatchWord {
		t.Fatalf("terms=%+v", terms)
	}
	if err := json.Unmarshal([]byte(`[{"term":"a","extra":true}]`), &terms); err == nil {
		t.Fatal("unknown field accepted")
	}
	if _, err := NormalizeTerms([]ProhibitedTerm{{Term: "a", MatchMode: "regex"}}); err == nil {
		t.Fatal("unknown match mode accepted")
	}
	if _, err := NormalizeTerms([]ProhibitedTerm{{Term: "  "}}); err == nil {
		t.Fatal("empty term accepted")
	}
	normalized, err := NormalizeTerms([]ProhibitedTerm{{Term: " Acme "}, {Term: "ACME"}, {Term: "acme", MatchMode: MatchPhrase}})
	if err != nil || len(normalized) != 2 || normalized[0].Term != "Acme" || normalized[0].MatchMode != MatchWord {
		t.Fatalf("normalized=%+v err=%v", normalized, err)
	}
}
