ALTER TABLE content_draft ADD COLUMN "calendarVersion" integer NOT NULL DEFAULT 1 CHECK ("calendarVersion" > 0);

CREATE TABLE analytics_account (
 id text PRIMARY KEY REFERENCES channel_connection(id) ON DELETE CASCADE,
 "organizationId" text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
 version integer NOT NULL DEFAULT 1,
 availability text NOT NULL DEFAULT 'insufficient' CHECK (availability IN ('insufficient','available','failed','forbidden','unsupported')),
 "checkedAt" timestamptz, "nextCheckAt" timestamptz NOT NULL DEFAULT now(), "leaseUntil" timestamptz,
 "publicToken" text UNIQUE, goal jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX analytics_account_workspace ON analytics_account ("organizationId");
CREATE INDEX analytics_account_due ON analytics_account ("nextCheckAt");
CREATE TABLE analytics_post (
 id text PRIMARY KEY,
 "organizationId" text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
 "connectionId" text NOT NULL REFERENCES channel_connection(id) ON DELETE CASCADE,
 "remoteId" text NOT NULL,
 "scheduledPostId" text REFERENCES scheduled_post(id) ON DELETE SET NULL,
 "threadRootId" text, "threadPosition" integer NOT NULL DEFAULT 0,
 "isReply" boolean NOT NULL DEFAULT false, excerpt text NOT NULL DEFAULT '', url text NOT NULL DEFAULT '',
 "publishedAt" timestamptz NOT NULL, "checkedAt" timestamptz,
 "nextCheckAt" timestamptz NOT NULL DEFAULT now(),
 availability text NOT NULL DEFAULT 'insufficient' CHECK (availability IN ('insufficient','available','failed','forbidden','unsupported','deleted')),
 UNIQUE ("connectionId", "remoteId")
);
CREATE INDEX analytics_post_workspace ON analytics_post ("organizationId","connectionId","publishedAt",id);
CREATE INDEX analytics_post_due ON analytics_post (availability,"nextCheckAt");
CREATE TABLE analytics_snapshot (
 id text PRIMARY KEY,
 "organizationId" text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
 "connectionId" text NOT NULL REFERENCES channel_connection(id) ON DELETE CASCADE,
 "subjectId" text NOT NULL,
 kind text NOT NULL CHECK (kind IN ('account','post')),
 "observedAt" timestamptz NOT NULL, "collectedAt" timestamptz NOT NULL DEFAULT now(),
 counters jsonb NOT NULL, "payloadHash" text NOT NULL, "ageMinutes" integer NOT NULL DEFAULT 0,
 UNIQUE ("connectionId",kind,"subjectId","observedAt","payloadHash")
);
CREATE INDEX analytics_snapshot_scope ON analytics_snapshot ("organizationId","connectionId",kind,"observedAt");
CREATE TABLE calendar_mutation (
 id text PRIMARY KEY,
 "organizationId" text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
 "actorId" text NOT NULL, "inputHash" text NOT NULL, result jsonb NOT NULL,
 "createdAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX calendar_mutation_scope ON calendar_mutation ("organizationId","createdAt");
