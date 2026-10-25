package linkedinpage

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations/social/linkedin"
)

type timeRange struct {
	Start int64 `json:"start"`
	End   int64 `json:"end"`
}

// day is dayjs(timeRange?.start).format('YYYY-MM-DD'): now when absent.
func (t *timeRange) day() string {
	if t == nil {
		return time.Now().Format(time.DateOnly)
	}
	return time.UnixMilli(t.Start).Format(time.DateOnly)
}

type shareStatistics struct {
	UniqueImpressionsCount json.Number `json:"uniqueImpressionsCount"`
	ShareCount             json.Number `json:"shareCount"`
	Engagement             json.Number `json:"engagement"`
	ClickCount             json.Number `json:"clickCount"`
	LikeCount              json.Number `json:"likeCount"`
	ImpressionCount        json.Number `json:"impressionCount"`
	CommentCount           json.Number `json:"commentCount"`
}

type statElement struct {
	TotalPageStatistics *struct {
		Views *struct {
			AllPageViews *struct {
				PageViews json.Number `json:"pageViews"`
			} `json:"allPageViews"`
		} `json:"views"`
	} `json:"totalPageStatistics"`
	FollowerGains *struct {
		OrganicFollowerGain json.Number `json:"organicFollowerGain"`
		PaidFollowerGain    json.Number `json:"paidFollowerGain"`
	} `json:"followerGains"`
	TimeRange            *timeRange       `json:"timeRange"`
	TotalShareStatistics *shareStatistics `json:"totalShareStatistics"`
}

func (p *Provider) statistics(ctx context.Context, accessToken, url string) ([]statElement, error) {
	var out struct {
		Elements []statElement `json:"elements"`
	}
	if err := linkedin.FetchJSON(ctx, http.MethodGet, url, linkedin.Headers(accessToken, ""), nil, &out); err != nil {
		return nil, err
	}
	return out.Elements, nil
}

// series keeps the TypeScript object's key order.
type series struct {
	labels []string
	data   map[string][]integrations.AnalyticsItem
}

func newSeries(labels ...string) *series {
	s := &series{labels: labels, data: map[string][]integrations.AnalyticsItem{}}
	for _, l := range labels {
		s.data[l] = []integrations.AnalyticsItem{}
	}
	return s
}

func (s *series) push(label string, total json.Number, date string) {
	if total == "" {
		return
	}
	s.data[label] = append(s.data[label], integrations.AnalyticsItem{Total: total.String(), Date: date})
}

func (s *series) result(percentageChange float64, skipEmpty bool) []integrations.AnalyticsData {
	out := []integrations.AnalyticsData{}
	for _, l := range s.labels {
		if skipEmpty && len(s.data[l]) == 0 {
			continue
		}
		out = append(out, integrations.AnalyticsData{Label: l, Data: s.data[l], PercentageChange: percentageChange})
	}
	return out
}

