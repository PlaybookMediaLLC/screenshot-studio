-- Bulk scheduling (RFC 042): a batch of separate posts that survives a refresh,
-- a closed tab or another device. Each item becomes its own content draft, so
-- review, the scheduled posts and their receipts stay where they are today.
-- Additive: no existing table or row changes, and rollback is DROP TABLE.
CREATE TABLE content_batch (
 id text PRIMARY KEY,
 "organizationId" text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
 "socialSetId" text NOT NULL REFERENCES social_set(id) ON DELETE CASCADE,
 "createdByUserId" text,
 title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
 "archivedAt" timestamptz,
 "createdAt" timestamptz NOT NULL DEFAULT now(),
 "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX content_batch_organization ON content_batch ("organizationId", "createdAt");

CREATE TABLE content_batch_item (
 id text PRIMARY KEY,
 "batchId" text NOT NULL REFERENCES content_batch(id) ON DELETE CASCADE,
 "organizationId" text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
 "importKey" text NOT NULL CHECK (length("importKey") BETWEEN 16 AND 128),
 position integer NOT NULL CHECK (position >= 0),
 caption text NOT NULL DEFAULT '',
 media jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(media) = 'array'),
 "channelConnectionIds" jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof("channelConnectionIds") = 'array'),
 timing jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(timing) = 'object'),
 -- A deleted draft leaves the item to be recreated, not a dangling id.
 "draftId" text REFERENCES content_draft(id) ON DELETE SET NULL,
 "createdAt" timestamptz NOT NULL DEFAULT now(),
 "updatedAt" timestamptz NOT NULL DEFAULT now(),
 UNIQUE ("batchId", "importKey"),
 UNIQUE ("draftId")
);
CREATE INDEX content_batch_item_order ON content_batch_item ("batchId", position);
