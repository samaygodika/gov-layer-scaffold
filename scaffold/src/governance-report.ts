/**
 * npm run governance-report — verification-addendum.md §A.
 *
 * Connects as app_role and writes reports/governance/<app>.json for every app
 * in apps/. An app is discovered by convention: `apps/<name>/server/app.ts`
 * exporting `createApp(): ScaffoldServer`. Until an app session exists, the
 * scaffold's own demo server stands in, so the artifact's shape is verifiable
 * from session 1b onwards.
 */
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { createDemoServer, SCAFFOLD_APP } from "./demo-server.js";
import { appDatabaseUrl } from "./env.js";
import { buildGovernanceReport, serializeGovernanceReport } from "./governance.js";
import { appsDir, governanceDir } from "./paths.js";
import type { ScaffoldServer } from "./server.js";
import { closeAppPool } from "./with-actor.js";

type Target = { name: string; create: () => ScaffoldServer | Promise<ScaffoldServer> };

async function discoverApps(): Promise<Target[]> {
  let entries: string[];
  try {
    entries = await readdir(appsDir);
  } catch {
    return [];
  }
  const targets: Target[] = [];
  for (const name of entries.sort()) {
    const entrypoint = join(appsDir, name, "server", "app.ts");
    const exists = await stat(entrypoint).then(
      () => true,
      () => false,
    );
    if (!exists) continue;
    const module: unknown = await import(pathToFileURL(entrypoint).href);
    const createApp = (module as { createApp?: () => ScaffoldServer }).createApp;
    if (typeof createApp !== "function") {
      throw new Error(`${entrypoint} must export createApp(): ScaffoldServer`);
    }
    targets.push({ name, create: createApp });
  }
  return targets;
}

async function main(): Promise<void> {
  const discovered = await discoverApps();
  const targets: Target[] =
    discovered.length > 0
      ? discovered
      : [{ name: SCAFFOLD_APP, create: () => createDemoServer() }];

  const client = new pg.Client({ connectionString: appDatabaseUrl() });
  await client.connect();
  await mkdir(governanceDir, { recursive: true });
  try {
    for (const target of targets) {
      const server = await target.create();
      try {
        // The framework's route table is only complete once the instance is ready,
        // so routes_outside_registry cannot miss a late registration.
        await server.ready();
        const report = await buildGovernanceReport(client, server);
        const file = join(governanceDir, `${target.name}.json`);
        await writeFile(file, serializeGovernanceReport(report), "utf8");
        console.log(
          `wrote ${file}: ${report.tables.length} table(s), ${report.routes.length} route(s), ` +
            `${report.routes_outside_registry.length} outside the registry`,
        );
      } finally {
        await server.close();
      }
    }
  } finally {
    await client.end();
    await closeAppPool();
  }
}

await main();
