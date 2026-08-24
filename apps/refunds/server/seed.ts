import type pg from "pg";

const DEFAULT_ROWS = 50;
const REQUESTER_SUBJECT = "carol";
const CURRENCIES = ["USD", "EUR", "GBP", "CAD"];

export async function seedApp(
  client: pg.Client,
  options: { rows: number | undefined },
): Promise<string> {
  const target = options.rows ?? DEFAULT_ROWS;
  const existing = Number(
    (await client.query<{ count: string }>("SELECT count(*)::text AS count FROM refund_request")).rows[0]
      ?.count ?? "0",
  );
  if (existing >= target) {
    return `${existing} refund_request rows already present, target ${target}; nothing to seed`;
  }

  const requester = await client.query<{ id: string }>(
    "SELECT id FROM actor WHERE external_subject = $1",
    [REQUESTER_SUBJECT],
  );
  const requesterId = requester.rows[0]?.id;
  if (!requesterId) throw new Error(`no seeded actor ${REQUESTER_SUBJECT}; run npm run seed first`);

  const wanted = target - existing;
  await client.query("BEGIN");
  try {
    await client.query("SELECT set_config('app.actor_id', $1, true)", [requesterId]);
    await client.query("SELECT set_config('app.request_id', 'seed', true)");
    await client.query("SELECT set_config('app.name', 'refunds', true)");
    await client.query(
      `WITH generated AS (
         SELECT n,
                5000 + (((n - 1) * 2137) % 15001) AS amount_cents
           FROM generate_series(1, $1::int) AS n
       )
       INSERT INTO refund_request (transaction_ref, amount_cents, currency, reason, status)
       SELECT 'seed-txn-' || (n + $2),
              amount_cents,
              (ARRAY['USD', 'EUR', 'GBP', 'CAD'])[1 + ((n - 1) % 4)],
              'Seed refund request ' || (n + $2),
              CASE
                WHEN amount_cents >= 10000 THEN CASE WHEN n % 2 = 1 THEN 'pending' ELSE 'rejected' END
                ELSE (ARRAY['pending', 'rejected', 'approved'])[1 + ((n - 1) % 3)]
              END
         FROM generated`,
      [wanted, existing],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }

  return `seeded ${wanted} refund_request rows (${target} total)`;
}
