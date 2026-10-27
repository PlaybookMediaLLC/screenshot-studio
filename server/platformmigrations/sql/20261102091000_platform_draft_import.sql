CREATE TABLE IF NOT EXISTS platform_draft_import (
 id text PRIMARY KEY,
 "organizationId" text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
 "draftId" text NOT NULL,
 fingerprint text NOT NULL,
 "createdAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS platform_draft_import_org ON platform_draft_import ("organizationId");
