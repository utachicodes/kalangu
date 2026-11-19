import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkSessionStore, freshRecord, SessionConflictError, silentLogger } from "@kalangu/core";
import { createPhone } from "@kalangu/sim";
import { createClinic } from "../src/clinic.js";
import { fakeNurse } from "../src/nurse.js";
import { sqliteSessionStore } from "../src/sqliteStore.js";

const dirs: string[] = [];
const tempFile = () => {
  const dir = mkdtempSync(join(tmpdir(), "kalangu-sqlite-"));
  dirs.push(dir);
  return join(dir, "sessions.db");
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("the SQLite session store", () => {
  it("keeps the session store contract", async () => {
    expect(await checkSessionStore(() => sqliteSessionStore(":memory:"))).toEqual([]);
  });

  it("lets only one of two connections win a versioned save, as two processes would", async () => {
    const file = tempFile();
    const a = await sqliteSessionStore(file);
    const b = await sqliteSessionStore(file);
    const record = freshRecord("+254700000001", "en", 0);
    await a.save(record); // version 1
    const [fromA, fromB] = [(await a.load(record.phone))!, (await b.load(record.phone))!];
    fromA.data["by"] = "a";
    fromB.data["by"] = "b";
    await a.save(fromA, { ifVersion: 1 });
    await expect(b.save(fromB, { ifVersion: 1 })).rejects.toBeInstanceOf(SessionConflictError);
    expect((await b.load(record.phone))?.data["by"]).toBe("a");
    a.close();
    b.close();
  });

  it("keeps a conversation across a restart", async () => {
    const file = tempFile();
    const first = await sqliteSessionStore(file);
    const before = createPhone(createClinic({ channels: [], sessionStore: first, model: fakeNurse({ delayMs: 0 }), logger: silentLogger }), {
      code: "*384*1#",
    });
    await before.dial("*384*1#");
    await before.press("3"); // Language
    await before.press("2"); // Français
    first.close();

    // A new process: a new store on the same file. The language chosen before is still there.
    const second = await sqliteSessionStore(file);
    const after = createPhone(createClinic({ channels: [], sessionStore: second, model: fakeNurse({ delayMs: 0 }), logger: silentLogger }), {
      code: "*384*1#",
    });
    expect((await after.dial("*384*1#")).text).toMatch(/^Ligne de la clinique/);
    second.close();
  });
});
