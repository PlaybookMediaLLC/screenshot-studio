package autopost

import (
	"bytes"
	"context"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ssrf"
	"golang.org/x/net/html"
)

// The RSS/Atom reading rss-parser does for loadXML: parseURL (60s timeout,
// 5 redirects, its default headers) and the item fields Postiz reads.

// node is an element's name and all the text inside it; rss-parser rebuilds
// nested markup that the caller strips with striptags anyway.
type node struct {
	Name xml.Name
	Text string
}

func (n *node) UnmarshalXML(d *xml.Decoder, start xml.StartElement) error {
	n.Name = start.Name
	var b strings.Builder
	depth := 0
	for {
		tok, err := d.Token()
		if err != nil {
			return err
		}
		switch t := tok.(type) {
		case xml.CharData:
			b.Write(t)
		case xml.StartElement:
			depth++
		case xml.EndElement:
			if depth == 0 {
				n.Text = b.String()
				return nil
			}
			depth--
		}
	}
}

// plain picks the first element without a namespace prefix (xml2js keys
// prefixed elements as "prefix:name"), or the first one.
func plain(nodes []node) *node {
	for i := range nodes {
		if nodes[i].Name.Space == "" {
			return &nodes[i]
		}
	}
	if len(nodes) > 0 {
		return &nodes[0]
	}
	return nil
}

type rssItem struct {
	Link        []node `xml:"link"`
	PubDate     *node  `xml:"pubDate"`
	Encoded     *node  `xml:"encoded"`
	Description []node `xml:"description"`
}

type atomLink struct {
	Rel  *string `xml:"rel,attr"`
	Href *string `xml:"href,attr"`
}

type atomEntry struct {
	Links     []atomLink `xml:"link"`
	Published *node      `xml:"published"`
	Updated   *node      `xml:"updated"`
	Content   *node      `xml:"content"`
}

type feedDocument struct {
	XMLName xml.Name
	Version string `xml:"version,attr"`
	Channel struct {
		Items []rssItem `xml:"item"`
	} `xml:"channel"`
	Items   []rssItem   `xml:"item"`
	Entries []atomEntry `xml:"entry"`
}

// feedItem holds the fields loadXML reads; nil = undefined.
type feedItem struct {
	PubDate        *string
	Link           *string
	ContentEncoded *string
	Content        *string
}

func textOf(n *node) *string {
	if n == nil {
		return nil
	}
	return &n.Text
}

func parseFeed(data []byte) ([]feedItem, error) {
	d := xml.NewDecoder(bytes.NewReader(data))
	// Node reads the body as UTF-8 whatever the declaration says.
	d.CharsetReader = func(_ string, input io.Reader) (io.Reader, error) { return input, nil }
	var doc feedDocument
	if err := d.Decode(&doc); err != nil {
		return nil, err
	}

	var items []feedItem
	switch {
	case doc.XMLName.Local == "feed":
		for _, entry := range doc.Entries {
			item := feedItem{Content: textOf(entry.Content)}
			if href := atomHref(entry.Links); href != nil {
				item.Link = href
			}
			for _, date := range []*node{entry.Published, entry.Updated} {
				if date == nil || date.Text == "" || item.PubDate != nil {
					continue
				}
				parsed, ok := parseDate(date.Text)
				if !ok {
					// new Date(invalid).toISOString() throws
					return nil, fmt.Errorf("Invalid time value")
				}
				iso := parsed.UTC().Format("2006-01-02T15:04:05.000Z")
				item.PubDate = &iso
			}
			items = append(items, item)
		}
	case doc.XMLName.Local == "rss" && strings.HasPrefix(doc.Version, "2"),
		doc.XMLName.Local == "rss" && strings.Contains(doc.Version, "0.9"):
		items = rssItems(doc.Channel.Items)
	case doc.XMLName.Local == "RDF":
		items = rssItems(doc.Items)
	default:
		return nil, errors.New("Feed not recognized as RSS 1 or 2.")
	}
	return items, nil
}

// atomHref is rss-parser getLink(links, 'alternate', 0).
func atomHref(links []atomLink) *string {
	for _, link := range links {
		if link.Rel != nil && *link.Rel == "alternate" {
			return link.Href
		}
	}
	if len(links) > 0 {
		return links[0].Href
	}
	return nil
}

