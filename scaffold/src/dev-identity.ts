/**
 * Dev-mode identity (prototype only).
 *
 * `X-Dev-Actor: alice` or a `dev_actor` cookie selects one of the seeded
 * actors and produces the same Actor object OIDC middleware would. createServer
 * does not register any of this unless NODE_ENV=development — that, not a
 * runtime flag inside the hook, is what makes it impossible to enable in
 * production. `dev-identity.test.ts` asserts both halves.
 */
import type { FastifyRequest } from "fastify";
import { findActorBySubject, type Actor } from "./actor.js";
import { appPool } from "./with-actor.js";

export const DEV_ACTOR_HEADER = "x-dev-actor";
export const DEV_ACTOR_COOKIE = "dev_actor";

/**
 * NODE_ENV may come from the process environment or from a `.env` file, since
 * scaffold/src/env.ts loads dotenv at import time. An explicitly set NODE_ENV
 * always wins (dotenv does not override), so `NODE_ENV=production` is inert
 * whatever `.env` says — but an unset NODE_ENV plus a `.env` carrying
 * `NODE_ENV=development` does enable the switcher.
 */
export const isDevelopment = (): boolean => process.env.NODE_ENV === "development";

/** Minimal cookie parsing; the scaffold ships no cookie plugin. */
export function readCookie(cookieHeader: string | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    return decodeURIComponent(part.slice(separator + 1).trim());
  }
  return undefined;
}

const headerValue = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

/** The identity resolver registered only in development. */
export async function devActorFromRequest(request: FastifyRequest): Promise<Actor | null> {
  const subject =
    headerValue(request.headers[DEV_ACTOR_HEADER]) ??
    readCookie(headerValue(request.headers.cookie), DEV_ACTOR_COOKIE);
  if (!subject) return null;
  const actor = await findActorBySubject(appPool(), subject);
  return actor?.active ? actor : null;
}
