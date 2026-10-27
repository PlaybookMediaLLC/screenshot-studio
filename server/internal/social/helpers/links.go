package helpers

import (
	"regexp"

	"github.com/dlclark/regexp2"
)

// Scheme'd URLs - keep this in sync with the URL detection used by the short
// linking service
const schemeURL = `https?:\/\/(?:www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}` + jsWordBoundary + `(?:[-a-zA-Z0-9()@:%_\+.~#?&//=]*)`

// Scheme-less domains (example.com, bit.ly/abc): X linkifies these into t.co
// links exactly like full URLs, so they count as link posts too. The TLD list
// is the common subset of what X linkifies - intentionally NOT synced with the
// short linking service, which must only rewrite real scheme'd URLs.
// The lookbehind keeps email addresses (user@domain.com) and dotted paths
// intact - X does not linkify those either.
const bareDomainTLDs = `online|store|cloud|social|world|blog|shop|site|tech|news|live|link|info|app|dev|xyz|com|net|org|edu|gov|biz|io|co|ai|me|tv|cc|ly|gl|sh|fm|am|be|to|gg|so|is|us|uk|ca|au|de|fr|es|it|nl|se|no|dk|fi|pl|ch|at|ie|nz|za|in|jp|br|mx|ru|eu`

const bareDomain = `(?<![\w@./-])(?:[a-zA-Z0-9-]+\.)+(?:` + bareDomainTLDs + `)` + jsWordBoundary + `(?:\/[-a-zA-Z0-9()@:%_+.~#?&/=]*)?`

// JavaScript's \b: regexp2's ECMAScript \b treats every Unicode letter as a
// word character, JS only [A-Za-z0-9_].
const jsWordBoundary = `(?:(?<=\w)(?!\w)|(?<!\w)(?=\w))`

// regexp2 in ECMAScript mode gives the JS lookbehind and \w semantics.
var linkURLRe = regexp2.MustCompile(`(?:`+schemeURL+`)|(?:`+bareDomain+`)`,
	regexp2.ECMAScript|regexp2.IgnoreCase|regexp2.Multiline)

var (
	emptyAnchorRe  = regexp.MustCompile(`(?i)<a\b[^>]*>` + jsSpace + `*</a>`)
	spaceRunRe     = regexp.MustCompile(`[ \t]{2,}`)
	spaceNewlineRe = regexp.MustCompile(` +\n`)
)

func HasLinks(text string) bool {
	ok, _ := linkURLRe.MatchString(text)
	return ok
}

func StripLinks(text string) string {
	stripped, _ := linkURLRe.Replace(text, "", -1, -1)
	// collapse the whitespace / empty anchor leftovers the removed link left behind
	stripped = emptyAnchorRe.ReplaceAllLiteralString(stripped, "")
	stripped = spaceRunRe.ReplaceAllLiteralString(stripped, " ")
	stripped = spaceNewlineRe.ReplaceAllLiteralString(stripped, "\n")
	return jsTrim(stripped)
}
