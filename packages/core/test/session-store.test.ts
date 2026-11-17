import { describe, expect, it } from "vitest";
import { SessionConflictError, freshRecord, memoryStore } from "../src/index.js";

const PHONE = "+254700000001";

describe("memoryStore versioning", () => {
  it("bumps the version on every save", async () => {
    const store = memoryStore();
    const record = freshRecord(PHONE, "en", 1);
    await store.save(record);
    expect(record.version).toBe(1);
    await store.save(record);
    expect((await store.load(PHONE))?.version).toBe(2);
  });

  it("saves when ifVersion matches, treating a missing record as version 0", async () => {
    const store = memoryStore();
    const record = freshRecord(PHONE, "en", 1);
    await store.save(record, { ifVersion: 0 });
    await store.save(record, { ifVersion: 1 });
    expect((await store.load(PHONE))?.version).toBe(2);
  });

  it("refuses a stale ifVersion and changes nothing", async () => {
    const store = memoryStore();
    const record = freshRecord(PHONE, "en", 1);
    await store.save(record);
    const stale = (await store.load(PHONE))!;
    await store.save(record); // someone else saves first: version is now 2
    stale.locale = "fr";
    await expect(store.save(stale, { ifVersion: 1 })).rejects.toBeInstanceOf(SessionConflictError);
    expect((await store.load(PHONE))?.locale).toBe("en");
  });

  it("lets exactly one of many racing versioned saves win", async () => {
    const store = memoryStore();
    await store.save(freshRecord(PHONE, "en", 1));
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, async () => store.save((await store.load(PHONE))!, { ifVersion: 1 })),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });

  it("reports that it is atomic", () => {
    expect(memoryStore().atomic).toBe(true);
  });

  it("loads sessions stored before versions existed", async () => {
    const store = memoryStore();
    const legacy = freshRecord(PHONE, "en", 1);
    delete legacy.version;
    await store.save(legacy, { ifVersion: 0 });
    expect((await store.load(PHONE))?.version).toBe(1);
  });
});
