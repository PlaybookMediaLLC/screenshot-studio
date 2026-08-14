#!/usr/bin/env sh

set -eu

psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<SQL
CREATE ROLE screenshot_studio LOGIN PASSWORD '${POSTGRES_APP_PASSWORD}';
CREATE ROLE storage_service LOGIN PASSWORD '${POSTGRES_STORAGE_PASSWORD}';
CREATE DATABASE screenshot_studio OWNER screenshot_studio;
CREATE DATABASE storage OWNER postgres;
GRANT ALL PRIVILEGES ON DATABASE storage TO storage_service;
\connect screenshot_studio
CREATE TABLE screenshot_cache (
  id TEXT PRIMARY KEY,
  "urlHash" TEXT UNIQUE NOT NULL,
  url TEXT NOT NULL,
  "cloudinaryPublicId" TEXT UNIQUE NOT NULL,
  "cloudinaryUrl" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE screenshot_cache OWNER TO screenshot_studio;
SQL
