// Package articlebody validates the restricted rich article interchange and
// resolves workspace image references only after the publisher signs them.
package articlebody

import (
	"fmt"
	"golang.org/x/net/html"
	"golang.org/x/net/html/atom"
	"net/url"
	"regexp"
	"strings"
)

var identifier = regexp.MustCompile(`^(?:[a-z0-9]{10,32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$`)
var postID = regexp.MustCompile(`^[0-9]{1,30}$`)

// Render rejects unsafe tags, attributes and foreign image references. A nil
// URL value validates an attached asset; a signed URL resolves it for X.
func Render(source string, assets map[string]string) (string, error) {
	if len(source) > 400_000 {
		return "", fmt.Errorf("article markup is too large")
	}
	nodes, err := html.ParseFragment(strings.NewReader(source), &html.Node{Type: html.ElementNode, Data: "body", DataAtom: atom.Body})
	if err != nil {
		return "", err
	}
	used := map[string]bool{}
	var visit func(*html.Node) error
	visit = func(n *html.Node) error {
		if n.Type == html.TextNode {
			return nil
		}
		if n.Type != html.ElementNode {
			return fmt.Errorf("unsupported article content")
		}
		switch n.Data {
		case "p", "h1", "h2", "h3", "blockquote", "ul", "ol", "li", "strong", "em", "s", "a", "img", "br":
		default:
			return fmt.Errorf("unsupported article block %s", n.Data)
		}
		foundAsset := false
		for i := range n.Attr {
			a := &n.Attr[i]
			switch {
			case n.Data == "a" && a.Key == "href":
				u, e := url.Parse(a.Val)
				if e != nil || u.Host == "" || (u.Scheme != "https" && u.Scheme != "http") || u.User != nil {
					return fmt.Errorf("invalid article link")
				}
			case n.Data == "blockquote" && a.Key == "data-x-post":
				if !postID.MatchString(a.Val) {
					return fmt.Errorf("invalid embedded X post")
				}
			case n.Data == "img" && a.Key == "alt":
			case n.Data == "img" && a.Key == "data-asset-id":
				signed, ok := assets[a.Val]
				if !identifier.MatchString(a.Val) || !ok {
					return fmt.Errorf("article image is not attached to this publication")
				}
				foundAsset = true
				used[a.Val] = true
				if signed != "" {
					a.Key, a.Val = "src", signed
				}
			default:
				return fmt.Errorf("unsupported article attribute %s", a.Key)
			}
		}
		if n.Data == "img" && !foundAsset {
			return fmt.Errorf("article images must reference workspace uploads")
		}
		for child := n.FirstChild; child != nil; child = child.NextSibling {
			if err := visit(child); err != nil {
				return err
			}
		}
		return nil
	}
	var out strings.Builder
	for _, n := range nodes {
		if err := visit(n); err != nil {
			return "", err
		}
		if err := html.Render(&out, n); err != nil {
			return "", err
		}
	}
	for id := range assets {
		if !used[id] {
			return "", fmt.Errorf("an attached article image is missing from the body")
		}
	}
	return out.String(), nil
}