func rssItems(list []rssItem) []feedItem {
	items := make([]feedItem, 0, len(list))
	for _, it := range list {
		item := feedItem{
			PubDate:        textOf(it.PubDate),
			Link:           textOf(plain(it.Link)),
			ContentEncoded: textOf(it.Encoded),
		}
		// rss-parser exposes <description> as item.content
		if desc := plain(it.Description); desc != nil && desc.Text != "" {
			item.Content = &desc.Text
		}
		items = append(items, item)
	}
	return items
}

var dateLayouts = []string{
	time.RFC3339Nano, time.RFC1123Z, time.RFC1123, time.RFC822Z, time.RFC822, time.RFC850, time.ANSIC,
	"Mon, 2 Jan 2006 15:04:05 -0700", "Mon, 2 Jan 2006 15:04:05 MST", "Mon, 2 Jan 2006 15:04 -0700",
	"2 Jan 2006 15:04:05 -0700", "2 Jan 2006 15:04:05 MST", "Mon, 02 Jan 2006 15:04:05 Z",
	"2006-01-02T15:04:05", "2006-01-02T15:04", "2006-01-02 15:04:05", "2006-01-02",
}

// parseDate approximates dayjs(string) / new Date(string).
func parseDate(value string) (time.Time, bool) {
	value = strings.TrimSpace(value)
	for _, layout := range dateLayouts {
		if t, err := time.Parse(layout, value); err == nil {
			return t, true
		}
	}
	return time.Time{}, false
}

// fetchClient is the SSRF-safe client with rss-parser's limits.
func fetchClient(timeout time.Duration, maxRedirects int) *http.Client {
	c := *ssrf.Client()
	c.Timeout = timeout
	if maxRedirects >= 0 {
		c.CheckRedirect = func(_ *http.Request, via []*http.Request) error {
			if len(via) > maxRedirects {
				return errors.New("Too many redirects")
			}
			return nil
		}
	}
	return &c
}

// fetchFeed is rss-parser parseURL's request.
func fetchFeed(ctx context.Context, url string) ([]feedItem, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "rss-parser")
	req.Header.Set("Accept", "application/rss+xml")
	res, err := fetchClient(60*time.Second, 5).Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 {
		return nil, fmt.Errorf("Status code %d", res.StatusCode)
	}
	data, err := io.ReadAll(res.Body)
	if err != nil {
		return nil, err
	}
	return parseFeed(data)
}

// pageText is loadUrl: the page body's markup without script and style
// elements, as JSDOM's innerHTML serializes it, before striptags.
func pageText(ctx context.Context, url string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", err
	}
	res, err := fetchClient(0, -1).Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	data, err := io.ReadAll(res.Body)
	if err != nil {
		return "", err
	}
	doc, err := html.ParseWithOptions(bytes.NewReader(data), html.ParseOptionEnableScripting(false))
	if err != nil {
		return "", err
	}
	body := findBody(doc)
	if body == nil {
		return "", errors.New("no body")
	}
	var b strings.Builder
	writeText(&b, body)
	return b.String(), nil
}

func findBody(n *html.Node) *html.Node {
	if n.Type == html.ElementNode && n.Data == "body" {
		return n
	}
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		if found := findBody(c); found != nil {
			return found
		}
	}
	return nil
}

var innerHTMLEscaper = strings.NewReplacer("&", "&amp;", " ", "&nbsp;", "<", "&lt;", ">", "&gt;")

// writeText writes the text nodes innerHTML would serialize (tags and
// comments are what striptags removes next).
func writeText(b *strings.Builder, n *html.Node) {
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		switch c.Type {
		case html.TextNode:
			if p := c.Parent; p != nil && p.Type == html.ElementNode && rawText[p.Data] {
				b.WriteString(c.Data)
			} else {
				b.WriteString(innerHTMLEscaper.Replace(c.Data))
			}
		case html.ElementNode:
			if c.Data == "script" || c.Data == "style" {
				continue
			}
			writeText(b, c)
		}
	}
}

// Elements whose text innerHTML does not escape.
var rawText = map[string]bool{"xmp": true, "iframe": true, "noembed": true, "noframes": true, "plaintext": true}
