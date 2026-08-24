/**
 * Deliberately not exported from `index.ts`.
 *
 * Reaching the framework instance is what "registering a route that skips
 * authorization" means in this scaffold. That path has to exist for the
 * all_routes_are_registered test to be able to prove it is caught, so it lives
 * here, under a name no app code has a reason to import.
 */
import type { FastifyInstance } from "fastify";
import { lookupRaw } from "./internal/raw.js";
import type { ScaffoldServer } from "./server.js";

export function unsafeRawServer(server: ScaffoldServer): FastifyInstance {
  const instance = lookupRaw(server);
  if (!instance) throw new Error("not a scaffold server");
  return instance;
}
