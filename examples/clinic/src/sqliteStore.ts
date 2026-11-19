/**
 * A durable, atomic session store on SQLite, using Node's built-in
 * `node:sqlite` (Node 22.13 or later; no package to install). A reference for
 * writing a store on any database: every versioned save is one statement, so
 * two processes sharing the file can never both win.
 *
 *   SESSION_DB=sessions.db pnpm --filter @kalangu/example-clinic start
 *
 * Checked against the contract with `checkSessionStore` (test/sqliteStore.test.ts).
 */

import { SessionConflictError, type SessionRecord, type SessionStore } from "@kalangu/core";

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS kalangu_sessions (
    phone   TEXT PRIMARY KEY,
    version INTEGER NOT NULL,
    record  TEXT NOT NULL
  )`;

/** Opens (or creates) the store in a file; ":memory:" for a throwaway one. */
export async function sqliteSessionStore(path: string): Promise<SessionStore & { close(): void }> {
  let sqlite: typeof import("node:sqlite");
  try {
    sqlite = await import("node:sqlite");
  } catch {
    throw new Error(`sqliteSessionStore needs node:sqlite, built into Node 22.13 and later (this is Node ${process.versions.node})`);
  }
  const db = new sqlite.DatabaseSync(path);
  // Readers do not block the writer, and a busy file waits briefly instead of failing at once.
  if (path !== ":memory:") db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec(SCHEMA);

  const select = db.prepare("SELECT version, record FROM kalangu_sessions WHERE phone = ?");
  // Without ifVersion: the last write wins, and the version still goes up by one.
  const upsert = db.prepare(`
    INSERT INTO kalangu_sessions (phone, version, record) VALUES (?, 1, ?)
    ON CONFLICT (phone) DO UPDATE SET version = version + 1, record = excluded.record
    RETURNING version`);
  // ifVersion 0: only if there is no record yet.
  const insertNew = db.prepare(`
    INSERT INTO kalangu_sessions (phone, version, record) VALUES (?, 1, ?)
    ON CONFLICT (phone) DO NOTHING
    RETURNING version`);
  // ifVersion n: only if the stored version is still n. One statement: the compare and the write cannot be split.
  const updateIf = db.prepare(`
    UPDATE kalangu_sessions SET version = version + 1, record = ?
    WHERE phone = ? AND version = ?
    RETURNING version`);
  const remove = db.prepare("DELETE FROM kalangu_sessions WHERE phone = ?");

  return {
    atomic: true,
    async load(phone) {
      const row = select.get(phone) as { version: number; record: string } | undefined;
      if (!row) return null;
      const record = JSON.parse(row.record) as SessionRecord;
      record.version = row.version;
      return record;
    },
    async save(record, options) {
      const json = JSON.stringify({ ...record, version: undefined });
      const ifVersion = options?.ifVersion;
      const row = (
        ifVersion === undefined
          ? upsert.get(record.phone, json)
          : ifVersion === 0
            ? insertNew.get(record.phone, json)
            : updateIf.get(json, record.phone, ifVersion)
      ) as { version: number } | undefined;
      if (!row) throw new SessionConflictError(`Session changed since version ${ifVersion} was read`);
      record.version = row.version;
    },
    async clear(phone) {
      remove.run(phone);
    },
    close() {
      db.close();
    },
  };
}