func (p *Provider) Analytics(ctx context.Context, id, accessToken string, days int) ([]integrations.AnalyticsData, error) {
	endDate := time.Now().Unix() * 1000
	startDate := time.Now().AddDate(0, 0, -days).Unix() * 1000
	query := func(path, param string) string {
		return fmt.Sprintf("%s/v2/%s?q=%s&%s=%s&timeIntervals=(timeRange:(start:%d,end:%d),timeGranularityType:DAY)",
			linkedin.APIURL, path, param, param, linkedin.EncodeURIComponent("urn:li:organization:"+id), startDate, endDate)
	}

	var fetched [3][]statElement
	for i, url := range []string{
		query("organizationPageStatistics", "organization"),
		query("organizationalEntityFollowerStatistics", "organizationalEntity"),
		query("organizationalEntityShareStatistics", "organizationalEntity"),
	} {
		elements, err := p.statistics(ctx, accessToken, url)
		if err != nil {
			return nil, err
		}
		if elements == nil {
			return nil, errors.New("elements is not iterable")
		}
		fetched[i] = elements
	}
	// [...followers, ...page, ...shares]
	all := slices.Concat(fetched[1], fetched[0], fetched[2])

	analytics := newSeries("Page Views", "Clicks", "Shares", "Engagement", "Comments", "Organic Followers", "Paid Followers")
	for _, current := range all {
		date := current.TimeRange.day()
		if s := current.TotalPageStatistics; s != nil && s.Views != nil && s.Views.AllPageViews != nil && s.Views.AllPageViews.PageViews != "" {
			analytics.push("Page Views", s.Views.AllPageViews.PageViews, date)
		}
		if g := current.FollowerGains; g != nil && g.OrganicFollowerGain != "" {
			analytics.push("Organic Followers", g.OrganicFollowerGain, date)
		}
		if g := current.FollowerGains; g != nil && g.PaidFollowerGain != "" {
			analytics.push("Paid Followers", g.PaidFollowerGain, date)
		}
		if s := current.TotalShareStatistics; s != nil {
			analytics.push("Clicks", s.ClickCount, date)
			analytics.push("Shares", s.ShareCount, date)
			analytics.push("Engagement", s.Engagement, date)
			analytics.push("Comments", s.CommentCount, date)
		}
	}
	return analytics.result(0, true), nil
}

// orZero is `value || 0`.
func orZero(n json.Number) json.Number {
	if f, err := n.Float64(); err != nil || f == 0 {
		return "0"
	}
	return n
}

func (p *Provider) PostAnalytics(ctx context.Context, integrationID, accessToken, postID string, _ int64) ([]integrations.AnalyticsData, error) {
	// Lifetime share statistics for the specific post. LinkedIn does not
	// support time-bound statistics for specific share queries, so no
	// timeIntervals is sent and elements come back without a timeRange.
	shareElements, err := p.statistics(ctx, accessToken,
		linkedin.APIURL+"/v2/organizationalEntityShareStatistics?q=organizationalEntity&organizationalEntity="+
			linkedin.EncodeURIComponent("urn:li:organization:"+integrationID)+"&shares=List("+linkedin.EncodeURIComponent(postID)+")")
	if err != nil {
		return nil, err
	}

	// Social actions (likes, comments) may not be available for all posts.
	var socialActions *struct {
		LikesSummary *struct {
			TotalLikes json.Number `json:"totalLikes"`
		} `json:"likesSummary"`
		CommentsSummary *struct {
			TotalFirstLevelComments json.Number `json:"totalFirstLevelComments"`
		} `json:"commentsSummary"`
	}
	if linkedin.FetchJSON(ctx, http.MethodGet, linkedin.APIURL+"/v2/socialActions/"+linkedin.EncodeURIComponent(postID),
		linkedin.Headers(accessToken, ""), nil, &socialActions) != nil {
		socialActions = nil
	}

	analytics := newSeries("Impressions", "Unique Impressions", "Clicks", "Likes", "Comments", "Shares", "Engagement")
	found := false
	for _, current := range shareElements {
		s := current.TotalShareStatistics
		if s == nil {
			continue
		}
		found = true
		date := current.TimeRange.day()
		analytics.push("Impressions", s.ImpressionCount, date)
		analytics.push("Unique Impressions", s.UniqueImpressionsCount, date)
		analytics.push("Clicks", s.ClickCount, date)
		analytics.push("Likes", s.LikeCount, date)
		analytics.push("Comments", s.CommentCount, date)
		analytics.push("Shares", s.ShareCount, date)
		analytics.push("Engagement", s.Engagement, date)
	}

	// No time series data but social actions: a single data point for today.
	if !found && socialActions != nil {
		today := time.Now().Format(time.DateOnly)
		var likes, comments json.Number
		if socialActions.LikesSummary != nil {
			likes = socialActions.LikesSummary.TotalLikes
		}
		if socialActions.CommentsSummary != nil {
			comments = socialActions.CommentsSummary.TotalFirstLevelComments
		}
		analytics.push("Likes", likes, today)
		analytics.push("Comments", comments, today)
	}
	return analytics.result(0, true), nil
}
