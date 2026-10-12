// Package helpers ports libraries/helpers/src (auth service and utils) that
// the backend, orchestrator and providers share.
package helpers

import (
	"os"
	"regexp"
	"strings"
)

// HasExtension is has.extension.ts.
func HasExtension(path, extension string) bool {
	if path == "" {
		return false
	}
	ext := extension
	if !strings.HasPrefix(ext, ".") {
		ext = "." + ext
	}
	return strings.Contains(strings.ToLower(path), strings.ToLower(ext))
}

// IsAllowedUploadPath checks RESTRICT_UPLOAD_DOMAINS (valid.url.path.ts).
func IsAllowedUploadPath(text string) bool {
	domain := os.Getenv("RESTRICT_UPLOAD_DOMAINS")
	if domain == "" {
		return true
	}
	if text == "" {
		text = "invalid url"
	}
	return strings.Contains(text, domain)
}

// ValidURLPathMessage is ValidUrlPath's default message.
func ValidURLPathMessage() string {
	return "URL must contain the domain: " + os.Getenv("RESTRICT_UPLOAD_DOMAINS") + " Make sure you first use the upload API route."
}

// ValidURLExtension is the checkValidExtension validator.
func ValidURLExtension(text string) bool {
	path := strings.Split(text, "?")[0]
	for _, ext := range []string{".png", ".jpg", ".jpeg", ".gif", ".webp", ".mp4"} {
		if strings.HasSuffix(path, ext) {
			return true
		}
	}
	return false
}

const ValidURLExtensionMessage = "File must have a valid extension: .png, .jpg, .jpeg, .gif, .webp, or .mp4"

var (
	linkedinCompany      = regexp.MustCompile(`@\[(.*?)]\(urn:li:organization:(\d+)\)`)
	afterLinkedinCompany = regexp.MustCompile(`\[bold]@([^\[]+)\[/bold]`)
)

func LinkedinCompanyPreventRemove(text string) string {
	return linkedinCompany.ReplaceAllString(text, "[bold]@$1[/bold]")
}

func AfterLinkedinCompanyPreventRemove(text string) string {
	return afterLinkedinCompany.ReplaceAllString(text, "<strong>@$1</strong>")
}

// ValidContentMessage is ValidContent's message (valid.images.ts).
const ValidContentMessage = " If images do not exist, content must be a non-empty string."

// ValidContent: content (tags stripped) must be non-empty unless images exist.
func ValidContent(content string, imageCount int) bool {
	return imageCount > 0 || jsTrim(StripTags(content, nil)) != ""
}
