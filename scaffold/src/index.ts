/**
 * The scaffold's public surface. Four things: identity, the transaction helper,
 * the authorization choke point, and route().
 *
 * Deliberately absent: the framework instance (see unsafe-raw-server.ts) and any
 * UI component — the scaffold ships no UI (SC-12).
 */
export type { Actor } from "./actor.js";
export { findActorBySubject } from "./actor.js";

export { appPool, closeAppPool, withActor, type Tx } from "./with-actor.js";

export {
  AuthorizationError,
  authorize,
  isAuthorized,
  type Action,
} from "./authorize.js";

export {
  createServer,
  type HttpMethod,
  type IdentitySource,
  type RouteContext,
  type RouteDefinition,
  type RouteHandler,
  type RouteKey,
  type ScaffoldServer,
  type ScaffoldServerOptions,
} from "./server.js";

export { DEV_ACTOR_COOKIE, DEV_ACTOR_HEADER, isDevelopment } from "./dev-identity.js";

export {
  appTableAudits,
  assertAllAppTablesAreAudited,
  assertAllRoutesAreRegistered,
  assertNoRoutesOutsideRegistry,
  unauditedTables,
  NON_APP_TABLES,
  type TableAudit,
} from "./checks.js";

export {
  buildGovernanceReport,
  serializeGovernanceReport,
  type GovernanceReport,
} from "./governance.js";
