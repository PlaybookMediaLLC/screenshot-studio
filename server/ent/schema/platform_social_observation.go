package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/postoptions"
	"time"
)

// PlatformSocialObservation stores a provider read, with unknown values absent.
// Daily receipts make maintenance retries idempotent; values are cumulative
// observations, never engagement events to sum across observation dates.
type PlatformSocialObservation struct{ ent.Schema }

func (PlatformSocialObservation) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "platform_social_observation"}}
}
func (PlatformSocialObservation) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").Immutable(),
		field.String("organization_id").StorageKey("organizationId").Immutable(),
		field.String("social_set_id").StorageKey("socialSetId").Immutable(),
		field.String("connection_id").StorageKey("connectionId").Immutable(),
		field.String("subject_id").StorageKey("subjectId").Immutable(),
		field.Enum("kind").Values("post", "account", "feed").Immutable(),
		field.String("platform").Immutable(),
		field.Time("day").Immutable(),
		field.Time("observed_at").StorageKey("observedAt").Default(time.Now),
		field.JSON("metrics", postoptions.Metrics{}).Optional(),
		field.JSON("external_post", &postoptions.ObservedPost{}).StorageKey("externalPost").Optional(),
		field.JSON("series", []SocialMetricSeries{}).Optional(),
		field.Enum("status").Values("available", "unavailable", "failed"),
	}
}
func (PlatformSocialObservation) Indexes() []ent.Index {
	return []ent.Index{index.Fields("organization_id", "kind", "subject_id", "day").Unique(), index.Fields("organization_id", "social_set_id", "observed_at")}
}

// SocialMetricSeries preserves the provider's dated series and averaging rule.
type SocialMetricSeries struct {
	Label   string              `json:"label"`
	Average bool                `json:"average"`
	Data    []SocialMetricPoint `json:"data"`
}

// SocialMetricPoint is a provider's value and the date to which it belongs.
type SocialMetricPoint struct {
	Date  string `json:"date"`
	Total string `json:"total"`
}
