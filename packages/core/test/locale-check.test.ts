import { describe, expect, it } from "vitest";
import { checkLocale, formatReport, en, fr } from "../src/index.js";

const reference = {
  "common.yes": "Yes",
  "common.no": "No",
  "common.replyYesNo": "Reply {yes} or {no}",
  "payments.receipt": "Paid {amount} {currency} to {payee}",
} as const;

const codes = (messages: Record<string, unknown>, options = {}) =>
  checkLocale("xx", messages, { reference, ...options }).issues.map((i) => `${i.severity}:${i.code}:${i.key}`);

describe("checkLocale", () => {
  it("accepts a complete, faithful translation", () => {
    const report = checkLocale("xx", {
      "common.yes": "Oui-xx", "common.no": "Non-xx", "common.replyYesNo": "R {yes} {no}", "payments.receipt": "{amount} {currency} {payee}",
    }, { reference });
    expect(report).toMatchObject({ errors: 0, warnings: 0, checked: 4, expected: 4 });
  });

  it("warns about a missing key for a partial locale, and errors when complete is required", () => {
    expect(codes({ "common.yes": "a" })).toContain("warning:missing-key:common.no");
    expect(codes({ "common.yes": "a" }, { complete: true })).toContain("error:missing-key:common.no");
  });

  it("errors on a key Kalangu does not use", () => {
    expect(codes({ "common.yess": "a" })).toContain("error:unknown-key:common.yess");
  });

  it("errors on empty and non-string values", () => {
    expect(codes({ "common.yes": "   ", "common.no": 5 })).toEqual(
      expect.arrayContaining(["error:empty:common.yes", "error:not-a-string:common.no"]),
    );
  });

  it("warns about a string left identical to the English, but not for English itself", () => {
    expect(codes({ "common.yes": "Yes" })).toContain("warning:unchanged:common.yes");
    const english = checkLocale("en", { "common.yes": "Yes" }, { reference });
    expect(english.issues.some((i) => i.code === "unchanged")).toBe(false);
  });

  it("errors on a lost placeholder and on an invented one", () => {
    const out = codes({ "common.replyYesNo": "Reply {yes} or {nope}" });
    expect(out).toContain("error:placeholder-missing:common.replyYesNo");
    expect(out).toContain("error:placeholder-extra:common.replyYesNo");
  });

  it("accepts a placeholder used twice or reordered", () => {
    expect(codes({ "common.replyYesNo": "{no} / {yes} / {yes}" }).filter((c) => c.startsWith("error"))).toEqual([]);
  });

  describe("USSD", () => {
    it("lists letters shown differently, as a note rather than a problem", () => {
      const report = checkLocale("xx", { "common.yes": "Ɗa ŋa" }, { reference });
      const note = report.issues.find((i) => i.code === "ussd-altered");
      expect(note?.severity).toBe("info");
      expect(note?.message).toContain("Ɗ → D");
      expect(note?.message).toContain("ŋ → ng");
    });

    it("warns about characters that have no USSD form", () => {
      const issue = checkLocale("xx", { "common.yes": "Yes 😀" }, { reference }).issues.find((i) => i.code === "ussd-removed");
      expect(issue?.severity).toBe("warning");
      expect(issue?.message).toContain("😀");
    });

    it("warns when a string will not fit one screen", () => {
      expect(codes({ "common.yes": "a".repeat(161) })).toContain("warning:ussd-too-long:common.yes");
      expect(codes({ "common.yes": "a".repeat(160) })).not.toContain("warning:ussd-too-long:common.yes");
      expect(codes({ "common.yes": "a".repeat(41) }, { ussdMaxChars: 40 })).toContain("warning:ussd-too-long:common.yes");
    });
  });

  describe("SMS", () => {
    it("warns when one letter pushes a string to UCS-2, and names it", () => {
      const issue = checkLocale("xx", { "common.yes": "abc ë" }, { reference }).issues.find((i) => i.code === "sms-ucs2");
      expect(issue?.severity).toBe("warning");
      expect(issue?.message).toContain("ë");
      expect(issue?.message).toContain("70");
    });

    it("does not warn for GSM-7 text, including letters like é and ñ", () => {
      expect(codes({ "common.yes": "café ñandu à" })).not.toContain("warning:sms-ucs2:common.yes");
    });

    it("warns about a string that takes more than one segment", () => {
      expect(codes({ "common.yes": "a".repeat(161) })).toContain("warning:sms-segments:common.yes");
    });
  });

  it("counts severities", () => {
    const report = checkLocale("xx", { "common.yes": "Ɗ", "common.replyYesNo": "x" }, { reference, complete: true });
    expect(report.errors).toBe(report.issues.filter((i) => i.severity === "error").length);
    expect(report.errors).toBeGreaterThan(0);
    expect(report.infos).toBe(1);
  });
});

describe("formatReport", () => {
  it("hides notes unless verbose, and says how many it hid", () => {
    const report = checkLocale("xx", { "common.yes": "Ɗa" }, { reference });
    expect(formatReport(report)).toContain("1 note (use --verbose)");
    expect(formatReport(report)).not.toContain("Ɗ → D");
    expect(formatReport(report, { verbose: true })).toContain("Ɗ → D");
  });
});

describe("formatReport with a partial translation", () => {
  const partial = checkLocale("xx", { "common.yes": "yes-xx", "common.replyYesNo": "Reply {yes}" }, { reference: en });

  it("shows many untranslated messages as one line, so real errors stay visible", () => {
    const text = formatReport(partial);
    expect(text).toMatch(/\d+ messages not translated yet/);
    expect(text).not.toContain("common.more: missing");
    expect(text).toContain("lost the placeholder {no}");
  });

  it("lists them all with verbose", () => {
    expect(formatReport(partial, { verbose: true })).toContain("common.more: missing");
  });

  it("lists a few individually, and every one when they are errors under --complete", () => {
    const few = checkLocale("xx", { "common.yes": "a", "common.no": "b" }, { reference: { "common.yes": "Y", "common.no": "N", "common.more": "M" } });
    expect(formatReport(few)).toContain("common.more: missing");
    const required = checkLocale("xx", { "common.yes": "yes-xx" }, { reference: en, complete: true });
    expect(formatReport(required)).toContain("common.more: missing");
  });
});

describe("the locales that ship", () => {
  it("English is complete and clean", () => {
    const report = checkLocale("en", en, { complete: true });
    expect(report.issues).toEqual([]);
  });

  it("French is complete, with no errors and no stray warnings", () => {
    const report = checkLocale("fr", fr, { complete: true });
    expect(report.errors).toBe(0);
    // The only warnings are the known cost of ê and ç on SMS: UCS-2 for three payment strings.
    expect(report.issues.filter((i) => i.severity === "warning").map((i) => `${i.code}:${i.key}`).sort()).toEqual([
      "sms-ucs2:payments.paid",
      "sms-ucs2:payments.receipt",
      "sms-ucs2:payments.refused",
    ]);
  });
});
