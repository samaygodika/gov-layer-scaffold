/**
 * Test plumbing. Every connection here is DATABASE_URL — app_role — on purpose:
 * a test that connects as scaffold_owner proves nothing about what the
 * application can do.
 */
import pg from "pg";
import { appDatabaseUrl } from "../src/env.js";
import { SEED_ACTORS } from "../src/seed-data.js";

export const actorId = (externalSubject: string): string => {
  const actor = SEED_ACTORS.find((candidate) => candidate.externalSubject === externalSubject);
  if (!actor) throw new Error(`no seeded actor ${externalSubject}`);
  return actor.id;
};

export type ActorContext = {
  actorId: string;
  requestId?: string;
  app?: string;
};

export async function connect(): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: appDatabaseUrl() });
  await client.connect();
  return client;
}

/** The SET LOCAL settings a mutating request carries, applied to an open transaction. */
export async function setActor(tx: pg.Client, context: ActorContext): Promise<void> {
  await tx.query("SELECT set_config('app.actor_id', $1, true)", [context.actorId]);
  await tx.query("SELECT set_config('app.request_id', $1, true)", [context.requestId ?? ""]);
  await tx.query("SELECT set_config('app.name', $1, true)", [context.app ?? ""]);
}

/**
 * Runs fn inside a transaction that is always rolled back, so tests leave no
 * rows behind. When context is given, the transaction carries the same
 * SET LOCAL settings a mutating request would.
 */
export async function inTransaction<T>(
  context: ActorContext | null,
  fn: (tx: pg.Client) => Promise<T>,
): Promise<T> {
  const client = await connect();
  try {
    await client.query("BEGIN");
    if (context) await setActor(client, context);
    return await fn(client);
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    await client.end();
  }
}

export type SqlFailure = {
  message: string;
  code: string | undefined;
  constraint: string | undefined;
};

/**
 * Like expectFailure, but leaves the transaction usable: a rejected statement
 * aborts the transaction, so a test that makes several attempts needs each one
 * wrapped in a savepoint.
 */
export async function expectRejected(
  tx: pg.Client,
  sql: string,
  params: unknown[] = [],
): Promise<SqlFailure> {
  await tx.query("SAVEPOINT expect_rejected");
  try {
    return await expectFailure(tx.query(sql, params));
  } finally {
    await tx.query("ROLLBACK TO SAVEPOINT expect_rejected");
  }
}

export async function expectFailure(promise: Promise<unknown>): Promise<SqlFailure> {
  try {
    await promise;
  } catch (error) {
    const pgError = error as { message: string; code?: string; constraint?: string };
    return { message: pgError.message, code: pgError.code, constraint: pgError.constraint };
  }
  throw new Error("expected the statement to be rejected, but it succeeded");
}
