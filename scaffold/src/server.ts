/**
 * The scaffold server: route() and nothing else.
 *
 * createServer() owns a Fastify instance and never hands it out (see
 * internal/raw.ts). Every route is declared through route(), which
 *   1. records the declaration in this server's route registry,
 *   2. resolves the actor from the registered identity source,
 *   3. opens the transaction with withActor(), and
 *   4. calls authorize() before the handler — denying by default.
 *
 * Registering a route the registry does not know about therefore requires
 * importing the framework directly, and all_routes_are_registered fails on it.
 */
import fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
  type InjectOptions,
  type LightMyRequestResponse,
} from "fastify";
import type { Actor } from "./actor.js";
import { AuthorizationError, authorize, type Action } from "./authorize.js";
import { devActorFromRequest, isDevelopment } from "./dev-identity.js";
import { rememberRaw } from "./internal/raw.js";
import { withActor, type Tx } from "./with-actor.js";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type RouteDefinition = {
  method: HttpMethod;
  path: string;
  action: Action;
  resourceType: string;
};

export type RouteContext = {
  tx: Tx;
  actor: Actor;
  requestId: string;
  app: string;
  params: unknown;
  query: unknown;
  body: unknown;
  request: FastifyRequest;
  reply: FastifyReply;
};

export type RouteHandler = (context: RouteContext) => Promise<unknown>;

/** A route as the framework knows it, which is how the registry check compares them. */
export type RouteKey = { method: string; path: string };

/** Where the Actor comes from. "none" means every request is unauthenticated. */
export type IdentitySource = "x-dev-actor" | "custom" | "none";

export type ScaffoldServerOptions = {
  /** Written to audit_event.app via app.name. */
  app: string;
  /** Production identity (OIDC middleware). Ignored in development. */
  identity?: (request: FastifyRequest) => Promise<Actor | null>;
};

export type ScaffoldServer = {
  readonly app: string;
  route(definition: RouteDefinition, handler: RouteHandler): ScaffoldServer;
  /** Everything declared through route(), ordered by path then method. */
  registeredRoutes(): RouteDefinition[];
  /** Everything the framework will serve, however it was registered. */
  frameworkRoutes(): RouteKey[];
  /** Framework routes the registry does not know about: routes that skipped authorize(). */
  routesOutsideRegistry(): RouteKey[];
  identitySource(): IdentitySource;
  /** Names of the hooks this server registered; the dev identity hook is one. */
  hooks(): string[];
  ready(): Promise<void>;
  inject(options: InjectOptions | string): Promise<LightMyRequestResponse>;
  listen(options: { port: number; host?: string }): Promise<string>;
  close(): Promise<void>;
};

const keyOf = (route: RouteKey): string => `${route.method} ${route.path}`;

const byMethodAndPath = (a: RouteKey, b: RouteKey): number =>
  a.path === b.path ? a.method.localeCompare(b.method) : a.path.localeCompare(b.path);

const requestId = (request: FastifyRequest): string => {
  const header = request.headers["x-request-id"];
  return (Array.isArray(header) ? header[0] : header) ?? request.id;
};

export function createServer(options: ScaffoldServerOptions): ScaffoldServer {
  // exposeHeadRoutes: false so the framework's route table contains exactly the
  // routes something registered, which is what the registry is compared against.
  const instance: FastifyInstance = fastify({ logger: false, exposeHeadRoutes: false });

  const registry: RouteDefinition[] = [];
  const frameworkRoutes: RouteKey[] = [];
  const hooks: string[] = [];

  instance.addHook("onRoute", (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    for (const method of methods) frameworkRoutes.push({ method, path: route.url });
  });

  instance.decorateRequest("scaffoldActor", null);

  const development = isDevelopment();
  if (development) {
    // Registered only here, only in development. Nothing re-checks NODE_ENV at
    // request time, because in production this hook does not exist.
    hooks.push("dev-identity");
    instance.addHook("onRequest", async (request) => {
      (request as FastifyRequest & { scaffoldActor: Actor | null }).scaffoldActor =
        await devActorFromRequest(request);
    });
  }

  const identitySource: IdentitySource = development
    ? "x-dev-actor"
    : options.identity
      ? "custom"
      : "none";

  const resolveActor = async (request: FastifyRequest): Promise<Actor | null> => {
    const fromHook = (request as FastifyRequest & { scaffoldActor?: Actor | null }).scaffoldActor;
    if (fromHook) return fromHook;
    return development ? null : ((await options.identity?.(request)) ?? null);
  };

  instance.setErrorHandler((error: Error & { statusCode?: number }, _request, reply) => {
    const status = error instanceof AuthorizationError ? 403 : (error.statusCode ?? 500);
    reply.code(status).send({ error: error.message });
  });

  const server: ScaffoldServer = {
    app: options.app,

    route(definition, handler) {
      registry.push(definition);
      instance.route({
        method: definition.method,
        url: definition.path,
        handler: async (request, reply) => {
          const actor = await resolveActor(request);
          if (!actor) {
            reply.code(401);
            return { error: "no identity on the request" };
          }
          return withActor(actor, requestId(request), options.app, async (tx) => {
            await authorize(tx, actor, definition.action, definition.resourceType);
            return handler({
              tx,
              actor,
              requestId: requestId(request),
              app: options.app,
              params: request.params,
              query: request.query,
              body: request.body,
              request,
              reply,
            });
          });
        },
      });
      return server;
    },

    registeredRoutes: () =>
      [...registry].sort((a, b) => byMethodAndPath(a, b)),

    frameworkRoutes: () => [...frameworkRoutes].sort(byMethodAndPath),

    routesOutsideRegistry() {
      const registered = new Set(registry.map(keyOf));
      return frameworkRoutes.filter((route) => !registered.has(keyOf(route))).sort(byMethodAndPath);
    },

    identitySource: () => identitySource,
    hooks: () => [...hooks],
    ready: async () => {
      await instance.ready();
    },
    inject: (injectOptions) => instance.inject(injectOptions),
    listen: (listenOptions) =>
      instance.listen({ port: listenOptions.port, host: listenOptions.host ?? "127.0.0.1" }),
    close: () => instance.close(),
  };

  rememberRaw(server, instance);
  return server;
}
