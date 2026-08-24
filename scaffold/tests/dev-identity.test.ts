/**
 * SC-11: the dev switcher works in development, and in production the middleware
 * is not registered at all — asserted both by what the server reports about its
 * own hooks and by what a request carrying X-Dev-Actor actually gets.
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDemoServer } from "../src/demo-server.js";
import { DEV_ACTOR_COOKIE, DEV_ACTOR_HEADER } from "../src/dev-identity.js";
import type { ScaffoldServer } from "../src/server.js";
import { withActor } from "../src/with-actor.js";
import { actor, connect } from "./helpers.js";

const nodeEnv = process.env.NODE_ENV;
const servers: ScaffoldServer[] = [];

function serverWith(env: string): ScaffoldServer {
  process.env.NODE_ENV = env;
  const server = createDemoServer();
  servers.push(server);
  return server;
}

afterEach(async () => {
  process.env.NODE_ENV = nodeEnv;
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("dev-mode identity", () => {
  it("SC-11 in development the X-Dev-Actor header selects the actor", async () => {
    const server = serverWith("development");
    expect(server.identitySource()).toBe("x-dev-actor");
    expect(server.hooks()).toContain("dev-identity");

    const response = await server.inject({
      method: "GET",
      url: "/fixtures",
      headers: { [DEV_ACTOR_HEADER]: "alice" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveProperty("fixtures");
  });

  it("SC-11 in development the dev_actor cookie selects the actor, and the write is attributed to them", async () => {
    const server = serverWith("development");
    const response = await server.inject({
      method: "POST",
      url: "/fixtures",
      headers: { cookie: `${DEV_ACTOR_COOKIE}=bob; other=ignored` },
      payload: { note: "written by the switcher" },
    });
    expect(response.statusCode).toBe(201);
    const created = response.json() as { id: string; writtenBy: string };
    expect(created.writtenBy).toBe("bob");

    const client = await connect();
    try {
      const audited = await client.query<{ actor_id: string; app: string }>(
        `SELECT actor_id, app FROM audit_event
          WHERE resource_type = '_scaffold_fixture' AND resource_id = $1 AND action = 'insert'`,
        [created.id],
      );
      expect(audited.rows).toEqual([{ actor_id: actor("bob").id, app: "scaffold" }]);
    } finally {
      await client.end();
    }

    await withActor(actor("bob"), "req-dev-identity-cleanup", "scaffold", (tx) =>
      tx.query("DELETE FROM _scaffold_fixture WHERE id = $1", [created.id]),
    );
  });

  it("SC-11 an unknown dev actor is not an identity", async () => {
    const server = serverWith("development");
    const response = await server.inject({
      method: "GET",
      url: "/fixtures",
      headers: { [DEV_ACTOR_HEADER]: "mallory" },
    });
    expect(response.statusCode).toBe(401);
  });

  it("SC-11 outside development the middleware is not registered and the header is inert", async () => {
    for (const env of ["production", "test"]) {
      const server = serverWith(env);
      expect(server.identitySource()).toBe("none");
      expect(server.hooks()).not.toContain("dev-identity");

      const response = await server.inject({
        method: "GET",
        url: "/fixtures",
        headers: { [DEV_ACTOR_HEADER]: "alice" },
      });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: "no identity on the request" });
    }
  });

  it("SC-11 the switcher survives a workspace cwd, because .env is read from the repository root", async () => {
    // `npm run dev -w apps/kyc` runs with the app directory as cwd. dotenv's
    // default lookup finds no .env there, which used to leave NODE_ENV unset and
    // the switcher unregistered: every request in the UI was a 401.
    const cwd = process.cwd();
    const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
    const appDir = fileURLToPath(new URL("../../apps/kyc", import.meta.url));
    const nodeEnvBefore = process.env.NODE_ENV;
    const databaseUrlBefore = process.env.DATABASE_URL;
    try {
      process.chdir(appDir);
      delete process.env.NODE_ENV;
      delete process.env.DATABASE_URL;
      vi.resetModules();
      const { appDatabaseUrl, envFile } = await import("../src/env.js");
      const { isDevelopment } = await import("../src/dev-identity.js");
      expect(envFile).toBe(`${repoRoot}.env`);

      // CI passes both URLs in the environment and has no .env at all, so the
      // rest only applies to a local checkout that followed the README.
      if (!existsSync(envFile)) return;
      const dotenv = readFileSync(envFile, "utf8");
      expect(isDevelopment()).toBe(dotenv.includes("NODE_ENV=development"));
      expect(appDatabaseUrl()).toBe(
        /^DATABASE_URL=(.+)$/m.exec(dotenv)?.[1],
      );
    } finally {
      process.chdir(cwd);
      if (nodeEnvBefore === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = nodeEnvBefore;
      if (databaseUrlBefore === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = databaseUrlBefore;
      vi.resetModules();
    }
  });

  it("SC-11 in production identity comes from the injected provider instead", async () => {
    process.env.NODE_ENV = "production";
    const { createServer } = await import("../src/server.js");
    const server = createServer({
      app: "scaffold",
      identity: async () => actor("alice"),
    });
    servers.push(server);
    server.route(
      { method: "GET", path: "/whoami", action: "read", resourceType: "_scaffold_fixture" },
      async ({ actor: current }) => ({ subject: current.externalSubject }),
    );

    expect(server.identitySource()).toBe("custom");
    expect(server.hooks()).not.toContain("dev-identity");
    const response = await server.inject({ method: "GET", url: "/whoami" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ subject: "alice" });
  });
});
