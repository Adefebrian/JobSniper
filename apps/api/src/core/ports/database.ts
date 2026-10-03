export type QueryParam = unknown;

export type QueryResultRow = Record<string, unknown>;

export interface Queryable {
  query<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params?: QueryParam[],
  ): Promise<{ rows: T[]; rowCount: number }>;
}

export interface DatabasePort extends Queryable {
  transaction<T>(fn: (client: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
