import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CATEGORY, EQUIPMENT, fill, reviewSheet, STATUS, TEXT, URGENCY } from "../src/strings.js";

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("the chiefs' strings", () => {
  it("has every string in French and Wolof, with the same placeholders", () => {
    for (const table of [TEXT, CATEGORY, URGENCY, STATUS, EQUIPMENT]) {
      for (const [key, pair] of Object.entries(table)) {
        expect(pair.fr.trim(), key).not.toBe("");
        expect(pair.wo.trim(), key).not.toBe("");
        expect(placeholders(pair.wo), key).toEqual(placeholders(pair.fr));
      }
    }
  });

  it("fills placeholders and leaves unknown ones", () => {
    expect(fill("{code} ({what})", { code: "S-0001" })).toBe("S-0001 ({what})");
  });

  it("keeps wolof-review.csv in step (pnpm --filter @kalangu/example-ndiedieng wolof:sheet)", () => {
    const file = readFileSync(new URL("../wolof-review.csv", import.meta.url), "utf8");
    expect(file).toBe(reviewSheet());
  });
});
