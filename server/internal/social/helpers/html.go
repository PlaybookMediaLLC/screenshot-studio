package helpers

import (
	"regexp"
	"strings"
)

// StripOptions are stripHtmlValidation's optional positional arguments.
type StripOptions struct {
	ReplaceBold    bool
	None           bool
	Plain          bool
	ConvertMention func(idOrHandle, name string) string
	InlineImages   bool
}

var bold = map[rune]string{
	'a': "𝗮", 'b': "𝗯", 'c': "𝗰", 'd': "𝗱", 'e': "𝗲", 'f': "𝗳", 'g': "𝗴", 'h': "𝗵", 'i': "𝗶",
	'j': "𝗷", 'k': "𝗸", 'l': "𝗹", 'm': "𝗺", 'n': "𝗻", 'o': "𝗼", 'p': "𝗽", 'q': "𝗾", 'r': "𝗿",
	's': "𝘀", 't': "𝘁", 'u': "𝘂", 'v': "𝘃", 'w': "𝘄", 'x': "𝘅", 'y': "𝘆", 'z': "𝘇",
	'A': "𝗔", 'B': "𝗕", 'C': "𝗖", 'D': "𝗗", 'E': "𝗘", 'F': "𝗙", 'G': "𝗚", 'H': "𝗛", 'I': "𝗜",
	'J': "𝗝", 'K': "𝗞", 'L': "𝗟", 'M': "𝗠", 'N': "𝗡", 'O': "𝗢", 'P': "𝗣", 'Q': "𝗤", 'R': "𝗥",
	'S': "𝗦", 'T': "𝗧", 'U': "𝗨", 'V': "𝗩", 'W': "𝗪", 'X': "𝗫", 'Y': "𝗬", 'Z': "𝗭",
	'1': "𝟭", '2': "𝟮", '3': "𝟯", '4': "𝟰", '5': "𝟱", '6': "𝟲", '7': "𝟳", '8': "𝟴", '9': "𝟵", '0': "𝟬",
}

// underlineMap appends U+0332 COMBINING LOW LINE to every letter and digit.
func underline(r rune) (string, bool) {
	if r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' {
		return string(r) + "̲", true
	}
	return "", false
}

func ci(entity string) *regexp.Regexp { return regexp.MustCompile(`(?i)` + regexp.QuoteMeta(entity)) }

var (
	gtRe   = ci("&gt;")
	ltRe   = ci("&lt;")
	ampRe  = ci("&amp;")
	nbspRe = ci("&nbsp;")
	quotRe = ci("&quot;")
	aposRe = ci("&#39;")

	boldLtRe      = regexp.MustCompile(`&𝗹𝘁;`)
	boldGtRe      = regexp.MustCompile(`&𝗴𝘁;`)
	underlineGtRe = regexp.MustCompile(`(?i)&g̲t̲;`)
	underlineLtRe = regexp.MustCompile(`(?i)&l̲t̲;`)

	h1Re       = regexp.MustCompile(`<h1[^>]*>([\s\S]*?)</h1>`)
	h2Re       = regexp.MustCompile(`<h2[^>]*>([\s\S]*?)</h2>`)
	h3Re       = regexp.MustCompile(`<h3[^>]*>([\s\S]*?)</h3>`)
	uRe        = regexp.MustCompile(`<u>([\s\S]*?)</u>`)
	strongRe   = regexp.MustCompile(`<strong>([\s\S]*?)</strong>`)
	liRe       = regexp.MustCompile(`<li` + jsDot + `*?>([\s\S]*?)</li` + jsDot + `*?>`)
	pBlockRe   = regexp.MustCompile(`<p[^>]*>([\s\S]*?)</p>`)
	anchorRe   = regexp.MustCompile(`<a` + jsDot + `*?href="([\s\S]*?)"` + jsDot + `*?>([\s\S]*?)</a>`)
	newlineRe  = regexp.MustCompile(`\n`)
	hasPRe     = regexp.MustCompile(`(?i)<p(?:` + jsSpace + `|>)`)
	firstPRe   = regexp.MustCompile(`(?i)^<p[^>]*>`)
	pOpenRe    = regexp.MustCompile(`(?i)<p[^>]*>`)
	pCloseRe   = regexp.MustCompile(`(?i)</p>`)
	imgRe      = regexp.MustCompile(`(?i)<img\b[^>]*>`)
	imgSrcRe   = regexp.MustCompile(`(?i)` + jsSpace + `src="(https?://[^"]*)"`)
	imgAltRe   = regexp.MustCompile(`(?i)` + jsSpace + `alt="([^"]*)"`)
	mentionRe  = regexp.MustCompile(`(?i)<span` + jsDot + `*?data-mention-id="([\s\S]*?)"[\s\S]*?>([\s\S]*?)</span>`)
	strongLnRe = regexp.MustCompile(`(?i)<strong>(` + jsDot + `+?)</strong>`)
	uLnRe      = regexp.MustCompile(`(?i)<u>(` + jsDot + `+?)</u>`)
)

// decodeEntities runs the .replace(/&x;/gi, ...) chains, in order.
func decodeEntities(s string, pairs ...any) string {
	for i := 0; i < len(pairs); i += 2 {
		s = pairs[i].(*regexp.Regexp).ReplaceAllLiteralString(s, pairs[i+1].(string))
	}
	return s
}

