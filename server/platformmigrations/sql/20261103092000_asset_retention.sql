-- One answer to "does anything still need this asset?", shared by deletion and
-- maintenance. An unarchived draft that shows it, a post that has not finished
-- with it, or a batch item that stages it keeps the bytes. With history, a
-- published post keeps them too (maintenance removes only what nothing used).
CREATE FUNCTION platform_asset_in_use_v1(org text, asset text, history boolean) RETURNS boolean
LANGUAGE sql STABLE AS $$
 SELECT EXISTS (
   SELECT 1 FROM content_draft d WHERE d."organizationId" = org AND d.status <> 'archived'
     AND (d."assetIds" ? asset OR jsonb_path_exists(jsonb_build_array(d.body, d."platformVersions"),
       '$.** ? (@.assetId == $id)', jsonb_build_object('id', asset))))
 OR EXISTS (
   SELECT 1 FROM scheduled_post p WHERE p."organizationId" = org
     AND (p.status IN ('DRAFT', 'SCHEDULED', 'PROCESSING', 'UNKNOWN_DELIVERY') OR history AND p.status = 'PUBLISHED')
     AND (p."assetId" = asset OR coalesce(p."assetIds", '[]') ? asset
       OR p."publishOptions"->>'documentAssetId' = asset OR p."publishOptions"->>'articleCoverAssetId' = asset
       OR jsonb_path_exists(coalesce(p.replies, '[]'), '$[*].assetIds[*] ? (@ == $id)', jsonb_build_object('id', asset))))
 OR EXISTS (
   SELECT 1 FROM content_batch_item i JOIN content_batch b ON b.id = i."batchId"
   WHERE i."organizationId" = org AND b."archivedAt" IS NULL
     AND jsonb_path_exists(i.media, '$[*] ? (@.assetId == $id || @.uploadAssetId == $id)', jsonb_build_object('id', asset)))
$$;
