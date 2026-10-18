package product

import (
	"regexp"
	"strings"
	"unicode/utf16"
)

// xLinkLength is X's length for one link, whatever its real length.
const xLinkLength = 23

var (
	xLink     = regexp.MustCompile(`(?i)(?:https?://|www\.)[^\s]+`)
	xTrailing = regexp.MustCompile(`[.,!?;:)'"\]]+$`)
	xLight    = [][2]rune{{0, 4351}, {8192, 8205}, {8208, 8223}, {8242, 8247}}
)

// xLength is a post's length as X counts it (twitter-text v3), the same way
// lib/content-drafts/x-length.ts does: links are 23, most Latin text 1 per
// character, everything else 2, and an emoji sequence counts once.
func xLength(text string) int {
	length, last := 0, 0
	for _, match := range xLink.FindAllStringIndex(text, -1) {
		link := xTrailing.ReplaceAllString(text[match[0]:match[1]], "")
		length += xTextLength(text[last:match[0]]) + xLinkLength
		last = match[0] + len(link)
	}
	return length + xTextLength(text[last:])
}

func xTextLength(text string) int {
	length, joined, flag := 0, false, false
	for _, code := range text {
		if code == 0x200d {
			joined = true
			continue
		}
		if xModifier(code) {
			continue
		}
		regional := code >= 0x1f1e6 && code <= 0x1f1ff
		if regional && flag {
			flag = false
			continue
		}
		flag = regional
		if (xPictographic(code) || regional) && joined {
			joined = false
			continue
		}
		joined = false
		length += 2
		for _, span := range xLight {
			if code >= span[0] && code <= span[1] {
				length--
				break
			}
		}
	}
	return length
}

func xPictographic(code rune) bool {
	return code >= 0x1f000 && code <= 0x1faff || code >= 0x2600 && code <= 0x27bf ||
		code >= 0x2300 && code <= 0x23ff || code >= 0x2b00 && code <= 0x2bff
}

func xModifier(code rune) bool {
	return code == 0xfe0e || code == 0xfe0f || code >= 0x1f3fb && code <= 0x1f3ff ||
		code >= 0xe0020 && code <= 0xe007f || code == 0x20e3
}

// draftPostLength is a draft post's length on its channel: X's own count on
// X, UTF-16 units elsewhere (as the campaign path counts).
func draftPostLength(channel, text string) int {
	if channel == "x" {
		return xLength(strings.TrimSpace(text))
	}
	return len(utf16.Encode([]rune(text)))
}
