/**
 * KYC fixtures, discovered by `npm run seed` (`--rows=N` for load data).
 *
 * Cases arrive from upstream, so every seeded case is `pending`: a decided case
 * with no `approval` row behind it would be a state the application cannot
 * produce. The intake runs as an actor like any other write — the audit trigger
 * refuses an unattributed insert — so the rows are attributed to the `agent`
 * actor that stands in for the upstream feed, with request_id `seed`.
 */
import type pg from "pg";

const DEFAULT_ROWS = 24;
const INTAKE_SUBJECT = "carol";

export async function seedApp(
  client: pg.Client,
  options: { rows: number | undefined },
): Promise<string> {
  const target = options.rows ?? DEFAULT_ROWS;

  const existing = Number(
    (await client.query<{ count: string }>("SELECT count(*)::text AS count FROM kyc_case")).rows[0]
      ?.count ?? "0",
  );
  if (existing >= target) {
    return `${existing} kyc_case rows already present, target ${target}; nothing to seed`;
  }

  const intake = await client.query<{ id: string }>(
    "SELECT id FROM actor WHERE external_subject = $1",
    [INTAKE_SUBJECT],
  );
  const intakeId = intake.rows[0]?.id;
  if (!intakeId) throw new Error(`no seeded actor ${INTAKE_SUBJECT}; run npm run seed first`);

  const wanted = target - existing;
  await client.query("BEGIN");
  try {
    await client.query("SELECT set_config('app.actor_id', $1, true)", [intakeId]);
    await client.query("SELECT set_config('app.request_id', 'seed', true)");
    await client.query("SELECT set_config('app.name', 'kyc', true)");
    await client.query(
      `INSERT INTO kyc_case (subject_name, submitted_at, risk_tier, documents, status)
       SELECT 'Subject ' || lpad((n + $2)::text, 5, '0'),
              now() - (n * interval '7 minutes'),
              (ARRAY['low', 'medium', 'high'])[1 + (n % 3)],
              jsonb_build_array(
                jsonb_build_object('kind', 'passport', 'ref', 'P-' || lpad((n + $2)::text, 6, '0')),
                jsonb_build_object('kind', 'proof_of_address', 'ref', 'A-' || lpad((n + $2)::text, 6, '0'))
              ),
              'pending'
         FROM generate_series(1, $1::int) AS n`,
      [wanted, existing],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }

  return `seeded ${wanted} pending kyc_case rows (${target} total)`;
}
