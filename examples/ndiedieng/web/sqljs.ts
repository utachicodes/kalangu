/**
 * SqlDb on sql.js, SQLite compiled for the browser, so the website's demo
 * runs entirely in the visitor's browser: no server, no shared state, nothing
 * sent anywhere. sql.js is loaded from cdnjs, pinned and checked by its
 * integrity hash.
 */

import type { SqlDb, SqlRow, SqlValue } from "../src/sql.js";

interface Statement {
  bind(params: SqlValue[]): boolean;
  step(): boolean;
  getAsObject(): SqlRow;
  getColumnNames(): string[];
  free(): boolean;
}
interface Database {
  exec(sql: string): unknown;
  run(sql: string, params?: SqlValue[]): unknown;
  prepare(sql: string): Statement;
  export(): Uint8Array;
  close(): void;
}
export interface SqlJs {
  Database: new (data?: Uint8Array) => Database;
}

const VERSION = "1.13.0";
const BASE = `https://cdnjs.cloudflare.com/ajax/libs/sql.js/${VERSION}`;
const INTEGRITY = "sha384-DJiKBv+LC78e5InEB+MvFIAH079ynMK/ERTtFUCpDzXhH1Bht7aVfpg3yOVsuYl9";

/** Loads sql.js once, from cdnjs, refusing a file that does not match its hash. */
export async function loadSqlJs(): Promise<SqlJs> {
  const g = globalThis as unknown as { initSqlJs?: (config: { locateFile: (f: string) => string }) => Promise<SqlJs> };
  if (!g.initSqlJs) {
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = `${BASE}/sql-wasm.js`;
      script.integrity = INTEGRITY;
      script.crossOrigin = "anonymous";
      script.referrerPolicy = "no-referrer";
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("SQLite for the browser could not be loaded"));
      document.head.append(script);
    });
  }
  return g.initSqlJs!({ locateFile: (file) => `${BASE}/${file}` });
}

function rows(db: Database, sql: string, params: SqlValue[]): { columns: string[]; rows: SqlRow[] } {
  const stmt = db.prepare(sql);
  try {
    if (params.length) stmt.bind(params);
    const out: SqlRow[] = [];
    while (stmt.step()) out.push(stmt.getAsObject());
    return { columns: stmt.getColumnNames(), rows: out };
  } finally {
    stmt.free();
  }
}

export function sqlJsDb(SQL: SqlJs): SqlDb {
  const db = new SQL.Database();
  return {
    exec: (sql) => void db.exec(sql),
    all: (sql, ...params) => rows(db, sql, params).rows,
    get: (sql, ...params) => rows(db, sql, params).rows[0],
    run: (sql, ...params) => void db.run(sql, params),
    readOnly(sql) {
      // A throwaway copy: whatever the query does, the commune's data is untouched.
      const copy = new SQL.Database(db.export());
      try {
        return rows(copy, sql, []);
      } finally {
        copy.close();
      }
    },
    close: () => db.close(),
  };
}
