package linkedin

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations"
)

var personURN = regexp.MustCompile(`^urn:li:person:[A-Za-z0-9_-]{1,100}$`)
var organizationID = regexp.MustCompile(`^[0-9]{1,30}$`)

// PageOAuthScopes requests the restricted follower lookup grant only when the
// deployment has enabled its approved LinkedIn Community Management product.
func PageOAuthScopes() []string {
	scopes := append([]string{}, PageScopes...)
	if os.Getenv("PLATFORM_LINKEDIN_PEOPLE_MENTIONS_ENABLED") == "true" {
		scopes = append(scopes, "r_organization_followers")
	}
	return scopes
}

// People searches only followers the authenticated Page can mention. The
// provider enforces its restricted application grant and the member's Page role;
// a refusal must never be represented as an empty successful directory.
func (p *Provider) People(ctx context.Context, token, query, pageID string) ([]integrations.MentionResult, error) {
	if p.identifier != "linkedin-page" || !organizationID.MatchString(pageID) {
		return nil, fmt.Errorf("people lookup requires a connected LinkedIn Page")
	}
	if os.Getenv("PLATFORM_LINKEDIN_PEOPLE_MENTIONS_ENABLED") != "true" {
		return nil, fmt.Errorf("LinkedIn follower lookup requires approved People Typeahead access")
	}
	query = strings.TrimSpace(query)
	if utf8.RuneCountInString(query) < 2 || utf8.RuneCountInString(query) > 100 {
		return nil, fmt.Errorf("search Page followers with 2 to 100 characters")
	}
	params := url.Values{"q": {"organizationFollowers"}, "keywords": {query}, "organization": {"urn:li:organization:" + pageID}, "count": {"10"}}
	var out struct {
		Elements []struct {
			Member    string `json:"member"`
			PersonURN string `json:"personUrn"`
			FirstName string `json:"firstName"`
			LastName  string `json:"lastName"`
		} `json:"elements"`
	}
	// Use the native client's status handling rather than decoding a 403 body as
	// an empty result. No credentials, guessed IDs or cross-Page cache is used.
	response, err := p.Fetch(ctx, APIURL+"/rest/peopleTypeahead?"+params.Encode(), integrations.Request{Method: http.MethodGet, Headers: Headers(token, "")})
	if err != nil {
		return nil, err
	}
	if err := response.JSON(&out); err != nil {
		return nil, err
	}
	if out.Elements == nil {
		return nil, fmt.Errorf("LinkedIn did not return a people lookup result")
	}
	found := []integrations.MentionResult{}
	seen := map[string]bool{}
	for _, member := range out.Elements {
		id := member.PersonURN
		if id == "" {
			id = member.Member
		}
		label := strings.TrimSpace(member.FirstName + " " + member.LastName)
		if !personURN.MatchString(id) || label == "" || utf8.RuneCountInString(label) > 257 || seen[id] {
			continue
		}
		found = append(found, integrations.MentionResult{ID: id, Label: label})
		seen[id] = true
		if len(found) == 10 {
			break
		}
	}
	return found, nil
}
