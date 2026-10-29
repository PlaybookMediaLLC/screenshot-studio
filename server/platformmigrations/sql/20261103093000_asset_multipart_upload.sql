-- A large upload goes to storage in parts (docs/tenant-storage.md): the
-- multipart upload a PENDING asset is waiting on, cleared when the server
-- completes it, and aborted when the reservation is cleaned up.
ALTER TABLE "asset" ADD COLUMN "uploadId" text;
