-- 0003 — permission_grant. Role-to-capability mapping; configuration, not data.

CREATE TABLE permission_grant (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role           text NOT NULL,
  resource_type  text NOT NULL,
  action         text NOT NULL,
  CONSTRAINT permission_grant_action_vocabulary
    CHECK (action IN ('read', 'write', 'approve')),
  CONSTRAINT permission_grant_unique UNIQUE (role, resource_type, action)
);

GRANT SELECT ON permission_grant TO app_role;
