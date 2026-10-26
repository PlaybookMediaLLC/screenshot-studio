-- Prepared Auto-DM infrastructure. No migration activates a campaign or sends messages.
CREATE TABLE platform_auto_dm_campaign (
 id text PRIMARY KEY,
 "organizationId" text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
 account_id text NOT NULL,
 post_id text NOT NULL,
 snapshot jsonb NOT NULL,
 published_at timestamptz NOT NULL,
 disabled boolean NOT NULL DEFAULT false,
 source_removed boolean NOT NULL DEFAULT false,
 UNIQUE (id,"organizationId",account_id),
 UNIQUE ("organizationId",account_id,post_id)
);
CREATE INDEX platform_auto_dm_campaign_account ON platform_auto_dm_campaign(account_id,published_at);
CREATE TABLE platform_auto_dm_recipient (
 id text PRIMARY KEY,
 "organizationId" text NOT NULL,
 account_id text NOT NULL,
 campaign_id text NOT NULL,
 recipient_id text NOT NULL,
 snapshot jsonb NOT NULL,
 observed_at timestamptz NOT NULL,
 FOREIGN KEY (campaign_id,"organizationId",account_id) REFERENCES platform_auto_dm_campaign(id,"organizationId",account_id) ON DELETE CASCADE,
 UNIQUE (campaign_id,recipient_id)
);
-- STOP is account-wide, including campaigns held by other workspaces.
CREATE TABLE platform_auto_dm_opt_out (
 id text PRIMARY KEY,
 account_id text NOT NULL,
 recipient_id text NOT NULL,
 evidence_id text NOT NULL,
 observed_at timestamptz NOT NULL,
 UNIQUE (account_id,recipient_id)
);
CREATE TABLE platform_auto_dm_delivery (
 id text PRIMARY KEY,
 "organizationId" text NOT NULL,
 account_id text NOT NULL,
 campaign_id text NOT NULL,
 recipient_id text NOT NULL,
 status text NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved','sent','unknown')),
 remote_id text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL,
 FOREIGN KEY (campaign_id,"organizationId",account_id) REFERENCES platform_auto_dm_campaign(id,"organizationId",account_id) ON DELETE CASCADE,
 UNIQUE (campaign_id,recipient_id),
 CHECK ((status='sent' AND remote_id<>'') OR (status<>'sent' AND remote_id=''))
);
CREATE INDEX platform_auto_dm_delivery_account_window ON platform_auto_dm_delivery(account_id,created_at);
