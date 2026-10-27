-- Additive: paid copy generation receipts and worker capability leases.
-- Rollback keeps these columns; older workers ignore them and never run v2 graphs.
ALTER TABLE release_automation_node ADD COLUMN generation JSONB;
ALTER TABLE release_automation_node ADD COLUMN charged BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE release_automation_executor ADD COLUMN capabilities JSONB NOT NULL DEFAULT '[]';
-- Run history filters by tenant and definition, newest first.
CREATE INDEX release_automation_run_definition ON release_automation_run("organizationId","definitionId",id);
