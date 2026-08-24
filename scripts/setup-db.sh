#!/usr/bin/env bash
# Creates the two roles and the database. Idempotent. Run once on a fresh
# Postgres (Devin machine setup, local dev, CI). Requires a superuser
# connection; defaults to the local `postgres` user.
set -euo pipefail
PSQL="${PSQL:-psql -v ON_ERROR_STOP=1 -U postgres -h localhost}"

$PSQL -d postgres <<'SQL'
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='scaffold_owner') THEN
    CREATE ROLE scaffold_owner LOGIN PASSWORD 'scaffold_owner';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='app_role') THEN
    CREATE ROLE app_role LOGIN PASSWORD 'app_role' NOCREATEDB NOCREATEROLE NOSUPERUSER;
  END IF;
END $$;
SQL

$PSQL -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='tools'" | grep -q 1 \
  || $PSQL -d postgres -c "CREATE DATABASE tools OWNER scaffold_owner"

# app_role may connect and see the schema; table-level grants are done in migrations.
$PSQL -d tools <<'SQL'
GRANT CONNECT ON DATABASE tools TO app_role;
GRANT USAGE ON SCHEMA public TO app_role;
REVOKE CREATE ON SCHEMA public FROM app_role;
SQL

echo "ok: roles scaffold_owner, app_role; database tools"
