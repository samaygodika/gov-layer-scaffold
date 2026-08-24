/**
 * Where the Fastify instance behind a ScaffoldServer is kept.
 *
 * It lives in a WeakMap rather than on the ScaffoldServer object so that the
 * scaffold's public surface (`index.ts`) exposes no way to register a route
 * without route(). The only reader is `unsafe-raw-server.ts`, which exists so
 * the tamper tests can prove the guard catches a bypass.
 */
import type { FastifyInstance } from "fastify";

const instances = new WeakMap<object, FastifyInstance>();

export const rememberRaw = (server: object, instance: FastifyInstance): void => {
  instances.set(server, instance);
};

export const lookupRaw = (server: object): FastifyInstance | undefined => instances.get(server);
