ALTER TABLE source_app ADD COLUMN "platformOwnerUserId" text;
ALTER TABLE product_surface ADD COLUMN "platformOwnerUserId" text;

-- Only recorded product actors establish ownership; never match identities by email.
UPDATE source_app s SET "platformOwnerUserId"=(
 SELECT a."actorUserId" FROM audit_log a JOIN member m ON m."userId"=a."actorUserId" AND m."organizationId"=a."organizationId"
 WHERE a."organizationId"=s."organizationId" AND a."entityId"=s.id AND a.action='product.source_app_created'
 ORDER BY a."createdAt",a.id LIMIT 1
);
UPDATE product_surface s SET "platformOwnerUserId"=(
 SELECT a."actorUserId" FROM audit_log a JOIN member m ON m."userId"=a."actorUserId" AND m."organizationId"=a."organizationId"
 WHERE a."organizationId"=s."organizationId" AND a."entityId"=s.id AND a.action='product.surface_created'
 ORDER BY a."createdAt",a.id LIMIT 1
);
