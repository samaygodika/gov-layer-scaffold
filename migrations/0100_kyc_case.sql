-- 0100 — kyc_case. The KYC review queue's only table.
--
-- Cases arrive from upstream (seeded in dev); there is no create screen, so the
-- application only ever reads them and follows an approval's decision into
-- `status`. The audit trigger and the app_role grants are attached here, in the
-- migration that creates the table, as every app table must.

CREATE TABLE kyc_case (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_name  text NOT NULL,
  submitted_at  timestamptz NOT NULL DEFAULT now(),
  risk_tier     text NOT NULL,
  documents     jsonb NOT NULL DEFAULT '[]'::jsonb,
  status        text NOT NULL DEFAULT 'pending',
  CONSTRAINT kyc_case_risk_tier_vocabulary
    CHECK (risk_tier IN ('low', 'medium', 'high')),
  CONSTRAINT kyc_case_status_vocabulary
    CHECK (status IN ('pending', 'approved', 'rejected'))
);

-- The list is newest first, filtered by status and risk_tier, paginated
-- server-side; this is the index that ordering and those filters read.
CREATE INDEX kyc_case_queue_idx ON kyc_case (submitted_at DESC, id DESC);
CREATE INDEX kyc_case_status_idx ON kyc_case (status, risk_tier);

CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON kyc_case
  FOR EACH ROW EXECUTE FUNCTION audit_row();

GRANT SELECT, INSERT, UPDATE, DELETE ON kyc_case TO app_role;
