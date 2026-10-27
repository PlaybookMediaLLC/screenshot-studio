CREATE TABLE platform_social_observation (
 id text PRIMARY KEY,
 "organizationId" text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
 "socialSetId" text NOT NULL REFERENCES social_set(id) ON DELETE CASCADE,
 "connectionId" text NOT NULL REFERENCES channel_connection(id) ON DELETE CASCADE,
 "subjectId" text NOT NULL,
 kind text NOT NULL CHECK (kind IN ('post','account')),
 platform text NOT NULL,
 day timestamptz NOT NULL,
 "observedAt" timestamptz NOT NULL DEFAULT now(),
 metrics jsonb,
 series jsonb,
 status text NOT NULL CHECK (status IN ('available','unavailable','failed'))
);
CREATE UNIQUE INDEX platformsocialobservation_organization_id_kind_subject_id_day
 ON platform_social_observation ("organizationId",kind,"subjectId",day);
CREATE INDEX platformsocialobservation_organization_id_social_set_id_observed_at
 ON platform_social_observation ("organizationId","socialSetId","observedAt");

ALTER TABLE scheduled_post ADD COLUMN "publishedAt" timestamptz;
-- Only successful receipts establish a publication time; do not guess from schedules.
UPDATE scheduled_post p SET "publishedAt" = a.published
FROM (SELECT "scheduledPostId", min("completedAt") AS published FROM publication_attempt
WHERE outcome='SUCCEEDED' GROUP BY "scheduledPostId") a
WHERE p.id=a."scheduledPostId" AND p.status='PUBLISHED';
CREATE INDEX scheduled_post_metrics_due ON scheduled_post ("publishedAt") WHERE status='PUBLISHED';
