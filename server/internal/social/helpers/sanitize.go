package helpers

import (
	"regexp"
	"strings"

	"golang.org/x/net/html"
)

// DOMPurify (isomorphic-dompurify, jsdom) with the post content allow-list
// config, ported to x/net/html. Only the parts of DOMPurify's algorithm this
// config can reach are kept.

var sanitizeAllowedTags = map[string]bool{
	"p": true, "br": true, "strong": true, "u": true, "a": true, "ul": true, "li": true,
	"h1": true, "h2": true, "h3": true, "span": true, "img": true, "#text": true,
}

var sanitizeAllowedAttr = map[string]bool{
	"dir": true, "href": true, "target": true, "rel": true, "class": true,
	"data-mention-id": true, "data-mention-label": true, "src": true, "alt": true,
}

// DOMPurify's DEFAULT_FORBID_CONTENTS: removed with their children instead
// of being unwrapped.
var forbidContents = map[string]bool{
	"annotation-xml": true, "audio": true, "colgroup": true, "desc": true, "foreignobject": true,
	"head": true, "iframe": true, "math": true, "mi": true, "mn": true, "mo": true, "ms": true,
	"mtext": true, "noembed": true, "noframes": true, "noscript": true, "plaintext": true,
	"script": true, "selectedcontent": true, "style": true, "svg": true, "template": true,
	"thead": true, "title": true, "video": true, "xmp": true,
}

var uriSafeAttributes = map[string]bool{
	"alt": true, "class": true, "for": true, "id": true, "label": true, "name": true,
	"pattern": true, "placeholder": true, "role": true, "summary": true, "title": true,
	"value": true, "style": true, "xmlns": true,
}

var dataURITags = map[string]bool{"audio": true, "video": true, "img": true, "source": true, "image": true, "track": true}

var (
	allowedURIRe        = regexp.MustCompile(`(?i)^(?:https?:|mailto:|/|#)`)
	attrWhitespaceRe    = regexp.MustCompile(`[\x{0000}-\x{0020}\x{00A0}\x{1680}\x{180E}\x{2000}-\x{2029}\x{205F}\x{3000}]`)
	elementMarkupProbe  = regexp.MustCompile(`<[/\w!]`)
	safeForXMLAttrRe    = regexp.MustCompile(`(?i)((--!?|])>)|</(style|script|title|xmp|textarea|noscript|iframe|noembed|noframes)`)
	ariaAttrRe          = regexp.MustCompile(`^aria-[\-\w]+$`)
	httpImageSrcRe      = regexp.MustCompile(`(?i)^https?://`)
	leadingWhitespaceRe = regexp.MustCompile(`^[\r\n\t ]+`)
)

// isDataAttr is /^data-[\-\w.·-￿]+$/ (astral characters are
// surrogates, inside the range).
func isDataAttr(name string) bool {
	rest, ok := strings.CutPrefix(name, "data-")
	if !ok || rest == "" {
		return false
	}
	for _, r := range rest {
		if !(r == '-' || r == '_' || r == '.' || r >= '0' && r <= '9' || r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= 0xb7) {
			return false
		}
	}
	return true
}

// SanitizePostContent sanitizes post HTML with the DOMPurify allow-list.
func SanitizePostContent(value string) string {
	if value == "" {
		return ""
	}
	if !strings.Contains(value, "<") {
		return value
	}

	// DOMParser documents have scripting disabled (<noscript> is markup)
	doc, err := html.ParseWithOptions(strings.NewReader(value), html.ParseOptionEnableScripting(false))
	if err != nil {
		return ""
	}
	body := findBody(doc)
	if body == nil {
		return ""
	}
	fixAttrs(body, sourceAttrOrders(value, false))
	if ws := leadingWhitespaceRe.FindString(value); ws != "" {
		body.InsertBefore(&html.Node{Type: html.TextNode, Data: ws}, body.FirstChild)
	}

	// Walk like DOMPurify's NodeIterator: after a removal the walk resumes at
	// the node that followed it (or at its first hoisted child).
	for n := nextInTree(body, body); n != nil; {
		n = sanitizeNode(n, body)
	}

	var b strings.Builder
	serializeChildren(&b, body)
	return b.String()
}

func findBody(n *html.Node) *html.Node {
	if n.Type == html.ElementNode && n.Data == "body" && n.Namespace == "" {
		return n
	}
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		if b := findBody(c); b != nil {
			return b
		}
	}
	return nil
}

func nextInTree(n, root *html.Node) *html.Node {
	if n.FirstChild != nil {
		return n.FirstChild
	}
	return followingInTree(n, root)
}

