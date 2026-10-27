package onboarding

import (
	"regexp"
	"strings"
)

// Fetched pages, enrichment values, and search snippets are untrusted data.
// These helpers reduce them to plain text, flag text written for a model
// rather than a reader, and fence each source so it cannot close its fence
// or impersonate the prompt. A port of lib/launch/sanitize.ts.

var (
	invisible = regexp.MustCompile("[\u00AD\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]|[\U000E0000-\U000E007F]")
	control   = regexp.MustCompile("[\x00-\x08\x0B-\x1F\x7F-\u009F]")
)

// StripInvisible removes zero-width, bidi, tag, and control characters.
func StripInvisible(value string) string {
	return control.ReplaceAllString(invisible.ReplaceAllString(value, ""), "")
}

type injectionPattern struct {
	pattern *regexp.Regexp
	reason  string
}

var injectionPatterns = []injectionPattern{
	{regexp.MustCompile(`(?i)\b(ignore|disregard|forget|override)\b[^.\n]{0,40}\b(previous|prior|above|earlier|all|system|your)\b[^.\n]{0,20}\b(instructions?|prompts?|rules|messages?|context)\b`), "asks the model to ignore its instructions"},
	{regexp.MustCompile(`(?i)\byou are (now|no longer|actually)\b`), "tries to reassign the model's role"},
	{regexp.MustCompile(`(?i)\b(new|updated|real|actual) (system )?(instructions?|prompt|task)\s*:`), "announces new instructions"},
	{regexp.MustCompile(`(?i)(^|\n)\s*(system|assistant|developer|user)\s*(prompt|message)?\s*:`), "contains a chat role label"},
	{regexp.MustCompile(`(?i)</?\s*(system|assistant|user|instructions?|source|sources|brief|tool)\b[^>]*>`), "contains prompt markup"},
	{regexp.MustCompile(`(?i)\b(send|email|forward|post|upload|share|exfiltrate|leak)\b[^.\n]{0,60}\b(api[ -]?keys?|passwords?|tokens?|secrets?|credentials|customer (list|data|emails?))\b`), "asks to send sensitive data"},
	{regexp.MustCompile(`(?i)\b(do not|don't|never)\b[^.\n]{0,20}\b(tell|mention|reveal|show)\b[^.\n]{0,20}\b(user|reviewer|human|anyone)\b`), "asks the model to hide something from the reviewer"},
	{regexp.MustCompile(`(?i)\b(call|use|invoke|run) the [a-z_]*\s*tool\b`), "tries to direct tool use"},
	{regexp.MustCompile(`(?i)\bprint (your|the) (system )?prompt\b`), "asks for the system prompt"},
}

// DetectInjection returns why value reads as instructions to a model, if it does.
func DetectInjection(value string) []string {
	var reasons []string
	for _, candidate := range injectionPatterns {
		if candidate.pattern.MatchString(value) {
			reasons = append(reasons, candidate.reason)
		}
	}
	return reasons
}

var fenceTags = regexp.MustCompile(`(?i)<(/?)\s*(source|sources|brief|system|instructions?|profile|tool)\b`)

// DefuseMarkup breaks the tags the prompt uses, so content cannot close its fence.
func DefuseMarkup(value string) string { return fenceTags.ReplaceAllString(value, "‹$1$2") }

// Source is one fenced piece of untrusted text the prompt can cite by ID.
// ThirdParty is text about the product from elsewhere (search results,
// reviews): values citing it rank below the product's own site.
type Source struct {
	Flagged    bool
	ID         string
	Kind       string
	Text       string
	ThirdParty bool
	Title      string
	URL        string
}

// Fence wraps a source as untrusted data.
func Fence(source Source) string {
	attribute := func(value string) string {
		value = strings.NewReplacer(`"`, "", "<", "", ">", "").Replace(DefuseMarkup(value))
		if len(value) > 300 {
			value = value[:300]
		}
		return value
	}
	flagged := "false"
	if source.Flagged {
		flagged = "true"
	}
	return `<source id="` + source.ID + `" kind="` + source.Kind + `" trust="untrusted" flagged="` + flagged +
		`" url="` + attribute(source.URL) + `" title="` + attribute(source.Title) + "\">\n" + DefuseMarkup(source.Text) + "\n</source>"
}

// ClampText cuts value to limit bytes at a line or sentence boundary.
func ClampText(value string, limit int) string {
	if len(value) <= limit {
		return value
	}
	slice := strings.ToValidUTF8(value[:limit], "")
	cut := max(strings.LastIndex(slice, "\n"), strings.LastIndex(slice, ". "))
	if cut > len(slice)*6/10 {
		slice = slice[:cut+1]
	}
	return strings.TrimSpace(slice) + "\n[…truncated]"
}
