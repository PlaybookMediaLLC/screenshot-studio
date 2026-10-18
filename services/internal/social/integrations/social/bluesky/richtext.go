package bluesky

import (
	"context"
	_ "embed"
	"encoding/json"
	"regexp"
	"slices"
	"strings"
	"unicode"
	"unicode/utf16"
	"unicode/utf8"
)

// @atproto/api RichText.detectFacets (rich-text/detection.ts + util.ts).
// Go strings are UTF-8, so regexp byte offsets are already the UTF-8 facet
// indices; only lengths JavaScript measures in UTF-16 units are converted.

// tlds.json is the `tlds` package (1.261.0) @atproto/api validates domains with.
//
//go:embed tlds.json
var tldsJSON []byte

var tlds = func() map[string]bool {
	var list []string
	if err := json.Unmarshal(tldsJSON, &list); err != nil {
		panic(err)
	}
	set := make(map[string]bool, len(list))
	for _, tld := range list {
		set[tld] = true
	}
	return set
}()

// jsSpace is JavaScript's \s (RE2's \s is ASCII only).
const jsSpace = `\t\n\v\f\r \x{a0}\x{1680}\x{2000}-\x{200a}\x{2028}\x{2029}\x{202f}\x{205f}\x{3000}\x{feff}`

// zeroWidth are the characters TAG_REGEX excludes besides \s.
const zeroWidth = "\u00AD\u2060\u200A\u200B\u200C\u200D\u20e2"

var (
	// MENTION_REGEX = /(^|\s|\()(@)([a-zA-Z0-9.-]+)(\b)/g
	mentionRegex = regexp.MustCompile(`(^|[` + jsSpace + `]|\()(@)([a-zA-Z0-9.-]+)(\b)`)
	// URL_REGEX = /(^|\s|\()((https?:\/\/[\S]+)|((?<domain>[a-z][a-z0-9]*(\.[a-z0-9]+)+)[\S]*))/gim
	// (the i flag is spelled out: RE2 case folding also matches U+017F and U+212A)
	urlRegex = regexp.MustCompile(`(?m)(^|[` + jsSpace + `]|\()(([hH][tT][tT][pP][sS]?://[^` + jsSpace + `]+)|((?P<domain>[a-zA-Z][a-zA-Z0-9]*(\.[a-zA-Z0-9]+)+)[^` + jsSpace + `]*))`)
	// TAG_REGEX up to the hash; the tag body is matched by hand because RE2
	// has no (?!\ufe0f) lookahead.
	tagStartRegex = regexp.MustCompile(`(^|[` + jsSpace + `])[#\x{ff03}]`)
	domainGroup   = urlRegex.SubexpIndex("domain")
)

type FacetIndex struct {
	ByteStart int `json:"byteStart"`
	ByteEnd   int `json:"byteEnd"`
}

type FacetFeature struct {
	Type string  `json:"$type"`
	Did  *string `json:"did,omitempty"`
	URI  string  `json:"uri,omitempty"`
	Tag  string  `json:"tag,omitempty"`
}

// Facet is app.bsky.richtext.facet. Only mention facets carry $type, like
// the TypeScript detection.
type Facet struct {
	Type     string         `json:"$type,omitempty"`
	Index    FacetIndex     `json:"index"`
	Features []FacetFeature `json:"features"`
}

// isValidDomain: str ends with "." + a known TLD (case-sensitive).
func isValidDomain(str string) bool {
	i := strings.LastIndexByte(str, '.')
	return i >= 0 && tlds[str[i+1:]]
}

func utf16Len(s string) int { return len(utf16.Encode([]rune(s))) }

func isTagBreak(r rune) bool {
	return strings.ContainsRune(jsSpaceRunes, r) || strings.ContainsRune(zeroWidth, r)
}

// jsSpaceRunes lists jsSpace's members for isTagBreak.
const jsSpaceRunes = "\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"

// DetectFacets is detectFacets: mentions (unresolved, did = handle), links
// and tags in detection order, or nil when there are none.
func DetectFacets(text string) []Facet {
	var facets []Facet

	// mentions
	for _, m := range mentionRegex.FindAllStringSubmatchIndex(text, -1) {
		handle := text[m[6]:m[7]]
		if !isValidDomain(handle) && !strings.HasSuffix(handle, ".test") {
			continue // probably not a handle
		}
		start := m[0] + strings.Index(text[m[0]:], handle) - 1
		did := handle // must be resolved afterwards
		facets = append(facets, Facet{
			Type:     "app.bsky.richtext.facet",
			Index:    FacetIndex{ByteStart: start, ByteEnd: start + len(handle) + 1},
			Features: []FacetFeature{{Type: "app.bsky.richtext.facet#mention", Did: &did}},
		})
	}

	// links
	for _, m := range urlRegex.FindAllStringSubmatchIndex(text, -1) {
		match := text[m[4]:m[5]]
		uri := match
		if !strings.HasPrefix(uri, "http") {
			if m[2*domainGroup] < 0 || !isValidDomain(text[m[2*domainGroup]:m[2*domainGroup+1]]) {
				continue
			}
			uri = "https://" + uri
		}
		start := m[0] + strings.Index(text[m[0]:], match)
		end := start + len(match)
		// strip ending puncuation
		if strings.ContainsAny(uri[len(uri)-1:], ".,;:!?") {
			uri = uri[:len(uri)-1]
			end--
		}
		if strings.HasSuffix(uri, ")") && !strings.Contains(uri, "(") {
			uri = uri[:len(uri)-1]
			end--
		}
		facets = append(facets, Facet{
			Index:    FacetIndex{ByteStart: start, ByteEnd: end},
			Features: []FacetFeature{{Type: "app.bsky.richtext.facet#link", URI: uri}},
		})
	}

	// tags
	for _, m := range tagStartRegex.FindAllStringSubmatchIndex(text, -1) {
		hashStart := m[3]
		body := text[m[1]:]
		end := strings.IndexFunc(body, isTagBreak)
		if end >= 0 {
			body = body[:end]
		}
		// (?!\ufe0f) and at least one character that is not a digit or
		// punctuation
		first, _ := utf8.DecodeRuneInString(body)
		if body == "" || first == '\ufe0f' || !strings.ContainsFunc(body, func(r rune) bool {
			return !(r >= '0' && r <= '9') && !unicode.IsPunct(r)
		}) {
			continue
		}
		// strip ending punctuation and any spaces
		tag := strings.TrimRightFunc(body, unicode.IsPunct)
		if tag == "" || utf16Len(tag) > 64 {
			continue
		}
		facets = append(facets, Facet{
			Index:    FacetIndex{ByteStart: hashStart, ByteEnd: m[1] + len(tag)},
			Features: []FacetFeature{{Type: "app.bsky.richtext.facet#tag", Tag: tag}},
		})
	}

	return facets
}

// detectFacets is RichText.detectFacets(agent): detection, then every
// mention resolved to a DID (empty when the handle does not resolve), sorted by
// byteStart.
func (a *agent) detectFacets(ctx context.Context, text string) []Facet {
	facets := DetectFacets(text)
	if facets == nil {
		return nil
	}
	for _, facet := range facets {
		for _, feature := range facet.Features {
			if feature.Type != "app.bsky.richtext.facet#mention" {
				continue
			}
			did, err := a.resolveHandle(ctx, *feature.Did)
			if err != nil {
				did = ""
			}
			*feature.Did = did
		}
	}
	slices.SortStableFunc(facets, func(x, y Facet) int { return x.Index.ByteStart - y.Index.ByteStart })
	return facets
}
