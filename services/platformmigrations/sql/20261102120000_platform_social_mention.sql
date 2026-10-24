-- A set's mention directory survives editing, archiving and deletion of drafts.
-- It is only lookup history: provider permissions remain authoritative.
CREATE TABLE platform_social_mention (
 id text PRIMARY KEY,
 "organizationId" text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
 "socialSetId" text NOT NULL REFERENCES social_set(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK (kind IN ('organization','person')),
 "providerId" text NOT NULL,
 label text NOT NULL,
 "lastUsedAt" timestamptz NOT NULL,
 UNIQUE ("organizationId", "socialSetId", kind, "providerId")
);
CREATE INDEX platform_social_mention_recency ON platform_social_mention("organizationId", "socialSetId", kind, "lastUsedAt" DESC);

-- Backfill all saved primary/manual versions, including drafts older than the
-- former 100-draft lookup window. DISTINCT removes JSONPath recursive duplicates.
WITH mentions AS (
 SELECT d."organizationId", d."socialSetId", d."updatedAt",
   CASE WHEN node->>'kind'='person' THEN 'person' ELSE 'organization' END AS kind,
   node->>'providerId' AS provider_id, node->>'label' AS label
 FROM content_draft d
 CROSS JOIN LATERAL jsonb_path_query(jsonb_build_array(d.body,d."platformVersions"),
   '$.** ? (@.type == "social_mention" && @.platform == "linkedin")') AS node
 WHERE d."socialSetId" IS NOT NULL
   AND jsonb_typeof(node->'label')='string' AND length(btrim(node->>'label')) BETWEEN 1 AND 500
   AND ((node->>'kind'='person' AND node->>'providerId' ~ '^urn:li:person:[A-Za-z0-9_-]{1,100}$')
     OR ((node->>'kind'='organization' OR node->>'kind' IS NULL) AND node->>'providerId' ~ '^urn:li:organization:[0-9]{1,30}$'))
), latest AS (
 SELECT DISTINCT ON ("organizationId", "socialSetId", kind, provider_id) * FROM mentions
 ORDER BY "organizationId", "socialSetId", kind, provider_id, "updatedAt" DESC, label
)
INSERT INTO platform_social_mention (id,"organizationId","socialSetId",kind,"providerId",label,"lastUsedAt")
SELECT md5("organizationId"||chr(31)||"socialSetId"||chr(31)||kind||chr(31)||provider_id),
 "organizationId","socialSetId",kind,provider_id,label,"updatedAt" FROM latest;
