/**
 * SqlDb on Node's built-in `node:sqlite` (Node 22.13+), in a file so that a
 * second, read-only connection can run the assistant's queries.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createCommune, type CommuneOptions, type Commune } from "./db.js";
import type { SqlDb, SqlRow } from "./sql.js";

export function nodeSqlDb(path: string): SqlDb {
  const db = new DatabaseSync(path);
  return {
    exec: (sql) => db.exec(sql),
    all: (sql, ...params) => db.prepare(sql).all(...params) as SqlRow[],
    get: (sql, ...params) => db.prepare(sql).get(...params) as SqlRow | undefined,
    run: (sql, ...params) => void db.prepare(sql).run(...params),
    readOnly(sql) {
      const ro = new DatabaseSync(path, { readOnly: true });
      try {
        const stmt = ro.prepare(sql);
        return { rows: stmt.all() as SqlRow[], columns: stmt.columns().map((c) => c.name) };
      } finally {
        ro.close();
      }
    },
    close: () => db.close(),
  };
}

/** The commune in a new SQLite file (default: in the system's temp folder). */
export function openCommune(options: CommuneOptions & { path?: string } = {}): Commune & { readonly path: string } {
  const path = options.path ?? join(mkdtempSync(join(tmpdir(), "ndiedieng-")), "commune.db");
  return Object.assign(createCommune(nodeSqlDb(path), options), { path });
}
