CREATE TABLE platform_slack_pacing (
 id text PRIMARY KEY, installation_id text NOT NULL REFERENCES platform_slack_installation(id) ON DELETE CASCADE,
 channel_id text NOT NULL, next_at timestamptz NOT NULL
);
