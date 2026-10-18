package onboarding

import (
	"net/url"
	"regexp"
	"strings"
)

// Brand is what a homepage says about its brand without another request:
// name, description, logo, favicon, keywords, theme color, and the social
// and app store profiles it links to.
type Brand struct {
	AppStoreURLs  []string          `json:"appStoreUrls,omitempty"`
	Description   string            `json:"description,omitempty"`
	Favicon       string            `json:"favicon,omitempty"`
	Keywords      []string          `json:"keywords,omitempty"`
	Logo          string            `json:"logo,omitempty"`
	Name          string            `json:"name,omitempty"`
	PlayStoreURLs []string          `json:"playStoreUrls,omitempty"`
	Socials       map[string]string `json:"socials,omitempty"`
	ThemeColor    string            `json:"themeColor,omitempty"`
}

// socialHosts maps a profile host to the platform name brand profiles use.
var socialHosts = map[string]string{
	"x.com": "x", "twitter.com": "x", "linkedin.com": "linkedin", "instagram.com": "instagram",
	"github.com": "github", "youtube.com": "youtube", "facebook.com": "facebook", "discord.gg": "discord",
	"discord.com": "discord", "reddit.com": "reddit", "producthunt.com": "producthunt", "tiktok.com": "tiktok",
	"threads.net": "threads", "bsky.app": "bluesky", "mastodon.social": "mastodon",
}

var (
	titleSeparator = regexp.MustCompile(`\s[|–—-]\s`)
	hexColor       = regexp.MustCompile(`^#(?:[0-9a-fA-F]{3}){1,2}$`)
)

// ExtractBrand reads the brand from a parsed homepage.
func ExtractBrand(doc *Document, pageURL string) Brand {
	brand := Brand{Socials: map[string]string{}}
	name := doc.Meta["og:site_name"]
	if name == "" {
		name = titleSeparator.Split(doc.Title, 2)[0]
	}
	if name == "" {
		if parsed, err := url.Parse(pageURL); err == nil {
			name = strings.TrimPrefix(parsed.Hostname(), "www.")
		}
	}
	brand.Name = ClampText(strings.TrimSpace(name), 160)
	brand.Description = ClampText(doc.Description, 2_000)
	if color := strings.TrimSpace(doc.Meta["theme-color"]); hexColor.MatchString(color) {
		brand.ThemeColor = strings.ToLower(color)
	}
	for _, keyword := range strings.Split(doc.Meta["keywords"], ",") {
		if keyword = strings.TrimSpace(keyword); keyword != "" && len(brand.Keywords) < 20 {
			brand.Keywords = append(brand.Keywords, ClampText(keyword, 100))
		}
	}
	for _, node := range doc.JSONLD {
		if logo := jsonLDURL(node["logo"]); logo != "" && brand.Logo == "" {
			brand.Logo = resolve(mustParse(pageURL), logo)
		}
	}
	if brand.Logo == "" {
		for _, icon := range doc.Icons {
			if strings.Contains(icon, "apple-touch") {
				brand.Logo = icon
			}
		}
	}
	if len(doc.Icons) > 0 {
		brand.Favicon = doc.Icons[0]
	} else if parsed, err := url.Parse(pageURL); err == nil {
		brand.Favicon = parsed.Scheme + "://" + parsed.Host + "/favicon.ico"
	}
	for _, link := range doc.Links {
		parsed, err := url.Parse(link)
		if err != nil {
			continue
		}
		host := strings.TrimPrefix(strings.ToLower(parsed.Hostname()), "www.")
		switch {
		case host == "apps.apple.com" && strings.Contains(parsed.Path, "/app/"):
			if len(brand.AppStoreURLs) < 3 {
				brand.AppStoreURLs = append(brand.AppStoreURLs, link)
			}
		case host == "play.google.com" && parsed.Query().Get("id") != "":
			if len(brand.PlayStoreURLs) < 3 {
				brand.PlayStoreURLs = append(brand.PlayStoreURLs, link)
			}
		case socialHosts[host] != "" && strings.Trim(parsed.Path, "/") != "":
			if _, seen := brand.Socials[socialHosts[host]]; !seen && len(link) <= 160 {
				brand.Socials[socialHosts[host]] = link
			}
		}
	}
	return brand
}

func mustParse(raw string) *url.URL {
	parsed, _ := url.Parse(raw)
	return parsed
}

func jsonLDURL(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	case map[string]any:
		if text, ok := typed["url"].(string); ok {
			return text
		}
	}
	return ""
}
