/**
 * SC-13. The report is built from the database and the route registry, so this
 * test asserts the shape and the ordering from verification-addendum.md §A, and
 * that running the script twice produces byte-identical output.
 */
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";
import { createDemoServer } from "../src/demo-server.js";
import { buildGovernanceReport, serializeGovernanceReport } from "../src/governance.js";
import { governanceDir, repoRoot } from "../src/paths.js";
import type { ScaffoldServer } from "../src/server.js";
import { connect } from "./helpers.js";

const run = promisify(execFile);
const servers: ScaffoldServer[] = [];

const server = (): ScaffoldServer => {
  const created = createDemoServer();
  servers.push(created);
  return created;
};

afterAll(async () => {
  await Promise.all(servers.splice(0).map((instance) => instance.close()));
});

describe("npm run governance-report", () => {
  it("SC-13 writes reports/governance/<app>.json in the addendum's shape", async () => {
    await run("npx", ["tsx", "scaffold/src/governance-report.ts"], { cwd: repoRoot });

    const written = JSON.parse(
      await readFile(join(governanceDir, "scaffold.json"), "utf8"),
    ) as Record<string, unknown>;

    expect(Object.keys(written)).toEqual([
      "app",
      "tables",
      "audit_event_shape",
      "audit_actions_seen",
      "approval_constraints",
      "app_role_grants",
      "routes",
      "routes_outside_registry",
    ]);
    expect(written.app).toBe("scaffold");
    expect(written.tables).toEqual([
      { name: "_scaffold_fixture", pk: "id:uuid", audit_trigger: true },
    ]);
    expect(written.audit_event_shape).toEqual([
      "id",
      "occurred_at",
      "actor_id",
      "app",
      "action",
      "resource_type",
      "resource_id",
      "before",
      "after",
      "request_id",
    ]);
    expect(written.approval_constraints).toEqual([
      "approval_actor_matches",
      "approval_decision_has_decider",
      "approval_decision_has_rationale",
      "approval_decision_vocabulary",
      "approval_maker_checker",
    ]);
    expect(written.app_role_grants).toEqual({
      _scaffold_fixture: ["DELETE", "INSERT", "SELECT", "UPDATE"],
      approval: ["INSERT", "SELECT", "UPDATE"],
      audit_event: ["SELECT"],
    });
    expect(written.routes).toEqual([
      { method: "GET", path: "/fixtures", action: "read", resourceType: "_scaffold_fixture" },
      { method: "POST", path: "/fixtures", action: "write", resourceType: "_scaffold_fixture" },
      {
        method: "POST",
        path: "/fixtures/:id/approvals",
        action: "approve",
        resourceType: "_scaffold_fixture",
      },
    ]);
    expect(written.routes_outside_registry).toEqual([]);
    for (const action of written.audit_actions_seen as string[]) {
      expect(["insert", "update", "delete"]).toContain(action);
    }
  });

  it("SC-13 the same database and registry produce byte-identical output", async () => {
    const client = await connect();
    try {
      const first = serializeGovernanceReport(await buildGovernanceReport(client, server()));
      const second = serializeGovernanceReport(await buildGovernanceReport(client, server()));
      expect(first).toBe(second);
      expect(first).toBe(await readFile(join(governanceDir, "scaffold.json"), "utf8"));
    } finally {
      await client.end();
    }
  });
});
