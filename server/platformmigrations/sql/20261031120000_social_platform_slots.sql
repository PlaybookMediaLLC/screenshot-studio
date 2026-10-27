-- Adapter keys remain on connections/receipts. Slot and editor keys are canonical.
-- This immutable v1 function is also used by connection-health comparisons.
-- Changing its mapping later requires a new function/index version or a reindex.
CREATE FUNCTION platform_social_channel_v1(value text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
  SELECT CASE value
    WHEN 'twitter' THEN 'x'
    WHEN 'instagram-standalone' THEN 'instagram'
    WHEN 'linkedin-page' THEN 'linkedin'
    WHEN 'mastodon-custom' THEN 'mastodon'
    WHEN 'mastodoncustom' THEN 'mastodon'
    ELSE value END
$$;

-- Never pick an account to discard during an upgrade. The operator must resolve
-- preexisting ambiguous active slots through the account-removal flow first.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM channel_connection
    WHERE "socialSetId" IS NOT NULL AND status='ACTIVE'
    GROUP BY "socialSetId", platform_social_channel_v1(platform) HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Multiple active accounts occupy one social-set platform. Remove the extra account from its set before retrying this migration; publication history is preserved.';
  END IF;
END $$;

CREATE UNIQUE INDEX channel_connection_social_set_platform_family_key
ON channel_connection ("socialSetId", platform_social_channel_v1(platform))
WHERE "socialSetId" IS NOT NULL AND status='ACTIVE';

-- Normalize only future-draft defaults, preserving order and existing drafts.
WITH normalized AS (
  SELECT s.id, platform_social_channel_v1(s."primaryPlatform") AS primary_platform,
    COALESCE((
      SELECT jsonb_agg(item.platform ORDER BY item.position)
      FROM (
        SELECT platform_social_channel_v1(value) AS platform, min(position) AS position
        FROM jsonb_array_elements_text(s."defaultPlatforms") WITH ORDINALITY AS defaults(value, position)
        GROUP BY platform_social_channel_v1(value)
      ) item
    ), '[]'::jsonb) AS platforms
  FROM social_set s
)
UPDATE social_set s SET "defaultPlatforms"=n.platforms, "primaryPlatform"=n.primary_platform,
  version=s.version+1, "updatedAt"=CURRENT_TIMESTAMP
FROM normalized n
WHERE s.id=n.id AND (s."defaultPlatforms" IS DISTINCT FROM n.platforms OR s."primaryPlatform" IS DISTINCT FROM n.primary_platform);
