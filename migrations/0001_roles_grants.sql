-- 0001 — the two-role split.
--
-- The roles themselves are created by scripts/setup-db.sh (CREATE ROLE needs a
-- superuser; scaffold_owner is not one). This migration asserts they exist and
-- fixes the schema-level privileges the spec's role table requires. Table-level
-- grants live in the migration that creates each table.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'scaffold_owner') THEN
    RAISE EXCEPTION 'role scaffold_owner is missing; run scripts/setup-db.sh';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_role') THEN
    RAISE EXCEPTION 'role app_role is missing; run scripts/setup-db.sh';
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO app_role;
REVOKE CREATE ON SCHEMA public FROM app_role;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO PUBLIC;

-- app_role never receives privileges implicitly: every table it can touch is
-- granted by name in the migration that creates it.
ALTER DEFAULT PRIVILEGES FOR ROLE scaffold_owner IN SCHEMA public
  REVOKE ALL ON TABLES FROM app_role;

-- The migration ledger is readable so tests can assert migrations applied.
GRANT SELECT ON schema_migration TO app_role;
