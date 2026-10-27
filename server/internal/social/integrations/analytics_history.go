package integrations

import (
	"context"
	"time"
)

// CurrentAnalytics returns a real current measurement without invented historical points.
type CurrentAnalytics interface {
	CurrentMetrics(context.Context, string, string) (map[string]float64, error)
}

// PublishedAnalytics permits a bounded import of authorized provider-originated posts.
type PublishedAnalytics interface {
	PublishedMetrics(context.Context, string, string, time.Time) ([]PublishedMetricPost, error)
}
type PublishedMetricPost struct {
	ID, Text, URL, ThreadRootID string
	At                          time.Time
	IsReply                     bool
	Position                    int
	Counters                    map[string]float64
}
