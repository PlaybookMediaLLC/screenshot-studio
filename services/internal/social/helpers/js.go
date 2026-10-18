package helpers

import (
	"regexp"
	"strings"
	"unicode/utf16"
)

// Helpers reproducing the JavaScript string semantics the ported utils rely on.

// jsDot is JavaScript's `.`: anything but a line terminator.
const jsDot = `[^\n\r\x{2028}\x{2029}]`

// jsSpace is JavaScript's `\s` (WhiteSpace + LineTerminator).
const jsSpace = `[\t\n\v\f\r \x{a0}\x{1680}\x{2000}-\x{200a}\x{2028}\x{2029}\x{202f}\x{205f}\x{3000}\x{feff}]`

func isJSSpace(r rune) bool {
	switch r {
	case '\t', '\n', '\v', '\f', '\r', ' ', 0xa0, 0x1680, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff:
		return true
	}
	return r >= 0x2000 && r <= 0x200a
}

// jsTrim is String.prototype.trim.
func jsTrim(s string) string { return strings.TrimFunc(s, isJSSpace) }

// utf16Units returns s as UTF-16 code units, one per rune, so regexp2 sees
// exactly what a non-unicode JavaScript RegExp sees.
func utf16Units(s string) []rune {
	u := utf16.Encode([]rune(s))
	out := make([]rune, len(u))
	for i, c := range u {
		out[i] = rune(c)
	}
	return out
}

// jsLength is String.prototype.length (UTF-16 code units).
func jsLength(s string) int { return len(utf16.Encode([]rune(s))) }

// replaceFunc is String.prototype.replace(globalRegExp, fn); m[0] is the
// match, m[i] group i ("" when it did not participate).
func replaceFunc(re *regexp.Regexp, s string, fn func(m []string) string) string {
	matches := re.FindAllStringSubmatchIndex(s, -1)
	if matches == nil {
		return s
	}
	var b strings.Builder
	last := 0
	for _, idx := range matches {
		b.WriteString(s[last:idx[0]])
		m := make([]string, len(idx)/2)
		for i := range m {
			if idx[2*i] >= 0 {
				m[i] = s[idx[2*i]:idx[2*i+1]]
			}
		}
		b.WriteString(fn(m))
		last = idx[1]
	}
	b.WriteString(s[last:])
	return b.String()
}

// jsReplaceString is String.prototype.replace(string, string): the first
// occurrence only, with $$, $&, $` and $' expanded in the replacement.
func jsReplaceString(s, pattern, replacement string) string {
	i := strings.Index(s, pattern)
	if i < 0 {
		return s
	}
	var b strings.Builder
	b.WriteString(s[:i])
	for j := 0; j < len(replacement); j++ {
		if replacement[j] != '$' || j+1 == len(replacement) {
			b.WriteByte(replacement[j])
			continue
		}
		switch replacement[j+1] {
		case '$':
			b.WriteByte('$')
		case '&':
			b.WriteString(pattern)
		case '`':
			b.WriteString(s[:i])
		case '\'':
			b.WriteString(s[i+len(pattern):])
		default:
			b.WriteByte('$')
			continue
		}
		j++
	}
	b.WriteString(s[i+len(pattern):])
	return b.String()
}
