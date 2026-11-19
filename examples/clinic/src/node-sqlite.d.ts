/**
 * The parts of `node:sqlite` the example uses. The types for Node 20, which
 * the packages support, predate `node:sqlite` (Node 22.13), so they are
 * declared here; remove this file when the types move past Node 22.
 */
declare module "node:sqlite" {
  export class StatementSync {
    get(...params: unknown[]): unknown;
    run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  }
  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}
