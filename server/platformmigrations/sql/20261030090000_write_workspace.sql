-- Write (RFC 025) on the settings platform's social sets (RFC 024): tags and
-- thread finishers of a set, and a draft's kind, target, platform versions,
-- internal notes, pin and plan zone. A set's tags are records with colours;
-- the string tags RFC 024 kept on drafts move into them.
CREATE TABLE "content_draft_tag" (
  "id" TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "socialSetId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "color" TEXT NOT NULL DEFAULT 'gray',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("organizationId", "socialSetId") REFERENCES "social_set" ("organizationId", "id")
);
CREATE INDEX "content_draft_tag_socialSetId_createdAt_idx" ON "content_draft_tag" ("socialSetId", "createdAt");
CREATE UNIQUE INDEX "content_draft_tag_socialSetId_name_key" ON "content_draft_tag" ("socialSetId", lower("name"));

CREATE TABLE "content_draft_finisher" (
  "id" TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "socialSetId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "quoteFirstPost" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("organizationId", "socialSetId") REFERENCES "social_set" ("organizationId", "id")
);
CREATE INDEX "content_draft_finisher_socialSetId_createdAt_idx" ON "content_draft_finisher" ("socialSetId", "createdAt");

ALTER TABLE "content_draft" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'standard'
  CHECK ("kind" IN ('standard', 'reply', 'quote', 'repurpose', 'article'));
ALTER TABLE "content_draft" ADD COLUMN "target" JSONB;
ALTER TABLE "content_draft" ADD COLUMN "platformVersions" JSONB NOT NULL DEFAULT '{"schemaVersion":1,"versions":[]}'::jsonb;
ALTER TABLE "content_draft" ADD COLUMN "article" JSONB;
ALTER TABLE "content_draft" ADD COLUMN "scratchpad" TEXT NOT NULL DEFAULT '';
ALTER TABLE "content_draft" ADD COLUMN "tagIds" JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE "content_draft" ADD COLUMN "pinnedAt" TIMESTAMP(3);
ALTER TABLE "content_draft" ADD COLUMN "planTimeZone" TEXT;
ALTER TABLE "content_draft" ADD COLUMN "sourceDraftId" TEXT REFERENCES "content_draft"("id") ON DELETE SET NULL;
CREATE INDEX "content_draft_organizationId_plannedFor_idx" ON "content_draft" ("organizationId", "plannedFor") WHERE "plannedFor" IS NOT NULL;

-- String tags become the set's tag records, matched by name without case,
-- then the drafts point at them in their original order. A tagged draft
-- without a set joins the default set, where the backend already reads it.
UPDATE "content_draft" d SET "socialSetId" = (
  SELECT s."id" FROM "social_set" s
  WHERE s."organizationId" = d."organizationId" AND s."deletedAt" IS NULL AND s."visibility" = 'WORKSPACE'
  ORDER BY s."createdAt", s."id" LIMIT 1)
WHERE d."socialSetId" IS NULL AND jsonb_array_length(d."tags") > 0;

INSERT INTO "content_draft_tag" ("id", "organizationId", "socialSetId", "name")
SELECT DISTINCT ON (d."socialSetId", lower(btrim(t.name)))
  'c' || substr(md5(d."socialSetId" || ':tag:' || lower(btrim(t.name))), 1, 24), d."organizationId", d."socialSetId", btrim(t.name)
FROM "content_draft" d
CROSS JOIN LATERAL jsonb_array_elements_text(d."tags") AS t(name)
WHERE d."socialSetId" IS NOT NULL AND btrim(t.name) <> ''
ORDER BY d."socialSetId", lower(btrim(t.name)), d."createdAt"
ON CONFLICT DO NOTHING;

UPDATE "content_draft" d SET "tagIds" = coalesce((
  SELECT jsonb_agg(picked."id" ORDER BY picked.position) FROM (
    SELECT tag."id", min(t.position) AS position
    FROM jsonb_array_elements_text(d."tags") WITH ORDINALITY AS t(name, position)
    JOIN "content_draft_tag" tag ON tag."socialSetId" = d."socialSetId" AND lower(tag."name") = lower(btrim(t.name))
    GROUP BY tag."id") picked
), '[]'::jsonb)
WHERE d."socialSetId" IS NOT NULL AND jsonb_array_length(d."tags") > 0;

ALTER TABLE "content_draft" DROP COLUMN "tags";

ALTER TABLE "content_draft_revision" ADD COLUMN "platformVersions" JSONB;
ALTER TABLE "content_draft_revision" ADD COLUMN "article" JSONB;
ALTER TABLE "content_draft_revision" ADD COLUMN "reason" TEXT NOT NULL DEFAULT 'edit';

-- A draft's activity timeline reads its audit history by entity.
CREATE INDEX "audit_log_organizationId_entityType_entityId_createdAt_idx" ON "audit_log" ("organizationId", "entityType", "entityId", "createdAt");
