package onboarding

import (
	"bytes"
	"encoding/json"
	"net/url"
	"regexp"
	"strings"

	"golang.org/x/net/html"
)

// Document is what onboarding reads from one HTML page: its metadata, its
// same-site links, and the text a reader would see. Text that was in the
// page but hidden from readers is kept aside in Hidden, never in Text.
type Document struct {
	Description string
	Hidden      string
	Icons       []string
	JSONLD      []map[string]any
	Links       []string
	// Meta maps lower-cased name or property to content, first one wins.
	Meta  map[string]string
	Text  string
	Title string
	// TouchIcon is the apple-touch-icon, usually the square logo.
	TouchIcon string
}

var (
	skippedElements = map[string]bool{"script": true, "style": true, "noscript": true, "template": true, "svg": true, "iframe": true, "object": true, "head": true}
	blockElements   = map[string]bool{"p": true, "div": true, "section": true, "article": true, "header": true, "footer": true, "li": true, "tr": true,
		"h1": true, "h2": true, "h3": true, "h4": true, "h5": true, "h6": true, "ul": true, "ol": true, "table": true, "pre": true, "blockquote": true, "br": true, "hr": true, "main": true, "nav": true}
	hiddenStyle = regexp.MustCompile(`(?i)display\s*:\s*none|visibility\s*:\s*hidden|font-size\s*:\s*0`)
	spaces      = regexp.MustCompile(`[ \t]+`)
	blankLines  = regexp.MustCompile(`\n{3,}`)
)

func attribute(token html.Token, name string) (string, bool) {
	for _, attr := range token.Attr {
		if attr.Key == name {
			return strings.TrimSpace(attr.Val), true
		}
	}
	return "", false
}

func hiddenElement(token html.Token) bool {
	if _, ok := attribute(token, "hidden"); ok {
		return true
	}
	if value, _ := attribute(token, "aria-hidden"); strings.EqualFold(value, "true") {
		return true
	}
	style, _ := attribute(token, "style")
	return hiddenStyle.MatchString(style)
}

func resolve(base *url.URL, href string) string {
	if base == nil || href == "" {
		return ""
	}
	target, err := base.Parse(href)
	if err != nil || (target.Scheme != "http" && target.Scheme != "https") {
		return ""
	}
	target.Fragment = ""
	return target.String()
}

func cleanText(value string) string {
	value = spaces.ReplaceAllString(StripInvisible(value), " ")
	lines := strings.Split(value, "\n")
	for i, line := range lines {
		lines[i] = strings.TrimSpace(line)
	}
	return strings.TrimSpace(blankLines.ReplaceAllString(strings.Join(lines, "\n"), "\n\n"))
}

// ParseHTML reads a page. pageURL resolves relative links and icons.
func ParseHTML(body []byte, pageURL string) *Document {
	base, _ := url.Parse(pageURL)
	doc := &Document{Meta: map[string]string{}}
	var text, hidden, title strings.Builder
	tokenizer := html.NewTokenizer(bytes.NewReader(body))
	// skip and hide count the open elements whose text is dropped or set aside.
	var skipStack, hiddenStack []string
	inTitle, inJSONLD := false, false
	seenLinks := map[string]bool{}
	for {
		kind := tokenizer.Next()
		if kind == html.ErrorToken {
			break
		}
		token := tokenizer.Token()
		name := token.Data
		switch kind {
		case html.StartTagToken, html.SelfClosingTagToken:
			switch name {
			case "title":
				inTitle = kind == html.StartTagToken
			case "meta":
				content, _ := attribute(token, "content")
				for _, key := range []string{"name", "property", "itemprop"} {
					if value, ok := attribute(token, key); ok && value != "" && content != "" {
						if _, seen := doc.Meta[strings.ToLower(value)]; !seen {
							doc.Meta[strings.ToLower(value)] = content
						}
						break
					}
				}
			case "link":
				rel, _ := attribute(token, "rel")
				href, _ := attribute(token, "href")
				rel, icon := strings.ToLower(rel), resolve(base, href)
				switch {
				case icon == "" || !strings.Contains(rel, "icon"):
				case strings.Contains(rel, "apple-touch"):
					doc.TouchIcon = firstNonEmpty(doc.TouchIcon, icon)
				default:
					doc.Icons = append(doc.Icons, icon)
				}
			case "a":
				href, _ := attribute(token, "href")
				if link := resolve(base, href); link != "" && !seenLinks[link] && len(doc.Links) < 500 {
					seenLinks[link] = true
					doc.Links = append(doc.Links, link)
				}
			case "script":
				kindAttr, _ := attribute(token, "type")
				inJSONLD = strings.EqualFold(kindAttr, "application/ld+json")
			}
			if kind == html.SelfClosingTagToken || voidElement(name) {
				if blockElements[name] {
					text.WriteString("\n")
				}
				continue
			}
			if skippedElements[name] {
				skipStack = append(skipStack, name)
			} else if len(skipStack) == 0 && hiddenElement(token) {
				hiddenStack = append(hiddenStack, name)
			}
			if len(skipStack) == 0 && len(hiddenStack) == 0 {
				switch {
				case len(name) == 2 && name[0] == 'h' && name[1] >= '1' && name[1] <= '6':
					text.WriteString("\n" + strings.Repeat("#", int(name[1]-'0')) + " ")
				case name == "li":
					text.WriteString("\n- ")
				case blockElements[name]:
					text.WriteString("\n")
				}
			}
		case html.EndTagToken:
			if name == "title" {
				inTitle = false
			}
			if name == "script" {
				inJSONLD = false
			}
			if n := len(skipStack); n > 0 && skipStack[n-1] == name {
				skipStack = skipStack[:n-1]
			} else if n := len(hiddenStack); n > 0 && hiddenStack[n-1] == name {
				hiddenStack = hiddenStack[:n-1]
			}
			if blockElements[name] && len(skipStack) == 0 {
				text.WriteString("\n")
			}
		case html.TextToken:
			value := token.Data
			switch {
			case inTitle:
				title.WriteString(value)
			case inJSONLD:
				var parsed any
				if json.Unmarshal([]byte(value), &parsed) == nil && len(doc.JSONLD) < 10 {
					collectJSONLD(parsed, &doc.JSONLD)
				}
			case len(skipStack) > 0:
			case len(hiddenStack) > 0:
				hidden.WriteString(value + " ")
			default:
				text.WriteString(value)
			}
		case html.CommentToken:
			hidden.WriteString(token.Data + "\n")
		}
	}
	doc.Title = strings.Join(strings.Fields(StripInvisible(title.String())), " ")
	doc.Text = cleanText(text.String())
	doc.Hidden = cleanText(hidden.String())
	doc.Description = firstNonEmpty(doc.Meta["og:description"], doc.Meta["description"], doc.Meta["twitter:description"])
	return doc
}

func voidElement(name string) bool {
	switch name {
	case "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr":
		return true
	}
	return false
}

func collectJSONLD(node any, out *[]map[string]any) {
	switch value := node.(type) {
	case []any:
		for _, item := range value {
			collectJSONLD(item, out)
		}
	case map[string]any:
		if graph, ok := value["@graph"]; ok {
			collectJSONLD(graph, out)
		}
		if _, ok := value["@type"]; ok && len(*out) < 20 {
			*out = append(*out, value)
		}
	}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value = strings.TrimSpace(value); value != "" {
			return value
		}
	}
	return ""
}
