package product

import (
	"strings"
	"unicode"
	"unicode/utf8"

	"golang.org/x/text/unicode/norm"
)

// NormalizeWorkspaceName defines the same Unicode display-name policy used by
// browser forms: NFC, trimmed whitespace, 2..100 scalar values, and no controls
// or directional formatting. Joiners in international text and emoji are allowed.
func NormalizeWorkspaceName(value string) (string, error) {
	if !utf8.ValidString(value) {
		return "", ErrInvalidInput
	}
	value = norm.NFC.String(strings.TrimFunc(value, func(r rune) bool { return unicode.IsSpace(r) || r == '\uFEFF' }))
	if count := utf8.RuneCountInString(value); count < 2 || count > 100 {
		return "", ErrInvalidInput
	}
	visible := false
	for _, r := range value {
		format := unicode.Is(unicode.Cf, r)
		if r == utf8.RuneError || unicode.IsControl(r) || (format && r != '\u200c' && r != '\u200d') {
			return "", ErrInvalidInput
		}
		if !unicode.IsSpace(r) && !unicode.IsMark(r) && !format {
			visible = true
		}
	}
	if !visible {
		return "", ErrInvalidInput
	}
	return value, nil
}
