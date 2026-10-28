package githubapp

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type Delivery struct {
	ID             int64     `json:"id"`
	GUID           string    `json:"guid"`
	InstallationID int64     `json:"installation_id"`
	RepositoryID   int64     `json:"repository_id"`
	Event          string    `json:"event"`
	DeliveredAt    time.Time `json:"delivered_at"`
	StatusCode     int       `json:"status_code"`
	Redelivery     bool      `json:"redelivery"`
}
type DeliveryPage struct {
	Deliveries []Delivery
	NextCursor string
}

// App delivery APIs require the App JWT, never an installation token. A page
// is bounded and Link cursors are parsed without following arbitrary URLs.
func (a *App) Deliveries(ctx context.Context, cursor string) (DeliveryPage, error) {
	if len(cursor) > 512 {
		return DeliveryPage{}, ErrIncompleteEvidence
	}
	token, err := a.appJWT()
	if err != nil {
		return DeliveryPage{}, err
	}
	target := a.API + "/app/hook/deliveries?per_page=100"
	if cursor != "" {
		target += "&cursor=" + url.QueryEscape(cursor)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return DeliveryPage{}, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	req.Header.Set("User-Agent", "shots-github-app")
	response, err := a.HTTP.Do(req)
	if err != nil {
		return DeliveryPage{}, err
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		return DeliveryPage{}, StatusError{Status: response.StatusCode, RateLimited: response.StatusCode == 429 || response.Header.Get("Retry-After") != "" || response.Header.Get("X-RateLimit-Remaining") == "0"}
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, (2<<20)+1))
	if err != nil {
		return DeliveryPage{}, err
	}
	if len(body) > 2<<20 {
		return DeliveryPage{}, ErrIncompleteEvidence
	}
	result := DeliveryPage{}
	if json.Unmarshal(body, &result.Deliveries) != nil || result.Deliveries == nil || len(result.Deliveries) > 100 {
		return DeliveryPage{}, ErrIncompleteEvidence
	}
	for _, part := range strings.Split(response.Header.Get("Link"), ",") {
		if !strings.Contains(part, `rel="next"`) {
			continue
		}
		start, end := strings.Index(part, "<"), strings.Index(part, ">")
		if start < 0 || end <= start {
			return DeliveryPage{}, ErrIncompleteEvidence
		}
		u, err := url.Parse(part[start+1 : end])
		base, _ := url.Parse(a.API)
		if err != nil || u.Scheme != base.Scheme || u.Host != base.Host || u.Path != strings.TrimSuffix(base.Path, "/")+"/app/hook/deliveries" {
			return DeliveryPage{}, ErrIncompleteEvidence
		}
		result.NextCursor = u.Query().Get("cursor")
		if result.NextCursor == "" || result.NextCursor == cursor || len(result.NextCursor) > 512 {
			return DeliveryPage{}, ErrIncompleteEvidence
		}
	}
	for _, d := range result.Deliveries {
		if d.ID <= 0 || d.GUID == "" || len(d.GUID) > 255 || d.DeliveredAt.IsZero() {
			return DeliveryPage{}, ErrIncompleteEvidence
		}
	}
	return result, nil
}
func (a *App) Redeliver(ctx context.Context, id string) error {
	if id == "" || strings.Trim(id, "0123456789") != "" {
		return ErrIncompleteEvidence
	}
	token, err := a.appJWT()
	if err != nil {
		return err
	}
	return a.do(ctx, http.MethodPost, fmt.Sprintf("%s/app/hook/deliveries/%s/attempts", a.API, id), "Bearer "+token, nil, nil)
}
