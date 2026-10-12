package x

import (
	"regexp"
	"strconv"
	"strings"
	"unicode/utf16"

	"golang.org/x/net/html"
	"golang.org/x/net/html/atom"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/helpers"
)

// parseFragment is parse5's parseFragment.
func parseFragment(s string) []*html.Node {
	nodes, _ := html.ParseFragment(strings.NewReader(s), &html.Node{Type: html.ElementNode, Data: "body", DataAtom: atom.Body})
	return nodes
}

func nodeName(n *html.Node) string {
	switch n.Type {
	case html.TextNode:
		return "#text"
	case html.ElementNode:
		return n.Data
	case html.CommentNode:
		return "#comment"
	}
	return "#" + strings.ToLower(n.Data)
}

func attr(n *html.Node, name string) string {
	for _, a := range n.Attr {
		if a.Key == name {
			return a.Val
		}
	}
	return ""
}

var httpURL = regexp.MustCompile(`(?i)^https?://`)

// articleImages returns the pictures of the article body at any depth. Only
// http(s) files from where uploads are allowed are kept: anything else would
// be read from the disk or fetched from an arbitrary site when it's uploaded.
func articleImages(n *html.Node) []string {
	if nodeName(n) == "img" {
		src := attr(n, "src")
		if httpURL.MatchString(src) && helpers.IsAllowedUploadPath(src) {
			return []string{src}
		}
		return nil
	}
	var out []string
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		out = append(out, articleImages(c)...)
	}
	return out
}

func articleImagesOf(nodes []*html.Node) []string {
	var out []string
	for _, n := range nodes {
		out = append(out, articleImages(n)...)
	}
	return out
}

// jsLength is a JavaScript string length (UTF-16 code units): the offsets of
// the content state are counted that way.
func jsLength(s string) int { return len(utf16.Encode([]rune(s))) }

type styleRange struct {
	Offset int    `json:"offset"`
	Length int    `json:"length"`
	Style  string `json:"style"`
}

type entityRange struct {
	Offset int `json:"offset"`
	Length int `json:"length"`
	Key    int `json:"key"`
}

type block struct {
	Key               string        `json:"key"`
	Text              string        `json:"text"`
	Type              string        `json:"type"`
	InlineStyleRanges []styleRange  `json:"inline_style_ranges,omitempty"`
	EntityRanges      []entityRange `json:"entity_ranges,omitempty"`
}

type entity struct {
	Key   string      `json:"key"`
	Value entityValue `json:"value"`
}

type entityValue struct {
	Type       string `json:"type"`
	Mutability string `json:"mutability"`
	Data       any    `json:"data"`
}

type mediaItem struct {
	MediaCategory string `json:"media_category"`
	MediaID       string `json:"media_id"`
}

type contentState struct {
	Blocks   []block  `json:"blocks"`
	Entities []entity `json:"entities"`
}

type articleDraft struct {
	Title        *string      `json:"title,omitempty"`
	ContentState contentState `json:"content_state"`
	CoverMedia   *mediaItem   `json:"cover_media,omitempty"`
}

type inlineCtx struct {
	text         string
	length       int
	styles       []styleRange
	entityRanges []entityRange
}

// articleContentState converts the editor HTML (already sanitized by
// stripHtmlValidation's 'html' mode - only p, h1-h3, ul, li, strong, u, a and
// img survive) into the content_state the X Articles API expects. Pictures in
// the body become atomic image blocks where they are, the post media is
// appended at the end (the cover travels separately).
// X's schema is a snake_case Draft.js dialect with additionalProperties
// disallowed: blocks only accept key/text/type/data/entity_ranges/
// inline_style_ranges (no depth).
func articleContentState(source string, embeddedMediaIDs []string, inlineMediaIDs map[string]string) contentState {
	state := contentState{Blocks: []block{}, Entities: []entity{}}

	var walkInline func(n *html.Node, ctx *inlineCtx)
	walkInline = func(n *html.Node, ctx *inlineCtx) {
		for child := n.FirstChild; child != nil; child = child.NextSibling {
			if nodeName(child) == "#text" {
				ctx.text += child.Data
				ctx.length += jsLength(child.Data)
				continue
			}
			offset := ctx.length
			walkInline(child, ctx)
			length := ctx.length - offset
			if length == 0 {
				continue
			}
			if nodeName(child) == "strong" {
				ctx.styles = append(ctx.styles, styleRange{Offset: offset, Length: length, Style: "bold"})
			}
			if nodeName(child) == "a" {
				if href := attr(child, "href"); href != "" {
					key := len(state.Entities)
					state.Entities = append(state.Entities, entity{Key: strconv.Itoa(key), Value: entityValue{
						Type: "link", Mutability: "mutable", Data: map[string]string{"url": href},
					}})
					ctx.entityRanges = append(ctx.entityRanges, entityRange{Offset: offset, Length: length, Key: key})
				}
			}
		}
	}

	makeBlock := func(text, kind string, styles []styleRange, entityRanges []entityRange) block {
		return block{Key: "b" + strconv.Itoa(len(state.Blocks)), Text: text, Type: kind, InlineStyleRanges: styles, EntityRanges: entityRanges}
	}

	pushImage := func(mediaID string) {
		key := len(state.Entities)
		state.Entities = append(state.Entities, entity{Key: strconv.Itoa(key), Value: entityValue{
			Type: "image", Mutability: "immutable",
			// Must match the category the media was uploaded with - lowercase,
			// like the upload endpoint (the uppercase TWEET_IMAGE in the docs
			// example is wrong).
			Data: map[string][]mediaItem{"media_items": {{MediaCategory: "tweet_image", MediaID: mediaID}}},
		}})
		state.Blocks = append(state.Blocks, makeBlock(" ", "atomic", nil, []entityRange{{Offset: 0, Length: 1, Key: key}}))
	}

	pushBlock := func(n *html.Node, kind string) {
		ctx := &inlineCtx{}
		walkInline(n, ctx)
		if strings.TrimSpace(ctx.text) != "" {
			state.Blocks = append(state.Blocks, makeBlock(ctx.text, kind, ctx.styles, ctx.entityRanges))
		}
		// pictures inside the node (a list item can hold one) follow its text
		for _, src := range articleImages(n) {
			if id := inlineMediaIDs[src]; id != "" {
				pushImage(id)
			}
		}
	}

	for _, n := range parseFragment(source) {
		switch nodeName(n) {
		case "h1":
			pushBlock(n, "header-one")
		case "h2":
			pushBlock(n, "header-two")
		case "h3":
			// header-three is documented as valid but X's draft endpoint 503s on
			// it (https://devcommunity.x.com/t/-/271312), downgrade to header-two
			// until X fixes their side.
			pushBlock(n, "header-two")
		case "ul", "ol":
			kind := "unordered-list-item"
			if nodeName(n) == "ol" {
				kind = "ordered-list-item"
			}
			for li := n.FirstChild; li != nil; li = li.NextSibling {
				if nodeName(li) == "li" {
					pushBlock(li, kind)
				}
			}
		case "#text":
			if strings.TrimSpace(n.Data) != "" {
				state.Blocks = append(state.Blocks, makeBlock(n.Data, "unstyled", nil, nil))
			}
		default:
			pushBlock(n, "unstyled")
		}
	}

	// The API requires at least one block.
	if len(state.Blocks) == 0 {
		state.Blocks = append(state.Blocks, makeBlock(helpers.StripHTMLValidation("none", source, helpers.StripOptions{}), "unstyled", nil, nil))
	}

	for _, id := range embeddedMediaIDs {
		pushImage(id)
	}
	return state
}
