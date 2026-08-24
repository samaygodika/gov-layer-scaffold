-- 0002 — actor. Synced from the IdP (seeded in dev). App code has SELECT only.

CREATE TABLE actor (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_subject  text NOT NULL UNIQUE,
  email             text NOT NULL,
  groups            text[] NOT NULL DEFAULT '{}',
  active            boolean NOT NULL DEFAULT true
);

GRANT SELECT ON actor TO app_role;