func followingInTree(n, root *html.Node) *html.Node {
	for ; n != nil && n != root; n = n.Parent {
		if n.NextSibling != nil {
			return n.NextSibling
		}
	}
	return nil
}

// sanitizeNode is _sanitizeElements + _sanitizeAttributes; it returns the
// next node to visit.
func sanitizeNode(n, root *html.Node) *html.Node {
	following := followingInTree(n, root)

	tagName := "#text"
	switch n.Type {
	case html.ElementNode:
		tagName = strings.ToLower(n.Data)
	case html.CommentNode:
		tagName = "#comment"
	case html.TextNode:
	default:
		tagName = "#unknown"
	}

	// uponSanitizeElement hook: <img> keeps data: URIs whatever
	// ALLOWED_URI_REGEXP says, so a picture that doesn't point to a real
	// file is dropped
	if tagName == "img" && !httpImageSrcRe.MatchString(getAttr(n, "src")) {
		n.Parent.RemoveChild(n)
		return following
	}

	// _isUnsafeNode: markup hiding in an element that only holds text
	if n.FirstChild != nil && !hasElementChild(n) && elementMarkupProbe.MatchString(textContent(n)) {
		var inner strings.Builder
		serializeChildren(&inner, n)
		if elementMarkupProbe.MatchString(inner.String()) {
			n.Parent.RemoveChild(n)
			return following
		}
	}

	if !sanitizeAllowedTags[tagName] {
		var first *html.Node
		if !forbidContents[tagName] {
			// KEEP_CONTENT: hoist the children in place of the element
			for c := n.FirstChild; c != nil; {
				next := c.NextSibling
				n.RemoveChild(c)
				n.Parent.InsertBefore(c, n)
				if first == nil {
					first = c
				}
				c = next
			}
		}
		n.Parent.RemoveChild(n)
		if first != nil {
			return first
		}
		return following
	}

	if n.Type == html.ElementNode {
		// _checkValidNamespace: an allowed tag only survives in the HTML
		// namespace (svg/math subtrees are already dropped above).
		if n.Namespace != "" {
			n.Parent.RemoveChild(n)
			return following
		}
		sanitizeAttributes(n, tagName)
	}
	return nextInTree(n, root)
}

func hasElementChild(n *html.Node) bool {
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		if c.Type == html.ElementNode {
			return true
		}
	}
	return false
}

func getAttr(n *html.Node, key string) string {
	for _, a := range n.Attr {
		if a.Namespace == "" && a.Key == key {
			return a.Val
		}
	}
	return ""
}

func sanitizeAttributes(n *html.Node, lcTag string) {
	for i := len(n.Attr) - 1; i >= 0; i-- {
		a := n.Attr[i]
		name := a.Key
		if a.Namespace != "" {
			name = a.Namespace + ":" + a.Key
		}
		lcName := strings.ToLower(name)
		value := a.Val
		if name != "value" {
			value = jsTrim(value)
		}

		remove := safeForXMLAttrRe.MatchString(value) ||
			lcName == "attributename" && strings.Contains(value, "href") ||
			!isValidAttribute(lcTag, lcName, value)
		if remove {
			n.Attr = append(n.Attr[:i], n.Attr[i+1:]...)
			continue
		}
		n.Attr[i].Val = value
	}
}

func isValidAttribute(lcTag, lcName, value string) bool {
	// declarative-partial-updates patch linkage
	if lcName == "patchsrc" || lcName == "for" && lcTag != "label" && lcTag != "output" {
		return false
	}
	if isDataAttr(lcName) || ariaAttrRe.MatchString(lcName) {
		return true
	}
	if !sanitizeAllowedAttr[lcName] {
		return false
	}
	if uriSafeAttributes[lcName] {
		return true
	}
	if allowedURIRe.MatchString(attrWhitespaceRe.ReplaceAllString(value, "")) {
		return true
	}
	if (lcName == "src" || lcName == "xlink:href" || lcName == "href") && lcTag != "script" &&
		strings.HasPrefix(value, "data:") && dataURITags[lcTag] {
		return true
	}
	return value == ""
}

// PostContentPlainText is the plain text a reviewer sees for a post item:
// the text nodes of the sanitised HTML, in order, entities decoded. This is
// what anchor offsets index into on both the frontend (element.textContent)
// and the backend.
func PostContentPlainText(value string) string {
	var b strings.Builder
	var walk func(n *html.Node)
	walk = func(n *html.Node) {
		if n.Type == html.TextNode {
			b.WriteString(n.Data)
			return
		}
		// parse5 keeps <template> children in .content, not childNodes
		if n.Type == html.ElementNode && n.Data == "template" && n.Namespace == "" {
			return
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	for _, n := range parseFragment(SanitizePostContent(value)) {
		walk(n)
	}
	return b.String()
}
