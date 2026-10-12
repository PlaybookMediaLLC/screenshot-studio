package shortlink

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
)

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// lastSegment is link.split('/').pop().
func lastSegment(link string) string { return link[strings.LastIndex(link, "/")+1:] }

// call sends a JSON request and decodes the JSON answer into out, whatever
// the status (fetch(...).json()). It returns the status for the providers
// that check response.ok.
func call(ctx context.Context, method, url string, headers map[string]string, body, out any) (int, error) {
	var reader io.Reader
	if body != nil {
		data, _ := json.Marshal(body)
		reader = bytes.NewReader(data)
	}
	req, err := http.NewRequestWithContext(ctx, method, url, reader)
	if err != nil {
		return 0, err
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return 0, err
	}
	defer res.Body.Close()
	if out == nil {
		return res.StatusCode, nil
	}
	return res.StatusCode, json.NewDecoder(res.Body).Decode(out)
}

func ok(status int) bool { return status >= 200 && status <= 299 }

// Dub

type Dub struct{}

func dubEndpoint() string { return env("DUB_API_ENDPOINT", "https://api.dub.co") }

func dubHeaders() map[string]string {
	return map[string]string{"Authorization": "Bearer " + os.Getenv("DUB_TOKEN"), "Content-Type": "application/json"}
}

func (*Dub) ShortLinkDomain() string { return env("DUB_SHORT_LINK_DOMAIN", "dub.sh") }

func (d *Dub) LinksStatistics(ctx context.Context, links []string) ([]Statistic, error) {
	return each(links, func(link string) (Statistic, error) {
		var response map[string]any
		if _, err := call(ctx, http.MethodGet, fmt.Sprintf("%s/links/info?domain=%s&key=%s", dubEndpoint(), d.ShortLinkDomain(), lastSegment(link)), dubHeaders(), nil, &response); err != nil {
			return Statistic{}, err
		}
		return Statistic{Short: link, Original: response["url"], Clicks: response["clicks"]}, nil
	})
}

func (d *Dub) ConvertLinkToShortLink(ctx context.Context, id, link string) (string, error) {
	var response struct {
		ShortLink string `json:"shortLink"`
	}
	_, err := call(ctx, http.MethodPost, dubEndpoint()+"/links", dubHeaders(), map[string]any{
		"url":      link,
		"tenantId": id,
		"domain":   d.ShortLinkDomain(),
	}, &response)
	return response.ShortLink, err
}

func (*Dub) ConvertShortLinkToLink(ctx context.Context, shortLink string) (string, error) {
	var response struct {
		URL string `json:"url"`
	}
	_, err := call(ctx, http.MethodGet, dubEndpoint()+"/links/info?domain="+shortLink, dubHeaders(), nil, &response)
	return response.URL, err
}

// GetAllLinksStatistics gets at most 100 links per request and recurses
// until a page has fewer than 100.
func (d *Dub) GetAllLinksStatistics(ctx context.Context, id string, page int) ([]Statistic, error) {
	var response struct {
		Links  []any `json:"links"`
		URL    any   `json:"url"`
		Clicks any   `json:"clicks"`
	}
	if _, err := call(ctx, http.MethodGet, fmt.Sprintf("%s/links?tenantId=%s&page=%d&pageSize=100", dubEndpoint(), id, page), dubHeaders(), nil, &response); err != nil {
		return nil, err
	}
	mapLinks := make([]Statistic, 0, len(response.Links))
	for _, link := range response.Links {
		mapLinks = append(mapLinks, Statistic{Short: link, Original: response.URL, Clicks: response.Clicks})
	}
	if len(mapLinks) < 100 {
		return mapLinks, nil
	}
	next, err := d.GetAllLinksStatistics(ctx, id, page+1)
	if err != nil {
		return nil, err
	}
	return append(mapLinks, next...), nil
}

// each is Promise.all over links.
func each[T any](links []T, fn func(link T) (Statistic, error)) ([]Statistic, error) {
	out := make([]Statistic, len(links))
	errs := make(chan error, len(links))
	for i, link := range links {
		go func() {
			var err error
			out[i], err = fn(link)
			errs <- err
		}()
	}
	var first error
	for range links {
		if err := <-errs; err != nil && first == nil {
			first = err
		}
	}
	if first != nil {
		return nil, first
	}
	return out, nil
}

// Short.io

type ShortIo struct{}

// shortIoAPI and shortIoStatistics are overridden in tests.
var (
	shortIoAPI        = "https://api.short.io"
	shortIoStatistics = "https://statistics.short.io"
)

func shortIoHeaders() map[string]string {
	return map[string]string{"Authorization": "Bearer " + os.Getenv("SHORT_IO_SECRET_KEY"), "Content-Type": "application/json"}
}

func (*ShortIo) ShortLinkDomain() string { return "short.io" }

