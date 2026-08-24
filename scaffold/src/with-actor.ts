/**
 * withActor: the only place the application opens a transaction.
 *
 * Its entire job is to carry the actor, request id and app name into the
 * transaction as SET LOCAL settings. It contains no audit logic — the
 * audit_row() trigger reads those settings, and refuses any mutation made
 * without them.
 */
import pg from "pg";
import type { Actor } from "./actor.js";
import { appDatabaseUrl } from "./env.js";

export type Tx = pg.PoolClient;

let pool: pg.Pool | undefined;

/** The application connection pool: DATABASE_URL, i.e. app_role. Never the owner. */
export function appPool(): pg.Pool {
  pool ??= new pg.Pool({ connectionString: appDatabaseUrl(), max: 5 });
  return pool;
}

export async function closeAppPool(): Promise<void> {
  const open = pool;
  pool = undefined;
  await open?.end();
}

export async function withActor<T>(
  actor: Actor,
  requestId: string,
  app: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  const tx = await appPool().connect();
  try {
    await tx.query("BEGIN");
    await tx.query("SELECT set_config('app.actor_id', $1, true)", [actor.id]);
    await tx.query("SELECT set_config('app.request_id', $1, true)", [requestId]);
    await tx.query("SELECT set_config('app.name', $1, true)", [app]);
    const result = await fn(tx);
    await tx.query("COMMIT");
    return result;
  } catch (error) {
    await tx.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    tx.release();
  }
}
