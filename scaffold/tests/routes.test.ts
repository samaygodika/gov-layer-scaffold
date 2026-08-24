/**
 * The route registry guardrail. Every server here is built with
 * NODE_ENV=development so the dev identity source exists and requests can carry
 * an actor; dev-identity.test.ts covers what happens when it does not.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assertAllRoutesAreRegistered } from "../src/checks.js";
import { createDemoServer } from "../src/demo-server.js";
import type { ScaffoldServer } from "../src/server.js";
import { unsafeRawServer } from "../src/unsafe-raw-server.js";

const nodeEnv = process.env.NODE_ENV;
const servers: ScaffoldServer[] = [];

const demoServer = (): ScaffoldServer => {
  const server = createDemoServer();
  servers.push(server);
  return server;
};

beforeEach(() => {
  process.env.NODE_ENV = "development";
});

afterEach(async () => {
  process.env.NODE_ENV = nodeEnv;
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("route()", () => {
  it("SC-10 all_routes_are_registered passes when every route went through route()", async () => {
    const server = demoServer();
    await server.ready();

    expect(server.registeredRoutes()).toEqual([
      { method: "GET", path: "/fixtures", action: "read", resourceType: "_scaffold_fixture" },
      { method: "POST", path: "/fixtures", action: "write", resourceType: "_scaffold_fixture" },
      {
        method: "POST",
        path: "/fixtures/:id/approvals",
        action: "approve",
        resourceType: "_scaffold_fixture",
      },
    ]);
    expect(server.frameworkRoutes()).toEqual([
      { method: "GET", path: "/fixtures" },
      { method: "POST", path: "/fixtures" },
      { method: "POST", path: "/fixtures/:id/approvals" },
    ]);
    expect(server.routesOutsideRegistry()).toEqual([]);
    expect(() => assertAllRoutesAreRegistered(server)).not.toThrow();
  });

  it("SC-10 all_routes_are_registered fails when a route is registered on the framework directly", async () => {
    const server = demoServer();
    // The only way to get here is to import the framework instance from a module
    // the scaffold does not export. That is the bypass this test exists to catch.
    unsafeRawServer(server).get("/bypass", async () => ({ authorized: "never asked" }));
    await server.ready();

    expect(server.routesOutsideRegistry()).toEqual([{ method: "GET", path: "/bypass" }]);
    expect(() => assertAllRoutesAreRegistered(server)).toThrowError(
      /routes registered outside route\(\): GET \/bypass/,
    );

    // And the bypass really did skip authorize(): no identity, no grant, 200.
    const response = await server.inject({ method: "GET", url: "/bypass" });
    expect(response.statusCode).toBe(200);
  });

  it("SC-9 route() denies by default: an agent may not approve", async () => {
    const server = demoServer();
    const response = await server.inject({
      method: "POST",
      url: "/fixtures/00000000-0000-4000-8000-0000000000ff/approvals",
      headers: { "x-dev-actor": "carol" },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({
      error:
        "actor carol may not approve _scaffold_fixture: no permission_grant for groups [agent]",
    });
  });

  it("SC-9 route() refuses a request with no identity before opening a transaction", async () => {
    const server = demoServer();
    const response = await server.inject({ method: "GET", url: "/fixtures" });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "no identity on the request" });
  });
});
