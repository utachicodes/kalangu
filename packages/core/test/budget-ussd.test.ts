import { describe, expect, it } from "vitest";
import { BudgetError, optionNumbers, paginateMenu, paginateText, toUssdSafe } from "../src/index.js";

describe("toUssdSafe", () => {
  it("leaves printable ASCII and newlines alone", () => {
    const text = "1. Opening hours\n2. Ask a nurse ~ [ok] {x} | ^";
    expect(toUssdSafe(text)).toEqual({ text, removed: [], changed: false });
  });

  it("strips accents", () => {
    expect(toUssdSafe("Réservé à Thiès, ça marche").text).toBe("Reserve a Thies, ca marche");
  });

  it("transliterates West African letters and typography", () => {
    expect(toUssdSafe("ɲaari ŋoon ɓaɗa ƙasa ƴan").text).toBe("nyaari ngoon bada kasa yan");
    expect(toUssdSafe("C’est « bon » – 5 € …").text).toBe(`C'est " bon " - 5 EUR ...`);
    expect(toUssdSafe("cœur").text).toBe("coeur");
  });

  it("removes characters with no safe form and reports them", () => {
    const out = toUssdSafe("Hi 😀 مرحبا 😀");
    expect(out.text).toBe("Hi   ");
    expect(out.removed).toEqual(["😀", "م", "ر", "ح", "ب", "ا"]);
    expect(out.changed).toBe(true);
  });

  it("throws in strict mode", () => {
    expect(() => toUssdSafe("Hi 😀", "throw")).toThrow(BudgetError);
    // Transliteration still applies in strict mode; only unmappable characters throw.
    expect(toUssdSafe("é", "throw").text).toBe("e");
  });

  it("normalizes CRLF and tabs", () => {
    expect(toUssdSafe("a\r\nb\rc\td").text).toBe("a\nb\nc d");
  });
});

describe("optionNumbers", () => {
  it("counts from 1", () => {
    expect(optionNumbers(3)).toEqual(["1", "2", "3"]);
  });

  it("skips reserved codes", () => {
    const numbers = optionNumbers(100);
    expect(numbers).not.toContain("98");
    expect(numbers.at(-1)).toBe("101");
    expect(new Set(numbers).size).toBe(100);
  });

  it("takes custom reserved codes", () => {
    expect(optionNumbers(3, ["2"])).toEqual(["1", "3", "4"]);
  });
});

describe("paginateText", () => {
  const more = "98. More";

  it("returns short text as one screen", () => {
    expect(paginateText("hello", 160, more)).toEqual(["hello"]);
    expect(paginateText("a".repeat(160), 160, more)).toEqual(["a".repeat(160)]);
  });

  it("splits long text at word boundaries, each screen within the limit", () => {
    const text = Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ");
    const pages = paginateText(text, 160, more);
    expect(pages.length).toBeGreaterThan(1);
    for (const page of pages) expect(page.length).toBeLessThanOrEqual(160);
    for (const page of pages.slice(0, -1)) expect(page.endsWith(`\n${more}`)).toBe(true);
    expect(pages.at(-1)?.endsWith(more)).toBe(false);
    const rebuilt = pages.map((p) => p.replace(`\n${more}`, "")).join(" ");
    expect(rebuilt).toBe(text);
  });

  it("cuts mid-word only when one word is longer than a screen", () => {
    const pages = paginateText("x".repeat(400), 160, more);
    for (const page of pages) expect(page.length).toBeLessThanOrEqual(160);
    expect(pages.map((p) => p.replace(`\n${more}`, "")).join("")).toBe("x".repeat(400));
  });

  it("refuses a screen too small for the More line", () => {
    expect(() => paginateText("a long text", 5, more)).toThrow(BudgetError);
  });
});

describe("paginateMenu", () => {
  const more = "98. More";
  const items = (n: number, label = "Option") => optionNumbers(n).map((num) => `${num}. ${label} ${num}`);

  it("puts a short menu on one screen", () => {
    expect(paginateMenu({ head: ["Clinic line"], items: items(3), maxChars: 160, moreLine: more })).toEqual([
      "Clinic line\n1. Option 1\n2. Option 2\n3. Option 3",
    ]);
  });

  it("spreads a long menu across screens without splitting options", () => {
    const all = items(30, "A fairly long option label");
    const pages = paginateMenu({ head: ["Pick a service"], items: all, maxChars: 160, moreLine: more });
    expect(pages.length).toBeGreaterThan(1);
    expect(pages[0]?.startsWith("Pick a service\n1. ")).toBe(true);
    for (const page of pages) expect(page.length).toBeLessThanOrEqual(160);
    for (const page of pages.slice(0, -1)) expect(page.endsWith(`\n${more}`)).toBe(true);
    const shown = pages.flatMap((p) => p.split("\n")).filter((l) => l !== more && l !== "Pick a service");
    expect(shown).toEqual(all);
  });

  it("does not add More when the remaining options fit exactly", () => {
    const pages = paginateMenu({ head: [], items: ["a".repeat(79), "b".repeat(80)], maxChars: 160, moreLine: more });
    expect(pages).toEqual(["a".repeat(79) + "\n" + "b".repeat(80)]);
  });

  it("refuses an option longer than a screen", () => {
    expect(() =>
      paginateMenu({ head: [], items: ["1. ok", "2. " + "x".repeat(200)], maxChars: 160, moreLine: more }),
    ).toThrow(BudgetError);
  });

  it("refuses a question too long to share a screen with any option", () => {
    expect(() =>
      paginateMenu({ head: ["q".repeat(150)], items: items(20), maxChars: 160, moreLine: more }),
    ).toThrow(/question and first option/);
  });

  it("returns a screen with just the head when there are no items", () => {
    expect(paginateMenu({ head: ["Hello"], items: [], maxChars: 160, moreLine: more })).toEqual(["Hello"]);
  });
});
