package releasenotes

import (
	"reflect"
	"strings"
	"testing"
)

const generatedNotes = `<!-- Release notes generated using configuration in .github/release.yml -->

## What's Changed
### 🎉 New Features
* Add recurring invoices by @octocat in https://github.com/acme/app/pull/12
* feat(billing): Dark mode for **every** screen by @hubot in https://github.com/acme/app/pull/13
### 🐛 Bug Fixes
* Fix crash on [empty](https://x.test) carts by @octocat in https://github.com/acme/app/pull/14
### Other Changes
* chore(deps): bump left-pad from 1.0.0 to 1.3.0 by @dependabot[bot] in https://github.com/acme/app/pull/15
* Speed up exports by @octocat in https://github.com/acme/app/pull/16

## New Contributors
* @hubot made their first contribution in https://github.com/acme/app/pull/13

**Full Changelog**: https://github.com/acme/app/compare/v1.0.0...v1.1.0`

func TestFeaturesFromGitHubGeneratedNotes(t *testing.T) {
	want := []Feature{
		{Kind: KindFeature, Title: "Add recurring invoices", Number: 12, URL: "https://github.com/acme/app/pull/12", Author: "octocat"},
		{Kind: KindFeature, Title: "Dark mode for every screen", Number: 13, URL: "https://github.com/acme/app/pull/13", Author: "hubot"},
		{Kind: KindFix, Title: "Fix crash on empty carts", Number: 14, URL: "https://github.com/acme/app/pull/14", Author: "octocat"},
		{Kind: KindInternal, Title: "bump left-pad from 1.0.0 to 1.3.0", Number: 15, URL: "https://github.com/acme/app/pull/15", Author: "dependabot[bot]"},
		{Kind: KindOther, Title: "Speed up exports", Number: 16, URL: "https://github.com/acme/app/pull/16", Author: "octocat"},
	}
	if got := Features(generatedNotes); !reflect.DeepEqual(got, want) {
		t.Fatalf("features:\n got %+v\nwant %+v", got, want)
	}
}

func TestFeaturesFromHandWrittenNotes(t *testing.T) {
	notes := "# v2.0\nWe rebuilt billing.\n\n## Highlights\n- Recurring invoices (#21)\n- perf: 2x faster exports #22\n" +
		"  - a nested detail that is not a feature\n\n## Improvements\n+ Smoother onboarding\n\n## Fixes\n- fix: timezone bug\n\n" +
		"Prose without bullets is not a feature."
	want := []Feature{
		{Kind: KindFeature, Title: "Recurring invoices", Number: 21},
		{Kind: KindImprovement, Title: "2x faster exports", Number: 22},
		{Kind: KindImprovement, Title: "Smoother onboarding"},
		{Kind: KindFix, Title: "timezone bug"},
	}
	if got := Features(notes); !reflect.DeepEqual(got, want) {
		t.Fatalf("features:\n got %+v\nwant %+v", got, want)
	}
	if got := Features("Just a paragraph."); len(got) != 0 {
		t.Fatalf("prose produced features: %+v", got)
	}
	many := strings.Repeat("- item\n", 150)
	if got := Features(many); len(got) != MaxFeatures {
		t.Fatalf("features=%d want %d", len(got), MaxFeatures)
	}
}

func TestPullRequestsOnlyFromTheSameRepository(t *testing.T) {
	notes := generatedNotes + "\nSee also https://github.com/other/repo/pull/99 and https://github.com/ACME/App/pull/12."
	if got := PullRequests(notes, "acme", "app"); !reflect.DeepEqual(got, []int{12, 13, 14, 15, 16}) {
		t.Fatalf("pull requests=%v", got)
	}
}

func TestImagesInOrderOnceEachIgnoringComments(t *testing.T) {
	body := "Before:\n![before](https://example.com/a.png)\n<img width=\"600\" src=\"https://example.com/b.png\" alt=\"after\">\n" +
		"https://github.com/user-attachments/assets/0f3c1a2b-1111-2222-3333-444455556666\n" +
		"![again](https://example.com/a.png)\n![insecure](http://example.com/c.png)\n" +
		"<!-- ![hidden](https://example.com/hidden.png) -->\ninline https://github.com/user-attachments/assets/aaaa is not an image line"
	want := []string{
		"https://example.com/a.png", "https://example.com/b.png",
		"https://github.com/user-attachments/assets/0f3c1a2b-1111-2222-3333-444455556666",
	}
	if got := Images(body); !reflect.DeepEqual(got, want) {
		t.Fatalf("images:\n got %v\nwant %v", got, want)
	}
	if got := Images(strings.Repeat("![x](https://example.com/x.png?n=1)\n![y](https://example.com/y.png)\n", 1)); len(got) != 2 {
		t.Fatalf("images=%v", got)
	}
}

func TestCleanStripsWhatPostgresAndReadersShouldNotSee(t *testing.T) {
	if got := Clean("<!-- template -->\nReal\x00 text​ here", 100); got != "Real text here" {
		t.Fatalf("clean=%q", got)
	}
	if got := Clean(strings.Repeat("é", 20), 10); got != strings.Repeat("é", 9)+"…" {
		t.Fatalf("cut=%q", got)
	}
	if got := Clean("visible <!-- unclosed", 100); got != "visible" {
		t.Fatalf("unclosed=%q", got)
	}
}

func TestTitleStripsTheConventionalPrefix(t *testing.T) {
	for title, want := range map[string][2]string{
		"feat(billing): Recurring invoices": {"feature", "Recurring invoices"},
		"fix!: Timezones":                   {"fix", "Timezones"},
		"chore: deps":                       {"internal", "deps"},
		"Add a thing":                       {"other", "Add a thing"},
	} {
		kind, got := Title(title)
		if string(kind) != want[0] || got != want[1] {
			t.Fatalf("%q → %s %q", title, kind, got)
		}
	}
}
