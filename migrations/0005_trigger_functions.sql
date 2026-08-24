-- 0005 — the two trigger functions. Both SECURITY DEFINER and owned by
-- scaffold_owner (the role running migrations), so they can write audit_event
-- even though the calling role, app_role, cannot.

CREATE FUNCTION audit_row() RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor_id    text := current_setting('app.actor_id', true);
  v_request_id  text := current_setting('app.request_id', true);
  v_app         text := current_setting('app.name', true);
  v_resource_id text;
BEGIN
  IF v_actor_id IS NULL OR v_actor_id = '' THEN
    RAISE EXCEPTION
      'audit_row: app.actor_id is not set; mutations must run inside withActor()'
      USING ERRCODE = 'raise_exception';
  END IF;

  IF TG_OP = 'DELETE' THEN
    v_resource_id := to_jsonb(OLD) ->> 'id';
  ELSE
    v_resource_id := to_jsonb(NEW) ->> 'id';
  END IF;

  INSERT INTO audit_event (
    actor_id, app, action, resource_type, resource_id, before, after, request_id
  ) VALUES (
    v_actor_id::uuid,
    nullif(v_app, ''),
    lower(TG_OP),
    TG_TABLE_NAME,
    v_resource_id,
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END,
    CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END,
    nullif(v_request_id, '')
  );

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION audit_row() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audit_row() TO app_role;

-- The identity in an approval row is the identity of the transaction that
-- wrote it, whatever the application passed in.
CREATE FUNCTION approval_actor_matches() RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor_id text := current_setting('app.actor_id', true);
BEGIN
  IF v_actor_id IS NULL OR v_actor_id = '' THEN
    RAISE EXCEPTION
      'approval_actor_matches: app.actor_id is not set; mutations must run inside withActor()'
      USING ERRCODE = 'raise_exception';
  END IF;

  IF TG_OP = 'INSERT' AND NEW.requested_by IS DISTINCT FROM v_actor_id::uuid THEN
    RAISE EXCEPTION
      'approval.requested_by (%) must equal app.actor_id (%)', NEW.requested_by, v_actor_id
      USING ERRCODE = 'raise_exception';
  END IF;

  -- Otherwise a single actor could request as themselves, rewrite requested_by
  -- to someone else, and then decide: maker-checker compares the two columns,
  -- not who wrote them.
  IF TG_OP = 'UPDATE' AND NEW.requested_by IS DISTINCT FROM OLD.requested_by THEN
    RAISE EXCEPTION 'approval.requested_by is immutable once the row exists'
      USING ERRCODE = 'raise_exception';
  END IF;

  IF NEW.decided_by IS NOT NULL AND NEW.decided_by IS DISTINCT FROM v_actor_id::uuid THEN
    RAISE EXCEPTION
      'approval.decided_by (%) must equal app.actor_id (%)', NEW.decided_by, v_actor_id
      USING ERRCODE = 'raise_exception';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION approval_actor_matches() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION approval_actor_matches() TO app_role;
