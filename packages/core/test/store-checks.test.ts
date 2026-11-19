import { describe, expect, it } from "vitest";
import { checkSessionStore, memoryStore, SessionConflictError, type SessionRecord, type SessionStore } from "../src/index.js";

/** A store with the contract's moving parts switchable, to show each check catches its fault. */
function faultyStore(fault: "no-version" | "no-cas" | "shared-object" | "not-atomic" | "leaky-phones"): SessionStore {
  const records = new Map<string, SessionRecord>();
  const key = (phone: string) => (fault === "leaky-phones" ? "same" : phone);
  return {
    async load(phone) {
      const r = records.get(key(phone));
      if (!r) return null;
      return fault === "shared-object" ? r : structuredClone(r);
    },
    async save(record, options) {
      const current = records.get(key(record.phone))?.version ?? 0;
      if (fault !== "no-cas" && options?.ifVersion !== undefined && options.ifVersion !== current) {
        throw new SessionConflictError("changed");
      }
      if (fault === "not-atomic") await new Promise((r) => setTimeout(r, 1)); // check, then write later: a race
      if (fault !== "no-version") record.version = current + 1;
      records.set(key(record.phone), fault === "shared-object" ? record : structuredClone(record));
    },
    atomic: true,
    async clear(phone) {
      records.delete(key(phone));
    },
  };
}

const checks = async (make: () => SessionStore) => (await checkSessionStore(make)).map((p) => p.check);

describe("checkSessionStore", () => {
  it("finds no problem in the built-in memory store", async () => {
    expect(await checkSessionStore(() => memoryStore())).toEqual([]);
  });

  it("catches a store that does not bump the version", async () => {
    expect(await checks(() => faultyStore("no-version"))).toContain("save bumps record.version, starting at 1");
  });

  it("catches a store that ignores ifVersion", async () => {
    const found = await checks(() => faultyStore("no-cas"));
    expect(found).toContain("ifVersion that is stale throws SessionConflictError and changes nothing");
    expect(found).toContain("ifVersion 0 means the record must not exist yet");
  });

  it("catches a store that hands out its own objects", async () => {
    expect(await checks(() => faultyStore("shared-object"))).toContain("a loaded record is a copy, not the stored object");
  });

  it("catches a store that says it is atomic but is not", async () => {
    const found = await checkSessionStore(() => faultyStore("not-atomic"));
    const race = found.find((p) => p.check.startsWith("a store that says it is atomic"));
    expect(race?.problem).toMatch(/of 10 saves based on version 1 succeeded, expected exactly 1/);
  });

  it("catches a store that mixes up phone numbers", async () => {
    expect(await checks(() => faultyStore("leaky-phones"))).toContain("phone numbers do not share sessions");
  });

  it("reports a store that throws instead of throwing itself", async () => {
    const broken: SessionStore = {
      load: async () => {
        throw new Error("database down");
      },
      save: async () => {},
      clear: async () => {},
    };
    const found = await checkSessionStore(() => broken);
    expect(found.length).toBeGreaterThan(0);
    expect(found[0]!.problem).toBe("threw Error: database down");
  });
});
