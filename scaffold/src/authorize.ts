/**
 * The single authorization choke point. Called by route() before every handler.
 *
 * Honest about its strength: this is application-layer enforcement (see
 * scaffold-spec.md mechanism 2). What makes it hard to skip is that route() is
 * the only way to register a route and the scaffold never exports the framework
 * router, plus the all_routes_are_registered test.
 */
import type { Actor } from "./actor.js";
import type { Queryable } from "./db.js";

export type Action = "read" | "write" | "approve";

export class AuthorizationError extends Error {
  readonly statusCode = 403;

  constructor(actor: Actor, action: Action, resourceType: string) {
    super(
      `actor ${actor.externalSubject} may not ${action} ${resourceType}: ` +
        `no permission_grant for groups [${actor.groups.join(", ")}]`,
    );
    this.name = "AuthorizationError";
  }
}

/**
 * True only when some group of the actor holds a matching permission_grant.
 * Deny by default: an inactive actor, an actor with no groups, and any
 * action/resource pair with no grant row all return false.
 */
export async function isAuthorized(
  client: Queryable,
  actor: Actor,
  action: Action,
  resourceType: string,
): Promise<boolean> {
  if (!actor.active || actor.groups.length === 0) return false;
  const granted = await client.query(
    `SELECT 1 FROM permission_grant
      WHERE role = ANY($1::text[]) AND resource_type = $2 AND action = $3
      LIMIT 1`,
    [actor.groups, resourceType, action],
  );
  return granted.rowCount === 1;
}

/** Throws AuthorizationError unless isAuthorized(). */
export async function authorize(
  client: Queryable,
  actor: Actor,
  action: Action,
  resourceType: string,
): Promise<void> {
  if (!(await isAuthorized(client, actor, action, resourceType))) {
    throw new AuthorizationError(actor, action, resourceType);
  }
}
