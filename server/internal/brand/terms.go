// Package brand holds the workspace brand rules the backend enforces on copy:
// prohibited terms and how they match (docs/rfcs/019-brand-profile.md).
package brand

import (
	"bytes"
	"encoding/json"
	"errors"
	"strings"
	"unicode"
	"unicode/utf8"

	"golang.org/x/text/cases"
	"golang.org/x/text/unicode/norm"
)

// Match modes. MatchWord matches the term only between word boundaries, so
// "Acme" matches "Acme's" and not "Acmeville". MatchPhrase matches the term
// anywhere, including inside a longer word.
const (
	MatchWord   = "word"
	MatchPhrase = "phrase"
)

// ProhibitedTerm is one term a workspace never publishes, with the reason the
// author sees when copy is blocked.
type ProhibitedTerm struct {
	MatchMode string `json:"matchMode"`
	Reason    string `json:"reason,omitempty"`
	Term      string `json:"term"`
}

// UnmarshalJSON accepts the structured form and a bare string, the legacy
// form, which becomes a word-mode term with no reason.
func (t *ProhibitedTerm) UnmarshalJSON(data []byte) error {
	var legacy string
	if json.Unmarshal(data, &legacy) == nil {
		*t = ProhibitedTerm{MatchMode: MatchWord, Term: legacy}
		return nil
	}
	var structured struct {
		MatchMode *string `json:"matchMode"`
		Reason    *string `json:"reason"`
		Term      string  `json:"term"`
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&structured); err != nil {
		return err
	}
	*t = ProhibitedTerm{MatchMode: MatchWord, Term: structured.Term}
	if structured.MatchMode != nil {
		t.MatchMode = *structured.MatchMode
	}
	if structured.Reason != nil {
		t.Reason = *structured.Reason
	}
	return nil
}

// ErrInvalidTerm reports a term outside the limits below.
var ErrInvalidTerm = errors.New("invalid prohibited term")

// MaxTerms bounds a workspace's list.
const MaxTerms = 200

// NormalizeTerms trims each term and reason, rejects empty, oversized, or
// unknown-mode entries, and drops duplicates.
func NormalizeTerms(terms []ProhibitedTerm) ([]ProhibitedTerm, error) {
	if len(terms) > MaxTerms {
		return nil, ErrInvalidTerm
	}
	result := make([]ProhibitedTerm, 0, len(terms))
	seen := map[string]bool{}
	for _, term := range terms {
		term.Term, term.Reason = strings.TrimSpace(term.Term), strings.TrimSpace(term.Reason)
		if term.MatchMode == "" {
			term.MatchMode = MatchWord
		}
		if term.Term == "" || utf8.RuneCountInString(term.Term) > 100 || utf8.RuneCountInString(term.Reason) > 300 ||
			(term.MatchMode != MatchWord && term.MatchMode != MatchPhrase) {
			return nil, ErrInvalidTerm
		}
		key := term.MatchMode + "\x00" + normalize(term.Term)
		if seen[key] {
			continue
		}
		seen[key] = true
		result = append(result, term)
	}
	return result, nil
}

// TermMatch is a prohibited term found in copy.
type TermMatch struct {
	MatchMode string `json:"matchMode"`
	Reason    string `json:"reason,omitempty"`
	Term      string `json:"term"`
}

// normalize applies NFKC, Unicode case folding, and collapses whitespace
// runs, so full-width letters, ligatures, case, and doubled spaces do not
// evade a term. It is not adversarial filtering.
func normalize(text string) string {
	folded := cases.Fold().String(norm.NFKC.String(text))
	return strings.Join(strings.Fields(folded), " ")
}

func isWordRune(r rune) bool {
	return unicode.IsLetter(r) || unicode.IsDigit(r) || unicode.IsMark(r) || r == '_'
}

// contains reports whether term occurs in text, both normalized. In word mode
// the characters on either side of an occurrence must not be word characters.
func contains(text, term, mode string) bool {
	if term == "" {
		return false
	}
	for offset := 0; offset <= len(text)-len(term); {
		index := strings.Index(text[offset:], term)
		if index < 0 {
			return false
		}
		start, end := offset+index, offset+index+len(term)
		if mode == MatchPhrase {
			return true
		}
		before, _ := utf8.DecodeLastRuneInString(text[:start])
		after, _ := utf8.DecodeRuneInString(text[end:])
		if (start == 0 || !isWordRune(before)) && (end == len(text) || !isWordRune(after)) {
			return true
		}
		_, size := utf8.DecodeRuneInString(text[start:])
		offset = start + size
	}
	return false
}

// Check returns each term found in any of texts, once, in list order.
func Check(terms []ProhibitedTerm, texts ...string) []TermMatch {
	normalized := make([]string, 0, len(texts))
	for _, text := range texts {
		if text != "" {
			normalized = append(normalized, normalize(text))
		}
	}
	matches := []TermMatch{}
	for _, term := range terms {
		needle := normalize(term.Term)
		for _, text := range normalized {
			if contains(text, needle, term.MatchMode) {
				matches = append(matches, TermMatch{MatchMode: term.MatchMode, Reason: term.Reason, Term: term.Term})
				break
			}
		}
	}
	return matches
}
