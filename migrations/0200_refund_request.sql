-- 0200 — refunds dashboard request table and threshold enforcement.

CREATE TABLE refund_request (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_ref text NOT NULL,
  amount_cents   integer NOT NULL CHECK (amount_cents > 0),
  currency       text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  reason         text NOT NULL,
  requested_at   timestamptz NOT NULL DEFAULT now(),
  status         text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected'))
);

CREATE INDEX refund_request_requested_at_idx
  ON refund_request (requested_at DESC, id DESC);
CREATE INDEX refund_request_status_idx ON refund_request (status);
CREATE INDEX refund_request_currency_idx ON refund_request (currency);

CREATE FUNCTION refund_request_requires_approval() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status = 'approved'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status)
     AND NEW.amount_cents >= 10000
     AND NOT EXISTS (
       SELECT 1 FROM approval
        WHERE resource_type = 'refund_request'
          AND resource_id = NEW.id::text
          AND decision = 'approved'
     ) THEN
    RAISE EXCEPTION
      'refund_request approval required: refunds of 10000 cents or more need an approved approval before status can become approved'
      USING ERRCODE = 'raise_exception';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION refund_request_requires_approval() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refund_request_requires_approval() TO app_role;

CREATE TRIGGER refund_request_threshold
  BEFORE INSERT OR UPDATE ON refund_request
  FOR EACH ROW EXECUTE FUNCTION refund_request_requires_approval();

CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON refund_request
  FOR EACH ROW EXECUTE FUNCTION audit_row();

GRANT SELECT, INSERT, UPDATE, DELETE ON refund_request TO app_role;
