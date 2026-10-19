#!/bin/sh
set -eu
# Only runs on a NEW PostgreSQL volume. Role passwords come from mounted files.
app_password=$(cat /run/secrets/app_db_password)
migration_password=$(cat /run/secrets/migration_db_password)
# psql variables provide SQL literal quoting, even if a generated password has punctuation.
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set=app_password="$app_password" --set=migration_password="$migration_password" <<'SQL'
CREATE ROLE bomish_app LOGIN PASSWORD :'app_password';
CREATE ROLE bomish_migrator LOGIN PASSWORD :'migration_password';
REVOKE ALL ON DATABASE bomish FROM PUBLIC;
GRANT CONNECT ON DATABASE bomish TO bomish_app, bomish_migrator;
ALTER SCHEMA public OWNER TO bomish_migrator;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO bomish_app;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;
ALTER DEFAULT PRIVILEGES FOR ROLE bomish_migrator IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO bomish_app;
ALTER DEFAULT PRIVILEGES FOR ROLE bomish_migrator IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO bomish_app;
SQL
