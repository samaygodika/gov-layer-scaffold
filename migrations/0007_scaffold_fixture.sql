-- 0007 — _scaffold_fixture. A table that exists only so the scaffold tests have
-- something audited to mutate. No application reads or writes it; the leading
-- underscore marks it as not an app table.

CREATE TABLE _scaffold_fixture (
  id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  note  text
);

CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON _scaffold_fixture
  FOR EACH ROW EXECUTE FUNCTION audit_row();

GRANT SELECT, INSERT, UPDATE, DELETE ON _scaffold_fixture TO app_role;