func (s *ShortIo) LinksStatistics(ctx context.Context, links []string) ([]Statistic, error) {
	return each(links, func(link string) (Statistic, error) {
		var response map[string]any
		if _, err := call(ctx, http.MethodGet, fmt.Sprintf("%s/links/expand?domain=%s&path=%s", shortIoAPI, s.ShortLinkDomain(), lastSegment(link)), shortIoHeaders(), nil, &response); err != nil {
			return Statistic{}, err
		}
		var stat map[string]any
		if _, err := call(ctx, http.MethodGet, fmt.Sprintf("%s/statistics/link/%v?period=last30&tz=UTC", shortIoStatistics, jsValue(response["id"])), shortIoHeaders(), nil, &stat); err != nil {
			return Statistic{}, err
		}
		return Statistic{Short: response["shortURL"], Original: response["originalURL"], Clicks: stat["totalClicks"]}, nil
	})
}

// jsValue renders a value the way a template literal would.
func jsValue(v any) string {
	switch t := v.(type) {
	case nil:
		return "undefined"
	case float64:
		return strconv.FormatFloat(t, 'f', -1, 64)
	}
	return fmt.Sprint(v)
}

func (s *ShortIo) ConvertLinkToShortLink(ctx context.Context, id, link string) (string, error) {
	var response struct {
		ShortURL string `json:"shortURL"`
	}
	_, err := call(ctx, http.MethodPost, shortIoAPI+"/links", shortIoHeaders(), map[string]any{
		"url":         link,
		"tenantId":    id,
		"domain":      s.ShortLinkDomain(),
		"originalURL": link,
	}, &response)
	return response.ShortURL, err
}

func (s *ShortIo) ConvertShortLinkToLink(ctx context.Context, shortLink string) (string, error) {
	var response struct {
		OriginalURL string `json:"originalURL"`
	}
	_, err := call(ctx, http.MethodGet, fmt.Sprintf("%s/links/expand?domain=%s&path=%s", shortIoAPI, s.ShortLinkDomain(), lastSegment(shortLink)), shortIoHeaders(), nil, &response)
	return response.OriginalURL, err
}

// GetAllLinksStatistics lists every link of the domain (id is Short.io's
// domain_id), 150 per request following nextPageToken, and reads each link's
// last-30-days clicks. The page argument is unused: Short.io paginates by
// token. (Postiz returned un-awaited promises, which serialized as {}, and
// re-requested the same first page forever once a domain had 100+ links.)
func (s *ShortIo) GetAllLinksStatistics(ctx context.Context, id string, _ int) ([]Statistic, error) {
	type link struct {
		ID          any `json:"id"`
		ShortURL    any `json:"shortURL"`
		OriginalURL any `json:"originalURL"`
	}
	out := []Statistic{}
	pageToken := ""
	for {
		endpoint := fmt.Sprintf("%s/api/links?domain_id=%s&limit=150", shortIoAPI, url.QueryEscape(id))
		if pageToken != "" {
			endpoint += "&pageToken=" + url.QueryEscape(pageToken)
		}
		var response struct {
			Links         []link `json:"links"`
			NextPageToken string `json:"nextPageToken"`
		}
		status, err := call(ctx, http.MethodGet, endpoint, shortIoHeaders(), nil, &response)
		if err != nil {
			return nil, err
		}
		if !ok(status) {
			return nil, fmt.Errorf("short.io links: HTTP %d", status)
		}
		page, err := each(response.Links, func(l link) (Statistic, error) {
			var stat map[string]any
			if _, err := call(ctx, http.MethodGet, fmt.Sprintf("%s/statistics/link/%v?period=last30&tz=UTC", shortIoStatistics, jsValue(l.ID)), shortIoHeaders(), nil, &stat); err != nil {
				return Statistic{}, err
			}
			return Statistic{Short: l.ShortURL, Original: l.OriginalURL, Clicks: stat["totalClicks"]}, nil
		})
		if err != nil {
			return nil, err
		}
		out = append(out, page...)
		if response.NextPageToken == "" {
			return out, nil
		}
		pageToken = response.NextPageToken
	}
}

// Kutt

type Kutt struct{}

func kuttEndpoint() string { return env("KUTT_API_ENDPOINT", "https://kutt.it/api/v2") }

func kuttHeaders() map[string]string {
	return map[string]string{"X-API-Key": os.Getenv("KUTT_API_KEY"), "Content-Type": "application/json"}
}

func (*Kutt) ShortLinkDomain() string { return env("KUTT_SHORT_LINK_DOMAIN", "kutt.it") }

