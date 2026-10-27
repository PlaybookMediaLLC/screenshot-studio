-- Provider-verified facts are separate from editable additionalSettings.
-- Existing accounts remain unknown; never invent grants from a stored token.
ALTER TABLE "Integration"
 ADD COLUMN "verifiedAccountKey" text,
 ADD COLUMN "verifiedAccountKind" text,
 ADD COLUMN "verifiedScopes" jsonb,
 ADD COLUMN "verifiedCapabilities" jsonb,
 ADD COLUMN "identityVerifiedAt" timestamp(3);
ALTER TABLE "Integration" ADD CONSTRAINT integration_verified_identity_complete CHECK (
 ("verifiedAccountKey" IS NULL AND "verifiedAccountKind" IS NULL AND "verifiedScopes" IS NULL AND "verifiedCapabilities" IS NULL AND "identityVerifiedAt" IS NULL)
 OR
 ("verifiedAccountKey" IS NOT NULL AND length("verifiedAccountKey") BETWEEN 1 AND 350
  AND "verifiedAccountKind" IN ('profile','page') AND "verifiedAccountKind" IS NOT NULL
  AND "verifiedScopes" IS NOT NULL AND jsonb_typeof("verifiedScopes")='array'
  AND jsonb_array_length("verifiedScopes") BETWEEN 1 AND 64
  AND "verifiedCapabilities" IS NOT NULL AND jsonb_typeof("verifiedCapabilities")='object'
  AND "verifiedCapabilities"->'version' IS NOT NULL AND "verifiedCapabilities"->'version'='1'::jsonb
  AND "identityVerifiedAt" IS NOT NULL)
);
CREATE INDEX integration_verified_account_key ON "Integration" ("organizationId","verifiedAccountKey") WHERE "verifiedAccountKey" IS NOT NULL;
