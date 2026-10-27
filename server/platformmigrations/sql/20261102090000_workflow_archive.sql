-- Retain definitions, immutable versions, and run history when archiving.
ALTER TABLE release_automation ADD COLUMN archived BOOLEAN NOT NULL DEFAULT false;
