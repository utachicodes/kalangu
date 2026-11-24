import { describe, expect, it } from "vitest";
import { DEFAULT_LANGUAGE_PRIORS, callingCodeOf, orderLanguages, type Language } from "../src/index.js";

const en: Language = { code: "en", name: "English" };
const fr: Language = { code: "fr", name: "Français" };
const wo: Language = { code: "wo", name: "Wolof" };
const sw: Language = { code: "sw", name: "Kiswahili" };
const ha: Language = { code: "ha", name: "Hausa" };
const all = [en, fr, wo, sw, ha];

describe("callingCodeOf", () => {
  it("finds the calling code of an E.164 number, with or without the plus", () => {
    expect(callingCodeOf("+221771234567", DEFAULT_LANGUAGE_PRIORS)).toBe("221");
    expect(callingCodeOf("254700000001", DEFAULT_LANGUAGE_PRIORS)).toBe("254");
  });

  it("takes the longest matching code", () => {
    const priors = { "22": ["en"], "221": ["fr"] };
    expect(callingCodeOf("+221770000000", priors)).toBe("221");
    expect(callingCodeOf("+225000000", priors)).toBe("22");
  });

  it("finds nothing for a number from elsewhere, or for an id that is not a phone number", () => {
    expect(callingCodeOf("+14155550100", DEFAULT_LANGUAGE_PRIORS)).toBeNull();
    expect(callingCodeOf("US.13491208655302741918", DEFAULT_LANGUAGE_PRIORS)).toBeNull();
    expect(callingCodeOf("", DEFAULT_LANGUAGE_PRIORS)).toBeNull();
  });
});

describe("orderLanguages", () => {
  it("lists the likely languages for the country first, in the prior's order", () => {
    expect(orderLanguages(all, "+221771234567").map((l) => l.code)).toEqual(["fr", "wo", "en", "sw", "ha"]);
    expect(orderLanguages(all, "+254700000001").map((l) => l.code)).toEqual(["sw", "en", "fr", "wo", "ha"]);
    expect(orderLanguages(all, "+234800000000").map((l) => l.code)).toEqual(["en", "ha", "fr", "wo", "sw"]);
    const bm: Language = { code: "bm", name: "Bamanankan" };
    expect(orderLanguages([...all, bm], "+22370000000").map((l) => l.code)).toEqual(["fr", "bm", "en", "wo", "sw", "ha"]);
  });

  it("keeps the given order when there is no prior for the number", () => {
    expect(orderLanguages(all, "+14155550100").map((l) => l.code)).toEqual(["en", "fr", "wo", "sw", "ha"]);
    expect(orderLanguages(all, "US.13491208655302741918").map((l) => l.code)).toEqual(["en", "fr", "wo", "sw", "ha"]);
  });

  it("never hides a language: every one appears exactly once", () => {
    for (const phone of ["+221771234567", "+254700000001", "+999000", "nobody"]) {
      const codes = orderLanguages(all, phone).map((l) => l.code);
      expect([...codes].sort()).toEqual(["en", "fr", "ha", "sw", "wo"]);
    }
  });

  it("ignores a prior that names a language the agent does not offer", () => {
    // Senegal's prior is fr, wo, en; this agent offers neither Wolof nor English.
    expect(orderLanguages([sw, fr], "+221771234567").map((l) => l.code)).toEqual(["fr", "sw"]);
  });

  it("uses priors given by the developer instead", () => {
    const priors = { "221": ["ha", "sw"] };
    expect(orderLanguages(all, "+221771234567", priors).map((l) => l.code)).toEqual(["ha", "sw", "en", "fr", "wo"]);
  });

  it("does not change the list it was given", () => {
    const given = [...all];
    orderLanguages(given, "+254700000001");
    expect(given).toEqual(all);
  });
});