// StripHTMLValidation converts editor HTML to what a provider accepts.
// editorType is none | normal | markdown | html.
func StripHTMLValidation(editorType, val string, opts StripOptions) string {
	if opts.Plain {
		return val
	}

	value := serializeFragment(parseFragment(val))

	if editorType == "none" {
		return decodeEntities(StripTags(value, nil),
			gtRe, ">", ltRe, "<", ampRe, "&", nbspRe, " ", quotRe, `"`, aposRe, "'")
	}

	if editorType == "html" {
		v := value
		allowed := []string{"ul", "li", "h1", "h2", "h3", "p", "strong", "u", "a"}
		if opts.InlineImages {
			v = ConvertImages(value)
			allowed = append(allowed, "img")
		}
		return decodeEntities(StripTags(ConvertMention(v, opts.ConvertMention), allowed),
			gtRe, ">", ltRe, "<", ampRe, "&", nbspRe, " ", quotRe, `"`, aposRe, "'")
	}

	if editorType == "markdown" {
		v := replaceFunc(h1Re, value, func(m []string) string { return "<h1># " + m[1] + "</h1>\n" })
		v = decodeEntities(v, ampRe, "&", nbspRe, " ", quotRe, `"`, aposRe, "'")
		v = replaceFunc(h2Re, v, func(m []string) string { return "<h2>## " + m[1] + "</h2>\n" })
		v = replaceFunc(h3Re, v, func(m []string) string { return "<h3>### " + m[1] + "</h3>\n" })
		v = replaceFunc(uRe, v, func(m []string) string { return "<u>__" + m[1] + "__</u>" })
		v = replaceFunc(strongRe, v, func(m []string) string { return "<strong>**" + m[1] + "**</strong>" })
		v = replaceFunc(liRe, v, func(m []string) string {
			return "<li>- " + newlineRe.ReplaceAllString(m[1], "") + "</li>"
		})
		v = replaceFunc(pBlockRe, v, func(m []string) string { return "<p>" + m[1] + "</p>\n" })
		v = replaceFunc(anchorRe, v, func(m []string) string {
			return `<a href="` + m[1] + `">[` + m[2] + "](" + m[1] + ")</a>"
		})
		return decodeEntities(StripTags(ConvertMention(v, opts.ConvertMention), nil), gtRe, ">", ltRe, "<")
	}

	if !hasPRe.MatchString(value) && !opts.None {
		return value
	}

	html := decodeEntities(value, ampRe, "&", nbspRe, " ", quotRe, `"`, aposRe, "'")
	html = firstPRe.ReplaceAllLiteralString(html, "")
	html = pOpenRe.ReplaceAllLiteralString(html, "\n")
	html = pCloseRe.ReplaceAllLiteralString(html, "")

	if opts.None {
		return decodeEntities(StripTags(html, nil), gtRe, ">", ltRe, "<")
	}

	if opts.ReplaceBold {
		v := replaceFunc(anchorRe, html, func(m []string) string {
			return `<a href="` + m[1] + `">` + m[1] + "</a>"
		})
		v = strings.Replace(v, "<ul>", "\n<ul>", 1)
		v = strings.Replace(v, "</ul>\n", "</ul>", 1)
		v = replaceFunc(liRe, v, func(m []string) string {
			return "<li><p>- " + newlineRe.ReplaceAllString(m[1], "") + "\n</p></li>"
		})
		processed := ConvertMention(ConvertToASCII(v), opts.ConvertMention)

		return decodeEntities(StripTags(processed, nil),
			gtRe, ">", ltRe, "<", boldLtRe, "<", boldGtRe, ">", underlineGtRe, ">", underlineLtRe, "<")
	}

	// Strip all other tags
	return decodeEntities(StripTags(html, []string{"ul", "li", "h1", "h2", "h3"}), gtRe, ">", ltRe, "<")
}

// ConvertImages keeps only an http(s) src and the alt of a picture, a value
// holding a quote is dropped since &quot; is decoded afterwards and would
// close the attribute.
func ConvertImages(value string) string {
	return imgRe.ReplaceAllStringFunc(value, func(match string) string {
		src := imgSrcRe.FindStringSubmatch(match)
		if src == nil || src[1] == "" || strings.Contains(src[1], "&quot;") {
			return ""
		}
		out := `<img src="` + src[1] + `"`
		if alt := imgAltRe.FindStringSubmatch(match); alt != nil && alt[1] != "" && !strings.Contains(alt[1], "&quot;") {
			out += ` alt="` + alt[1] + `"`
		}
		return out + ">"
	})
}

func ConvertMention(value string, process func(idOrHandle, name string) string) string {
	if process == nil {
		return value
	}
	return replaceFunc(mentionRe, value, func(m []string) string {
		return "<span>" + process(m[1], m[2]) + "</span>"
	})
}

func ConvertToASCII(value string) string {
	value = replaceFunc(strongLnRe, value, func(m []string) string {
		var b strings.Builder
		for _, r := range m[1] {
			if s, ok := bold[r]; ok {
				b.WriteString(s)
			} else {
				b.WriteRune(r)
			}
		}
		return jsReplaceString(m[0], m[1], b.String())
	})
	return replaceFunc(uLnRe, value, func(m []string) string {
		var b strings.Builder
		for _, r := range m[1] {
			if s, ok := underline(r); ok {
				b.WriteString(s)
			} else {
				b.WriteRune(r)
			}
		}
		return jsReplaceString(m[0], m[1], b.String())
	})
}
