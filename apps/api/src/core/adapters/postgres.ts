import pg from "pg";
import type { DatabasePort, Queryable, QueryParam, QueryResultRow } from "../ports/database";

type QueryableClient = {
  query<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params?: QueryParam[],
  ): Promise<{ rows: T[]; rowCount: number }>;
};

function toQueryable(client: QueryableClient): Queryable {
  return {
    async query<T extends QueryResultRow = QueryResultRow>(sql: string, params: QueryParam[] = []) {
      const result = await client.query<T>(sql, params);
      const rows = Array.isArray(result) ? result.at(-1)?.rows ?? [] : result.rows ?? [];
      const rowCount = Array.isArray(result) ? result.at(-1)?.rowCount ?? rows.length : result.rowCount ?? rows.length;
      return { rows, rowCount };
    },
  };
}

export class PostgresDatabase implements DatabasePort {
  private readonly pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new pg.Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
  }

  async query<T extends QueryResultRow = QueryResultRow>(sql: string, params: QueryParam[] = []) {
    const result = await this.pool.query<T>(sql, params);
    const rows = Array.isArray(result) ? result.at(-1)?.rows ?? [] : result.rows ?? [];
    const rowCount = Array.isArray(result) ? result.at(-1)?.rowCount ?? rows.length : result.rowCount ?? rows.length;
    return { rows, rowCount };
  }

  async transaction<T>(fn: (client: Queryable) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(toQueryable(client));
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
