ALTER TABLE analytics_post ADD COLUMN "discoveredAt" timestamptz NOT NULL DEFAULT now();
CREATE INDEX analytics_post_snapshot ON analytics_post ("connectionId", "discoveredAt");
