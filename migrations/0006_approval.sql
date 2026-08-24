-- 0006 — approval. Separation of duties, in the schema.

CREATE TABLE approval (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_type  text NOT NULL,
  resource_id    text NOT NULL,
  requested_by   uuid NOT NULL REFERENCES actor (id),
  decided_by     uuid REFERENCES actor (id),
  decision       text,
  decided_at     timestamptz,
  rationale      text,
  CONSTRAINT approval_decision_vocabulary
    CHECK (decision IS NULL OR decision IN ('approved', 'rejected')),
  CONSTRAINT approval_maker_checker
    CHECK (decided_by IS NULL OR decided_by <> requested_by),
  CONSTRAINT approval_decision_has_decider
    CHECK ((decision IS NULL) = (decided_by IS NULL)),
  CONSTRAINT approval_decision_has_rationale
    CHECK ((decision IS NULL) = (rationale IS NULL))
);

CREATE INDEX approval_resource_idx ON approval (resource_type, resource_id);

CREATE TRIGGER approval_actor_matches BEFORE INSERT OR UPDATE ON approval
  FOR EACH ROW EXECUTE FUNCTION approval_actor_matches();

CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON approval
  FOR EACH ROW EXECUTE FUNCTION audit_row();

GRANT SELECT, INSERT, UPDATE ON approval TO app_role;
