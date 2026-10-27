// Package releasenotes reads what a release says about itself: the features it
// lists, the pull requests it shipped, and the screenshots it shows. Release
// notes and PR descriptions are third-party text and are cleaned first.
package releasenotes

import (
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"
)

// Kind classifies a feature for marketing: features and improvements are
// announceable, fixes roll into a digest, internal changes are not news.
type Kind string

const (
	KindFeature     Kind = "feature"
	KindImprovement Kind = "improvement"
	KindFix         Kind = "fix"
	KindInternal    Kind = "internal"
	KindOther       Kind = "other"
)

// Feature is one line of a release: what changed, and the PR behind it.
type Feature struct {
	Kind   Kind   `json:"kind"`
	Title  string `json:"title"`
	Number int    `json:"number,omitempty"`
	URL    string `json:"url,omitempty"`
	Author string `json:"author,omitempty"`
}

const (
	// MaxFeatures bounds what one release stores.
	MaxFeatures = 100
	// MaxImages bounds the screenshots fetched from one release or change.
	MaxImages     = 10
	maxTitleRunes = 200
)

var (
	htmlComment = regexp.MustCompile(`(?s)<!--.*?(?:-->|$)`)
	// Control characters other than tab and newline; Postgres text cannot hold NUL.
	control = regexp.MustCompile("[\x00-\x08\x0B-\x1F\x7F-\u009F]")
	// Zero-width, joiner, bidi, BOM, soft hyphen, and Unicode tag characters.
	invisible  = regexp.MustCompile("[\u00AD\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF\U000E0000-\U000E007F]")
	heading    = regexp.MustCompile(`^#{1,6}\s+(.+?)\s*#*\s*$`)
	bullet     = regexp.MustCompile(`^ ?[-*+]\s+(.+)$`)
	generated  = regexp.MustCompile(`^(.*?)\s+by\s+@([A-Za-z0-9-]+(?:\[bot\])?)\s+in\s+(https://github\.com/([^/\s]+)/([^/\s]+)/pull/(\d+))\s*$`)
	prURL      = regexp.MustCompile(`https://github\.com/([^/\s)]+)/([^/\s)]+)/pull/(\d+)`)
	prSuffix   = regexp.MustCompile(`\s*\(?#(\d+)\)?\s*$`)
	mdLink     = regexp.MustCompile(`\[([^\]]*)\]\([^)]*\)`)
	emphasis   = regexp.MustCompile("\\*\\*|__|`")
	space      = regexp.MustCompile(`\s+`)
	prefix     = regexp.MustCompile(`(?i)^(feat|feature|fix|perf|chore|docs|test|tests|ci|build|refactor|style|deps|revert)(\([^)]*\))?!?:\s*`)
	mdImage    = regexp.MustCompile(`!\[[^\]]*\]\(\s*<?(https://[^)\s>]+)>?(?:\s+"[^"]*")?\s*\)`)
	htmlImage  = regexp.MustCompile(`(?i)<img\b[^>]*\bsrc\s*=\s*["'](https://[^"']+)["']`)
	attachment = regexp.MustCompile(`(?m)^\s*(https://github\.com/user-attachments/assets/[0-9a-fA-F-]+)\s*$`)
	skipped    = regexp.MustCompile(`(?i)new contributors|contributors|full changelog`)
)

// Clean removes HTML comments (PR template guidance), control, and invisible
// characters, and cuts the text to max runes. Markup is otherwise kept.
func Clean(text string, max int) string {
	text = htmlComment.ReplaceAllString(text, "")
	text = invisible.ReplaceAllString(control.ReplaceAllString(text, ""), "")
	text = strings.TrimSpace(text)
	if utf8.RuneCountInString(text) <= max {
		return text
	}
	runes := []rune(text)
	return strings.TrimSpace(string(runes[:max-1])) + "…"
}

// Features reads the bullet list of release notes. A section heading sets the
// kind of its bullets; a conventional prefix (feat:, fix:) overrides it.
// GitHub's generated lines ("… by @user in …/pull/12") also give the PR and author.
func Features(notes string) []Feature {
	features := []Feature{}
	section := KindOther
	skip := false
	for _, line := range strings.Split(Clean(notes, 1<<20), "\n") {
		if match := heading.FindStringSubmatch(line); match != nil {
			skip = skipped.MatchString(match[1])
			section = headingKind(match[1])
			continue
		}
		match := bullet.FindStringSubmatch(line)
		if skip || match == nil || len(features) == MaxFeatures {
			continue
		}
		if feature, ok := parseBullet(match[1], section); ok {
			features = append(features, feature)
		}
	}
	return features
}

