package product

import (
	"context"
	"errors"
	"net/url"
	"strings"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
	observation "github.com/PlaybookMediaLLC/screenshot-studio/services/ent/platformsocialobservation"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/scheduledpost"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/postoptions"
)

// RecentPostMetricsReader discovers recent posts through the existing provider adapter.
type RecentPostMetricsReader interface {
	RecentPostMetrics(context.Context, string, string, string, string) ([]postoptions.ObservedPost, error)
}

func (c *Configuration) collectObservedPosts(ctx context.Context, connection *ent.ChannelConnection, reader RecentPostMetricsReader) error {
	readCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	posts, readErr := reader.RecentPostMetrics(readCtx, connection.OrganizationID, connection.ExternalAccountID, connection.Platform, connection.SecretReference)
	cancel()
	now := time.Now().UTC()
	if len(posts) > 100 {
		readErr = errors.New("provider timeline exceeded the observation limit")
	}
	if readErr == nil {
		for _, post := range posts {
			u, err := url.Parse(post.URL)
			if err != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil || post.ID == "" || len(post.ID) > 200 || len(post.Caption) > 100_000 || !validMetrics(post.Metrics) || post.PublishedAt.IsZero() || post.PublishedAt.After(now.Add(time.Minute)) {
				readErr = errors.New("provider returned invalid timeline data")
				break
			}
		}
	}
	if readErr == nil {
		seen := map[string]bool{}
		for _, post := range posts {
			if seen[post.ID] || post.PublishedAt.Before(now.AddDate(0, 0, -30)) {
				continue
			}
			seen[post.ID] = true
			subject := "external:" + connection.ID + ":" + post.ID
			canonical, err := c.client.ScheduledPost.Query().Where(scheduledpost.OrganizationID(connection.OrganizationID), scheduledpost.ChannelConnectionID(connection.ID), scheduledpost.RemotePostID(post.ID), scheduledpost.StatusEQ(scheduledpost.StatusPUBLISHED)).First(ctx)
			if err != nil && !ent.IsNotFound(err) {
				return err
			}
			if canonical != nil {
				// A known publication has one identity in reports, even if discovered first.
				if _, err := c.client.PlatformSocialObservation.Delete().Where(observation.OrganizationID(connection.OrganizationID), observation.ConnectionID(connection.ID), observation.SubjectID(subject)).Exec(ctx); err != nil {
					return err
				}
				subject = canonical.ID
			}
			detail := &post
			if !strings.HasPrefix(subject, "external:") {
				detail = nil
			}
			if err := saveSocialObservation(ctx, c.client, connection, "post", subject, now, post.Metrics, nil, nil, detail); err != nil {
				return err
			}
		}
	}
	return saveSocialObservation(ctx, c.client, connection, "feed", connection.ID, now, nil, nil, readErr)
}
