package helpers

import "strings"

// StripTags is the striptags@3 npm package: removes tags except allowed ones,
// drops comments, ignores '<' and '>' inside quoted attribute values and an
// unterminated trailing tag.
func StripTags(html string, allowed []string) string {
	allowable := make(map[string]bool, len(allowed))
	for _, t := range allowed {
		allowable[t] = true
	}

	const (
		plaintext = iota
		inHTML
		comment
	)
	state := plaintext
	var tagBuffer, output strings.Builder
	depth := 0
	var inQuoteChar byte

	for i := 0; i < len(html); i++ {
		char := html[i]
		switch state {
		case plaintext:
			if char == '<' {
				state = inHTML
				tagBuffer.WriteByte(char)
			} else {
				output.WriteByte(char)
			}
		case inHTML:
			switch char {
			case '<':
				// ignore '<' if inside a quote
				if inQuoteChar != 0 {
					break
				}
				// we're seeing a nested '<'
				depth++
			case '>':
				// ignore '>' if inside a quote
				if inQuoteChar != 0 {
					break
				}
				// something like this is happening: '<<>>'
				if depth > 0 {
					depth--
					break
				}
				// this is closing the tag in tag_buffer
				inQuoteChar = 0
				state = plaintext
				tagBuffer.WriteByte('>')
				if tag, ok := normalizeTag(tagBuffer.String()); ok && allowable[tag] {
					output.WriteString(tagBuffer.String())
				}
				tagBuffer.Reset()
			case '"', '\'':
				// catch both single and double quotes
				if char == inQuoteChar {
					inQuoteChar = 0
				} else if inQuoteChar == 0 {
					inQuoteChar = char
				}
				tagBuffer.WriteByte(char)
			case '-':
				if tagBuffer.String() == "<!-" {
					state = comment
				}
				tagBuffer.WriteByte(char)
			case ' ', '\n':
				if tagBuffer.String() == "<" {
					state = plaintext
					output.WriteString("< ")
					tagBuffer.Reset()
					break
				}
				tagBuffer.WriteByte(char)
			default:
				tagBuffer.WriteByte(char)
			}
		case comment:
			if char == '>' {
				if strings.HasSuffix(tagBuffer.String(), "--") {
					// close the comment
					state = plaintext
				}
				tagBuffer.Reset()
			} else {
				tagBuffer.WriteByte(char)
			}
		}
	}
	return output.String()
}

// normalizeTag is /<\/?([^\s\/>]+)/ lowercased. The buffer always starts with
// its only '<', so the match can only start there.
func normalizeTag(tagBuffer string) (string, bool) {
	rest := strings.TrimPrefix(tagBuffer, "<")
	name := func(s string) string {
		end := strings.IndexFunc(s, func(r rune) bool { return r == '/' || r == '>' || isJSSpace(r) })
		if end < 0 {
			return s
		}
		return s[:end]
	}
	n := name(strings.TrimPrefix(rest, "/"))
	if n == "" {
		return "", false
	}
	return strings.ToLower(n), true
}
