#!/usr/bin/env sh

set -eu

psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<SQL
CREATE ROLE screenshot_studio LOGIN PASSWORD '${POSTGRES_APP_PASSWORD}';
CREATE DATABASE screenshot_studio OWNER screenshot_studio;
SQL