func (*Kutt) LinksStatistics(ctx context.Context, links []string) ([]Statistic, error) {
	return each(links, func(link string) (Statistic, error) {
		var data struct {
			Address string `json:"address"`
			LastDay *struct {
				Stats []float64 `json:"stats"`
			} `json:"lastDay"`
		}
		status, err := call(ctx, http.MethodGet, fmt.Sprintf("%s/links/%s/stats", kuttEndpoint(), lastSegment(link)), kuttHeaders(), nil, &data)
		if err != nil || !ok(status) {
			return Statistic{Short: link, Original: "", Clicks: "0"}, nil
		}
		clicks := "0"
		if data.LastDay != nil && data.LastDay.Stats != nil {
			total := 0.0
			for _, stat := range data.LastDay.Stats {
				total += stat
			}
			clicks = strconv.FormatFloat(total, 'f', -1, 64)
		}
		return Statistic{Short: link, Original: data.Address, Clicks: clicks}, nil
	})
}

func (k *Kutt) ConvertLinkToShortLink(ctx context.Context, id, link string) (string, error) {
	var data struct {
		Link string `json:"link"`
	}
	status, err := call(ctx, http.MethodPost, kuttEndpoint()+"/links", kuttHeaders(), map[string]any{
		"target": link,
		"domain": k.ShortLinkDomain(),
		"reuse":  false,
	}, &data)
	if status != 0 && !ok(status) {
		err = fmt.Errorf("HTTP error! status: %d", status)
	}
	if err != nil {
		return "", fmt.Errorf("Failed to create short link: Error: %v", err)
	}
	return data.Link, nil
}

func (*Kutt) ConvertShortLinkToLink(ctx context.Context, shortLink string) (string, error) {
	var data struct {
		Address string `json:"address"`
	}
	status, err := call(ctx, http.MethodGet, fmt.Sprintf("%s/links/%s/stats", kuttEndpoint(), lastSegment(shortLink)), kuttHeaders(), nil, &data)
	if status != 0 && !ok(status) {
		err = fmt.Errorf("HTTP error! status: %d", status)
	}
	if err != nil {
		return "", fmt.Errorf("Failed to get original link: Error: %v", err)
	}
	return data.Address, nil
}

func (k *Kutt) GetAllLinksStatistics(ctx context.Context, id string, page int) ([]Statistic, error) {
	var data struct {
		Data []struct {
			Link       any `json:"link"`
			Address    any `json:"address"`
			VisitCount any `json:"visit_count"`
		} `json:"data"`
	}
	status, err := call(ctx, http.MethodGet, fmt.Sprintf("%s/links?limit=100&skip=%d", kuttEndpoint(), (page-1)*100), kuttHeaders(), nil, &data)
	if err != nil || !ok(status) {
		return []Statistic{}, nil
	}
	mapLinks := make([]Statistic, 0, len(data.Data))
	for _, link := range data.Data {
		clicks := "0"
		if link.VisitCount != nil {
			clicks = jsValue(link.VisitCount)
		}
		mapLinks = append(mapLinks, Statistic{Short: link.Link, Original: link.Address, Clicks: clicks})
	}
	if len(mapLinks) < 100 {
		return mapLinks, nil
	}
	next, _ := k.GetAllLinksStatistics(ctx, id, page+1)
	return append(mapLinks, next...), nil
}

// LinkDrip

type LinkDrip struct{}

func (*LinkDrip) ShortLinkDomain() string { return env("LINK_DRIP_SHORT_LINK_DOMAIN", "dripl.ink") }

func (*LinkDrip) LinksStatistics(context.Context, []string) ([]Statistic, error) {
	return []Statistic{}, nil
}

func (l *LinkDrip) ConvertLinkToShortLink(ctx context.Context, id, link string) (string, error) {
	var data struct {
		Link string `json:"link"`
	}
	status, err := call(ctx, http.MethodPost, env("LINK_DRIP_API_ENDPOINT", "https://api.linkdrip.com/v1/")+"/create", map[string]string{
		"Authorization": "Bearer " + os.Getenv("LINK_DRIP_API_KEY"),
		"Content-Type":  "application/json",
	}, map[string]any{
		"target_url":    link,
		"custom_domain": l.ShortLinkDomain(),
	}, &data)
	if status != 0 && !ok(status) {
		err = fmt.Errorf("Failed to create LinkDrip API short link with status: %d", status)
	}
	if err != nil {
		return "", fmt.Errorf("Failed to create LinkDrip short link: Error: %v", err)
	}
	return data.Link, nil
}

func (*LinkDrip) ConvertShortLinkToLink(context.Context, string) (string, error) { return "", nil }

func (*LinkDrip) GetAllLinksStatistics(context.Context, string, int) ([]Statistic, error) {
	return []Statistic{}, nil
}

// Empty

type Empty struct{}

func (Empty) ShortLinkDomain() string { return "empty" }
func (Empty) LinksStatistics(context.Context, []string) ([]Statistic, error) {
	return []Statistic{}, nil
}
func (Empty) ConvertLinkToShortLink(context.Context, string, string) (string, error) {
	return "", nil
}
func (Empty) ConvertShortLinkToLink(context.Context, string) (string, error) { return "", nil }
func (Empty) GetAllLinksStatistics(context.Context, string, int) ([]Statistic, error) {
	return []Statistic{}, nil
}
