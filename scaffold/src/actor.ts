/**
 * The actor object. In production OIDC middleware produces it from claims; in
 * development the dev switcher produces the same shape from the seeded actors.
 * Nothing downstream of this type knows which one it was.
 */
import type { Queryable } from "./db.js";

export type Actor = {
  id: string;
  externalSubject: string;
  email: string;
  groups: string[];
  active: boolean;
};

type ActorRow = {
  id: string;
  external_subject: string;
  email: string;
  groups: string[];
  active: boolean;
};

const toActor = (row: ActorRow): Actor => ({
  id: row.id,
  externalSubject: row.external_subject,
  email: row.email,
  groups: row.groups,
  active: row.active,
});

/** Looks an actor up by its OIDC subject. app_role has SELECT on actor. */
export async function findActorBySubject(
  client: Queryable,
  externalSubject: string,
): Promise<Actor | null> {
  const found = await client.query<ActorRow>(
    `SELECT id, external_subject, email, groups, active
       FROM actor WHERE external_subject = $1`,
    [externalSubject],
  );
  const row = found.rows[0];
  return row ? toActor(row) : null;
}
