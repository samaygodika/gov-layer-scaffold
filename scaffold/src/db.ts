import type pg from "pg";

/**
 * Anything that can run a query: a pooled client inside withActor(), a
 * standalone client in a script, or the pool itself for the reads that need no
 * transaction (identity lookup). Always the app_role connection.
 */
export type Queryable = {
  query<Row extends pg.QueryResultRow = pg.QueryResultRow>(
    sql: string,
    values?: unknown[],
  ): Promise<pg.QueryResult<Row>>;
};
