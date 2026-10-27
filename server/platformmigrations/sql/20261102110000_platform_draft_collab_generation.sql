ALTER TABLE content_draft ADD COLUMN "collabGeneration" integer NOT NULL DEFAULT 0 CHECK ("collabGeneration" >= 0);
