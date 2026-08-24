-- 0004 — audit_event. Append-only; written only by the audit_row() trigger.
-- app_role gets SELECT and nothing else: that gap is what makes hand-written
-- audit rows impossible.

CREATE TABLE audit_event (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at    timestamptz NOT NULL DEFAULT now(),
  actor_id       uuid NOT NULL REFERENCES actor (id),
  app            text,
  action         text NOT NULL,
  resource_type  text NOT NULL,
  resource_id    text,
  before         jsonb,
  after          jsonb,
  request_id     text,
  CONSTRAINT audit_event_action_vocabulary
    CHECK (action IN ('insert', 'update', 'delete'))
);

CREATE INDEX audit_event_resource_idx
  ON audit_event (resource_type, resource_id, occurred_at);

GRANT SELECT ON audit_event TO app_role;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON audit_event FROM app_role;