func parseBullet(text string, section Kind) (Feature, bool) {
	feature := Feature{Kind: section}
	if match := generated.FindStringSubmatch(text); match != nil {
		text, feature.Author, feature.URL = match[1], match[2], match[3]
		feature.Number, _ = strconv.Atoi(match[6])
	} else if match := prURL.FindStringSubmatch(text); match != nil {
		feature.URL = match[0]
		feature.Number, _ = strconv.Atoi(match[3])
		text = strings.TrimSpace(strings.Replace(text, match[0], "", 1))
	}
	if match := prSuffix.FindStringSubmatch(text); match != nil {
		if feature.Number == 0 {
			feature.Number, _ = strconv.Atoi(match[1])
		}
		text = strings.TrimSpace(strings.TrimSuffix(text, match[0]))
	}
	if match := prefix.FindStringSubmatch(text); match != nil {
		feature.Kind = prefixKind(strings.ToLower(match[1]))
		text = text[len(match[0]):]
	}
	text = emphasis.ReplaceAllString(mdLink.ReplaceAllString(text, "$1"), "")
	feature.Title = Clean(space.ReplaceAllString(strings.TrimRight(text, " .,;:"), " "), maxTitleRunes)
	return feature, feature.Title != ""
}

func headingKind(text string) Kind {
	lower := strings.ToLower(text)
	switch {
	case strings.Contains(lower, "fix") || strings.Contains(lower, "bug") || strings.Contains(lower, "patch"):
		return KindFix
	case strings.Contains(lower, "improv") || strings.Contains(lower, "enhanc") || strings.Contains(lower, "perf"):
		return KindImprovement
	case strings.Contains(lower, "feat") || strings.Contains(lower, "new") || strings.Contains(lower, "add") ||
		strings.Contains(lower, "highlight"):
		return KindFeature
	case strings.Contains(lower, "chore") || strings.Contains(lower, "maint") || strings.Contains(lower, "internal") ||
		strings.Contains(lower, "depend") || strings.Contains(lower, "doc") || strings.Contains(lower, "refactor"):
		return KindInternal
	}
	return KindOther
}

func prefixKind(prefix string) Kind {
	switch prefix {
	case "feat", "feature":
		return KindFeature
	case "perf":
		return KindImprovement
	case "fix":
		return KindFix
	}
	return KindInternal
}

// PullRequests lists the PRs of owner/repo the notes link to, in order, once each.
func PullRequests(notes, owner, repo string) []int {
	numbers := []int{}
	seen := map[int]bool{}
	for _, match := range prURL.FindAllStringSubmatch(notes, -1) {
		number, _ := strconv.Atoi(match[3])
		if strings.EqualFold(match[1], owner) && strings.EqualFold(match[2], repo) && !seen[number] {
			seen[number] = true
			numbers = append(numbers, number)
		}
	}
	return numbers
}

// Images lists the https images in Markdown, HTML, or GitHub's bare attachment
// lines, in order, once each, at most MaxImages. Comments are ignored.
func Images(text string) []string {
	text = htmlComment.ReplaceAllString(text, "")
	type found struct {
		at  int
		url string
	}
	var all []found
	for _, pattern := range []*regexp.Regexp{mdImage, htmlImage, attachment} {
		for _, match := range pattern.FindAllStringSubmatchIndex(text, -1) {
			all = append(all, found{match[2], text[match[2]:match[3]]})
		}
	}
	for i := 1; i < len(all); i++ {
		for j := i; j > 0 && all[j].at < all[j-1].at; j-- {
			all[j], all[j-1] = all[j-1], all[j]
		}
	}
	urls := []string{}
	seen := map[string]bool{}
	for _, image := range all {
		if !seen[image.url] && len(urls) < MaxImages {
			seen[image.url] = true
			urls = append(urls, image.url)
		}
	}
	return urls
}

// Title classifies a pull request title by its conventional prefix (a title
// without one is other) and returns it without the prefix.
func Title(title string) (Kind, string) {
	title = strings.TrimSpace(title)
	if match := prefix.FindStringSubmatch(title); match != nil {
		return prefixKind(strings.ToLower(match[1])), strings.TrimSpace(title[len(match[0]):])
	}
	return KindOther, title
}
