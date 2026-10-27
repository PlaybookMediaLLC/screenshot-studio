package helpers

import (
	"regexp"

	"github.com/dlclark/regexp2"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ids"
)

// RemoveMarkdown removes Markdown (remove-markdown with exceptions).
func RemoveMarkdown(text string, except []*regexp.Regexp) string {
	modifiedText := text
	type placeholder struct{ key, value string }
	var placeholders []placeholder

	// Replace exceptions with placeholders
	for _, re := range except {
		modifiedText = re.ReplaceAllStringFunc(modifiedText, func(match string) string {
			key := "[[EXCEPT_PLACEHOLDER_" + ids.Make(5) + "]]"
			placeholders = append(placeholders, placeholder{key, match})
			return key
		})
	}

	// Remove markdown from modified text
	cleanedText := removeMd(modifiedText)

	// Replace placeholders with original text
	for _, p := range placeholders {
		cleanedText = jsReplaceString(cleanedText, p.key, p.value)
	}
	return cleanedText
}

// JS line anchors and `.` for regexp2 (its own only know '\n').
const (
	mdBol = `(?<![^\n\r  ])`
	mdEol = `(?![^\n\r  ])`
	mdDot = `[^\n\r  ]`
)

func md(pattern string) *regexp2.Regexp {
	return regexp2.MustCompile(pattern, regexp2.ECMAScript)
}

// remove-markdown@0.5 with its default options (stripListLeaders, gfm,
// useImgAltText; no abbr, no replaceLinksWithURL, no htmlTagsToSkip).
var removeMdSteps = []struct {
	re   *regexp2.Regexp
	repl string
}{
	// Remove horizontal rules (stripListHeaders conflict with this rule, which is why it has been moved to the top)
	{md(mdBol + `(-\s*?|\*\s*?|_\s*?){3,}\s*`), ""},
	// stripListLeaders
	{md(mdBol + `([\s\t]*)([\*\-\+]|\d+\.)\s+`), "$1"},
	// gfm: Header
	{md(`\n={2,}`), "\n"},
	// Fenced codeblocks
	{md(`~{3}` + mdDot + `*\n`), ""},
	// Strikethrough
	{md(`~~`), ""},
	// Fenced codeblocks
	{md("`{3}" + mdDot + `*\n`), ""},
	// Remove HTML tags (the second htmlReplaceRegex pass is a no-op without
	// htmlTagsToSkip)
	{md(`<[^>]*>`), ""},
	// Remove setext-style headers
	{md(`^[=\-]{2,}\s*$`), ""},
	// Remove footnotes?
	{md(`\[\^` + mdDot + `+?\](\: ` + mdDot + `*?$)?`), ""},
	{md(`\s{0,2}\[` + mdDot + `*?\]: ` + mdDot + `*?$`), ""},
	// Remove images
	{md(`\!\[(` + mdDot + `*?)\][\[\(]` + mdDot + `*?[\]\)]`), "$1"},
	// Remove inline links
	{md(`\[([^\]]*?)\][\[\(]` + mdDot + `*?[\]\)]`), "$1"},
	// Remove blockquotes
	{md(mdBol + `(\n)?\s{0,3}>\s?`), "$1"},
	// Remove reference-style links?
	{md(`^\s{1,2}\[(` + mdDot + `*?)\]: (\S+)( "` + mdDot + `*?")?\s*$`), ""},
	// Remove atx-style headers
	{md(mdBol + `(\n)?\s{0,}#{1,6}\s*( (` + mdDot + `+))? +#+` + mdEol + `|` + mdBol + `(\n)?\s{0,}#{1,6}\s*( (` + mdDot + `+))?` + mdEol), "$1$3$4$6"},
	// Remove * emphasis
	{md(`([\*]+)(\S)(` + mdDot + `*?\S)??\1`), "$2$3"},
	// Remove _ emphasis. Unlike *, _ emphasis gets rendered only if
	//   1. Either there is a whitespace character before opening _ and after closing _.
	//   2. Or _ is at the start/end of the string.
	{md(`(^|\W)([_]+)(\S)(` + mdDot + `*?\S)??\2($|\W)`), "$1$3$4$5"},
	// Remove code blocks
	{md("(`{3,})(" + mdDot + `*?)\1`), "$2"},
	// Remove inline code
	{md("`(" + mdDot + "+?)`"), "$1"},
	// Replace strike through
	{md(`~(` + mdDot + `*?)~`), "$1"},
}

func removeMd(markdown string) string {
	output := markdown
	for _, step := range removeMdSteps {
		next, err := step.re.Replace(output, step.repl, -1, -1)
		if err != nil {
			// remove-markdown logs and returns the input on error
			return markdown
		}
		output = next
	}
	return output
}
