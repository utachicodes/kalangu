import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { atLeast, fingerprint, pinnedPnpm } from "./setup.mjs";

describe("setup", () => {
  it("compares Node versions, with or without the v", () => {
    assert.equal(atLeast("v22.13.0", [22, 13]), true);
    assert.equal(atLeast("22.12.9", [22, 13]), false);
    assert.equal(atLeast("24.0.0", [22, 13]), true);
    assert.equal(atLeast("20.19.0", [20, 0]), true);
    assert.equal(atLeast("18.20.0", [20, 0]), false);
  });

  it("reads the pinned pnpm, with or without a hash", () => {
    assert.equal(pinnedPnpm({ packageManager: "pnpm@12.6.0" }), "12.6.0");
    assert.equal(pinnedPnpm({ packageManager: "pnpm@12.6.0+sha512.abc" }), "12.6.0");
    assert.equal(pinnedPnpm({ packageManager: "npm@10.0.0" }), null);
    assert.equal(pinnedPnpm({}), null);
  });

  it("changes its fingerprint with the lockfile, pnpm or Node major, not a Node patch", () => {
    const base = fingerprint("lock", "12.6.0", "v22.13.0");
    assert.equal(fingerprint("lock", "12.6.0", "v22.14.1"), base);
    assert.notEqual(fingerprint("lock2", "12.6.0", "v22.13.0"), base);
    assert.notEqual(fingerprint("lock", "12.7.0", "v22.13.0"), base);
    assert.notEqual(fingerprint("lock", "12.6.0", "v24.0.0"), base);
  });

  it("is the pnpm the repository pins", async () => {
    const { readFile } = await import("node:fs/promises");
    const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
    assert.match(pinnedPnpm(pkg) ?? "", /^\d+\.\d+\.\d+$/);
  });
});
