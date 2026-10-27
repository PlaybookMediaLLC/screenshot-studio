-- The organization ID is deliberately not a cascading FK: completed creation
-- receipts remain tombstones after workspace purge. Account deletion removes
-- the actor's receipts, since that actor can no longer retry authenticated work.
CREATE TABLE platform_workspace_creation (
  id text PRIMARY KEY,
  "organizationId" text NOT NULL,
  "userId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  "requestKey" varchar(128) NOT NULL,
  "requestHash" varchar(64) NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX platformworkspacecreation_user_id_request_key
  ON platform_workspace_creation ("userId", "requestKey");
CREATE UNIQUE INDEX platformworkspacecreation_organization_id
  ON platform_workspace_creation ("organizationId");
