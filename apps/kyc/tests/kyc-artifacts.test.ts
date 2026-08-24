/**
 * AC-7 … AC-9 — the artifacts this session has to leave behind. They are files
 * rather than behaviour, so the test asserts they exist and say what the spec
 * requires; a criterion with no test of its id counts as not attempted.
 */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (path: string): Promise<string> => readFile(join(repoRoot, path), "utf8");

describe("kyc artifacts", () => {
  it("AC-7 the README documents how to run, seed and switch dev actors", async () => {
    const readme = await read("apps/kyc/README.md");
    expect(readme).toMatch(/npm run dev -w apps\/kyc/);
    expect(readme).toMatch(/npm run seed/);
    expect(readme).toMatch(/--rows=10000/);
    expect(readme).toMatch(/X-Dev-Actor|dev_actor/);
  });

  it("AC-8 reports/governance/kyc.json is committed and describes this app", async () => {
    const report = JSON.parse(await read("reports/governance/kyc.json")) as {
      app: string;
      tables: { name: string; pk: string; audit_trigger: boolean }[];
      routes: { path: string }[];
      routes_outside_registry: unknown[];
      app_role_grants: Record<string, string[]>;
    };
    expect(report.app).toBe("kyc");
    expect(report.tables).toEqual([{ name: "kyc_case", pk: "id:uuid", audit_trigger: true }]);
    expect(report.routes.map((route) => route.path)).toContain("/api/cases/:id/decision");
    expect(report.routes_outside_registry).toEqual([]);
    expect(report.app_role_grants["audit_event"]).toEqual(["SELECT"]);
  });

  it("AC-9 reports/session-2.md is filled from the template", async () => {
    const report = await read("reports/session-2.md");
    const template = await read("reports/TEMPLATE.md");
    const headings = (text: string): string[] => text.match(/^## .*$/gm) ?? [];
    expect(headings(report).map((heading) => heading.replace(/\s+—.*/, ""))).toEqual(
      headings(template).map((heading) => heading.replace(/\s+—.*/, "")),
    );
    expect(report).toMatch(/AC-1/);
    expect(report.length).toBeGreaterThan(2000);
  });
});
