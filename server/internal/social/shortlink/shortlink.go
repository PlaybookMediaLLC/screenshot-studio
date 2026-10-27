// Package shortlink is the original app's ShortLinkService (short-linking/*): Dub,
// Short.io, Kutt and LinkDrip, picked by whichever API key is set.
package shortlink

import (
	"context"
	"os"
	"regexp"
	"strings"
	"sync"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/helpers"
)

// Statistic is one {short, original, clicks} row. The values are whatever
// the provider returned (Dub sends numbers, Kutt strings), so they stay
// untyped to keep the JSON identical.
type Statistic struct {
	Short    any `json:"short,omitempty"`
	Original any `json:"original,omitempty"`
	Clicks   any `json:"clicks,omitempty"`
}

// ShortLinking is the provider interface.
type ShortLinking interface {
	ShortLinkDomain() string
	LinksStatistics(ctx context.Context, links []string) ([]Statistic, error)
	ConvertLinkToShortLink(ctx context.Context, id, link string) (string, error)
	ConvertShortLinkToLink(ctx context.Context, shortLink string) (string, error)
	GetAllLinksStatistics(ctx context.Context, id string, page int) ([]Statistic, error)
}

func getProvider() ShortLinking {
	switch {
	case os.Getenv("DUB_TOKEN") != "":
		return &Dub{}
	case os.Getenv("SHORT_IO_SECRET_KEY") != "":
		return &ShortIo{}
	case os.Getenv("KUTT_API_KEY") != "":
		return &Kutt{}
	case os.Getenv("LINK_DRIP_API_KEY") != "":
		return &LinkDrip{}
	}
	return Empty{}
}

// Service is ShortLinkService.
type Service struct {
	provider ShortLinking
}

// NewService picks the provider once, like the static class field.
func NewService() *Service { return &Service{provider: getProvider()} }

var (
	urlRegex      = regexp.MustCompile(`(https?://(?:www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b(?:[-a-zA-Z0-9()@:%_\+.~#?&//=]*))`)
	shortURLRegex = regexp.MustCompile(`https?://[^\s/$.?#].[^\s]*`)
)

func (s *Service) AskShortLinkedin(messages []string) bool {
	if s.provider.ShortLinkDomain() == "empty" {
		return false
	}
	urls := urlRegex.FindAllString(strings.Join(messages, " "), -1)
	for _, url := range urls {
		if !strings.Contains(url, s.provider.ShortLinkDomain()) {
			return true
		}
	}
	return false
}

// replaceAll maps every URL of each text concurrently and substitutes them,
// failing on the first provider error (Promise.all).
func replaceAll(ctx context.Context, texts []string, re *regexp.Regexp, convert func(ctx context.Context, url string) (string, error)) ([]string, error) {
	out := make([]string, len(texts))
	errs := make([]error, len(texts))
	var wg sync.WaitGroup
	for i, text := range texts {
		wg.Go(func() {
			urls := map[string]string{}
			unique := []string{}
			for _, url := range re.FindAllString(text, -1) {
				if _, seen := urls[url]; !seen {
					urls[url] = ""
					unique = append(unique, url)
				}
			}
			var mu sync.Mutex
			var inner sync.WaitGroup
			for _, url := range unique {
				inner.Go(func() {
					replacement, err := convert(ctx, url)
					mu.Lock()
					defer mu.Unlock()
					if err != nil && errs[i] == nil {
						errs[i] = err
					}
					urls[url] = replacement
				})
			}
			inner.Wait()
			out[i] = re.ReplaceAllStringFunc(text, func(url string) string { return urls[url] })
		})
	}
	wg.Wait()
	for _, err := range errs {
		if err != nil {
			return nil, err
		}
	}
	return out, nil
}

func (s *Service) ConvertTextToShortLinks(ctx context.Context, id string, messagesList []string) ([]string, error) {
	if s.provider.ShortLinkDomain() == "empty" {
		return messagesList, nil
	}

	messages := make([]string, len(messagesList))
	for i, text := range messagesList {
		messages[i] = strings.NewReplacer("&amp;", "&", "&quest;", "?", "&num;", "#").Replace(text)
	}

	return replaceAll(ctx, messages, urlRegex, func(ctx context.Context, url string) (string, error) {
		if !strings.Contains(url, s.provider.ShortLinkDomain()) {
			return s.provider.ConvertLinkToShortLink(ctx, id, url)
		}
		return url, nil // Keep the original URL if it matches the prefix
	})
}

func (s *Service) ConvertShortLinksToLinks(ctx context.Context, messages []string) ([]string, error) {
	if s.provider.ShortLinkDomain() == "empty" {
		return messages, nil
	}

	return replaceAll(ctx, messages, shortURLRegex, func(ctx context.Context, url string) (string, error) {
		if strings.Contains(url, s.provider.ShortLinkDomain()) {
			return s.provider.ConvertShortLinkToLink(ctx, url)
		}
		return url, nil
	})
}

func (s *Service) GetStatistics(ctx context.Context, messages []string) ([]Statistic, error) {
	if s.provider.ShortLinkDomain() == "empty" {
		return []Statistic{}, nil
	}

	// only the first dot is escaped, like String.replace('.', '\\.')
	re, err := regexp.Compile(`https?://` + strings.Replace(s.provider.ShortLinkDomain(), ".", `\.`, 1) + `/[^\s]*`)
	if err != nil {
		return nil, err
	}
	urls := re.FindAllString(helpers.StripTags(strings.Join(messages, " "), nil), -1)
	if len(urls) == 0 {
		return []Statistic{}, nil
	}
	return s.provider.LinksStatistics(ctx, urls)
}

func (s *Service) GetAllLinks(ctx context.Context, id string) ([]Statistic, error) {
	if s.provider.ShortLinkDomain() == "empty" {
		return []Statistic{}, nil
	}
	return s.provider.GetAllLinksStatistics(ctx, id, 1)
}
