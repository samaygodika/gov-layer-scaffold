/**
 * The scaffold's own server, over the `_scaffold_fixture` table.
 *
 * It is not an application: it exists so the route registry, the dev identity
 * switcher and the governance report can be exercised end to end before any app
 * session runs, and so `apps/<name>/server/app.ts` has a worked example of the
 * only shape the scaffold offers — createServer() plus route() calls.
 */
import { createServer, type ScaffoldServer } from "./server.js";

export const SCAFFOLD_APP = "scaffold";

export function createDemoServer(app: string = SCAFFOLD_APP): ScaffoldServer {
  const server = createServer({ app });

  server.route(
    { method: "GET", path: "/fixtures", action: "read", resourceType: "_scaffold_fixture" },
    async ({ tx }) => {
      const rows = await tx.query<{ id: string; note: string | null }>(
        "SELECT id, note FROM _scaffold_fixture ORDER BY id LIMIT 50",
      );
      return { fixtures: rows.rows };
    },
  );

  server.route(
    { method: "POST", path: "/fixtures", action: "write", resourceType: "_scaffold_fixture" },
    async ({ tx, body, actor, reply }) => {
      const note = (body as { note?: string } | undefined)?.note ?? null;
      const inserted = await tx.query<{ id: string }>(
        "INSERT INTO _scaffold_fixture (note) VALUES ($1) RETURNING id",
        [note],
      );
      reply.code(201);
      return { id: inserted.rows[0]!.id, note, writtenBy: actor.externalSubject };
    },
  );

  server.route(
    {
      method: "POST",
      path: "/fixtures/:id/approvals",
      action: "approve",
      resourceType: "_scaffold_fixture",
    },
    async ({ tx, params, actor, reply }) => {
      const { id } = params as { id: string };
      // requested_by comes from the session actor, never the request body.
      const inserted = await tx.query<{ id: string }>(
        `INSERT INTO approval (resource_type, resource_id, requested_by)
           VALUES ('_scaffold_fixture', $1, $2) RETURNING id`,
        [id, actor.id],
      );
      reply.code(201);
      return { approvalId: inserted.rows[0]!.id, requestedBy: actor.externalSubject };
    },
  );

  return server;
}
