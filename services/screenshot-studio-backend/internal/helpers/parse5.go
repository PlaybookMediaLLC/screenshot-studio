package helpers

import (
	"cmp"
	"slices"
	"strings"

	"golang.org/x/net/html"
	"golang.org/x/net/html/atom"
)

// parseFragment is parse5's parseFragment(html): a <template> context element,
// so anything parses in the "forgiving" template mode.
func parseFragment(s string) []*html.Node {
	ctx := &html.Node{Type: html.ElementNode, Data: "template", DataAtom: atom.Template}
	nodes, err := html.ParseFragment(strings.NewReader(s), ctx)
	if err != nil {
		return nil
	}
	orders := sourceAttrOrders(s, true)
	for _, n := range nodes {
		fixAttrs(n, orders)
	}
	return nodes
}

var formattingElements = map[string]bool{
	"a": true, "b": true, "big": true, "code": true, "em": true, "font": true, "i": true,
	"nobr": true, "s": true, "small": true, "strike": true, "strong": true, "tt": true, "u": true,
}

func attrsKey(attrs []html.Attribute) string {
	sorted := slices.Clone(attrs)
	slices.SortFunc(sorted, func(a, b html.Attribute) int {
		return cmp.Or(cmp.Compare(a.Namespace, b.Namespace), cmp.Compare(a.Key, b.Key), cmp.Compare(a.Val, b.Val))
	})
	var b strings.Builder
	for _, a := range sorted {
		b.WriteString(a.Namespace + "\x00" + a.Key + "\x00" + a.Val + "\x00")
	}
	return b.String()
}

// sourceAttrOrders records the source attribute order of formatting elements
// (a, strong, u...): x/net/html sorts their attributes for its Noah's Ark
// check, parse5 and browsers keep them as written.
// ponytail: keyed by attribute set, so two tags with the same attributes in
// different orders both get the first order.
func sourceAttrOrders(src string, scripting bool) map[string][]html.Attribute {
	orders := map[string][]html.Attribute{}
	z := html.NewTokenizer(strings.NewReader(src))
	for {
		tt := z.Next()
		if tt == html.ErrorToken {
			return orders
		}
		if tt != html.StartTagToken && tt != html.SelfClosingTagToken {
			continue
		}
		tok := z.Token()
		if !scripting && tok.Data == "noscript" {
			z.NextIsNotRawText()
		}
		if len(tok.Attr) > 1 && formattingElements[tok.Data] {
			if key := attrsKey(tok.Attr); orders[key] == nil {
				orders[key] = tok.Attr
			}
		}
	}
}

// fixAttrs restores formatting elements' source attribute order, then keeps
// the first of repeated attributes as the HTML tokenizer spec (and
// parse5/jsdom) does; x/net/html keeps them all.
func fixAttrs(n *html.Node, orders map[string][]html.Attribute) {
	if n.Type == html.ElementNode && len(n.Attr) > 1 {
		if n.Namespace == "" && formattingElements[n.Data] {
			if order, ok := orders[attrsKey(n.Attr)]; ok {
				n.Attr = slices.Clone(order)
			}
		}
		seen := make(map[string]bool, len(n.Attr))
		kept := n.Attr[:0]
		for _, a := range n.Attr {
			k := a.Namespace + ":" + a.Key
			if !seen[k] {
				seen[k] = true
				kept = append(kept, a)
			}
		}
		n.Attr = kept
	}
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		fixAttrs(c, orders)
	}
}

var voidElements = map[string]bool{
	"area": true, "base": true, "basefont": true, "bgsound": true, "br": true, "col": true,
	"embed": true, "frame": true, "hr": true, "img": true, "input": true, "keygen": true,
	"link": true, "meta": true, "param": true, "source": true, "track": true, "wbr": true,
}

var rawTextElements = map[string]bool{
	"style": true, "script": true, "xmp": true, "iframe": true, "noembed": true,
	"noframes": true, "plaintext": true, "noscript": true,
}

var (
	textEscaper = strings.NewReplacer("&", "&amp;", " ", "&nbsp;", "<", "&lt;", ">", "&gt;")
	attrEscaper = strings.NewReplacer("&", "&amp;", " ", "&nbsp;", `"`, "&quot;")
)

// serializeFragment is parse5's serialize(): the exact escaping matters because
// stripHtmlValidation's regexes run on its output.
func serializeFragment(nodes []*html.Node) string {
	var b strings.Builder
	for _, n := range nodes {
		serializeNode(&b, n)
	}
	return b.String()
}

func serializeChildren(b *strings.Builder, n *html.Node) {
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		serializeNode(b, c)
	}
}

func serializeNode(b *strings.Builder, n *html.Node) {
	switch n.Type {
	case html.ElementNode:
		b.WriteString("<" + n.Data)
		for _, a := range n.Attr {
			b.WriteByte(' ')
			switch {
			case a.Namespace == "":
			case a.Namespace == "xmlns" && a.Key == "xmlns":
			default:
				b.WriteString(a.Namespace + ":")
			}
			b.WriteString(a.Key + `="` + attrEscaper.Replace(a.Val) + `"`)
		}
		b.WriteByte('>')
		if voidElements[n.Data] {
			return
		}
		serializeChildren(b, n)
		b.WriteString("</" + n.Data + ">")
	case html.TextNode:
		if p := n.Parent; p != nil && p.Type == html.ElementNode && rawTextElements[p.Data] {
			b.WriteString(n.Data)
			return
		}
		b.WriteString(textEscaper.Replace(n.Data))
	case html.CommentNode:
		b.WriteString("<!--" + n.Data + "-->")
	case html.DoctypeNode:
		b.WriteString("<!DOCTYPE " + n.Data + ">")
	}
}

// textContent is Node.textContent for an element: its descendant text.
func textContent(n *html.Node) string {
	var b strings.Builder
	var walk func(*html.Node)
	walk = func(n *html.Node) {
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			if c.Type == html.TextNode {
				b.WriteString(c.Data)
			} else if c.Type == html.ElementNode {
				walk(c)
			}
		}
	}
	walk(n)
	return b.String()
}
