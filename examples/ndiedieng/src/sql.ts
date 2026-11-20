/**
 * The few SQL operations the prototype needs, so the same code runs on
 * Node's built-in SQLite (the server) and on SQLite compiled for the browser
 * (the website's demo, sql.js).
 */

export type SqlValue = string | number | null;
export type SqlRow = Record<string, unknown>;

export interface SqlDb {
  exec(sql: string): void;
  all(sql: string, ...params: SqlValue[]): SqlRow[];
  get(sql: string, ...params: SqlValue[]): SqlRow | undefined;
  run(sql: string, ...params: SqlValue[]): void;
  /**
   * Runs a query where it cannot change anything: on a read-only connection
   * (Node) or on a throwaway copy (browser). For the assistant's queries.
   */
  readOnly(sql: string): { columns: string[]; rows: SqlRow[] };
  close(): void;
}
