import { describe, expect, it } from "vitest";
import {
  NotSupportedError,
  createCatalog,
  interpret,
  maskPhone,
  renderSms,
  renderUssd,
  type Turn,
} from "../src/index.js";

const t = createCatalog().translator("en");
const ctx = { t, page: 0 };

describe("renderUssd", () => {
  it("renders every v0.1 turn kind", () => {
    expect(renderUssd({ kind: "say", text: "Bye" }, ctx)).toMatchObject({ text: "Bye", end: true, pages: 1 });
    expect(renderUssd({ kind: "ask", question: "Age?", input: "number" }, ctx)).toMatchObject({
      text: "Age?",
      end: false,
    });
    expect(renderUssd({ kind: "choose", options: [{ label: "A" }, { label: "B" }] }, ctx).text).toBe("1. A\n2. B");
    expect(renderUssd({ kind: "confirm", question: "Sure?", yes: "Ndax", no: "Déedéet" }, ctx).text).toBe(
      "Sure?\n1. Ndax\n2. Deedeet",
    );
  });

  it("refuses pay until 0.2", () => {
    expect(() => renderUssd({ kind: "pay", amount: "5", currency: "KES" }, ctx)).toThrow(NotSupportedError);
    expect(() => renderSms({ kind: "pay", amount: "5", currency: "KES" }, ctx)).toThrow(NotSupportedError);
  });

  it("warns about removed characters", () => {
    expect(renderUssd({ kind: "say", text: "Hi 😀" }, ctx).warnings).toEqual([
      'Removed characters USSD cannot show: "😀"',
    ]);
  });

  it("respects a custom screen size", () => {
    const out = renderUssd({ kind: "say", text: "word ".repeat(20).trim() }, ctx, {
      maxChars: 40,
      more: "98",
      reserved: ["98", "00"],
      unsafeChars: "strip",
    });
    expect(out.pages).toBeGreaterThan(1);
    expect(out.text.length).toBeLessThanOrEqual(40);
  });

  it("clamps the page", () => {
    expect(renderUssd({ kind: "say", text: "Bye" }, { t, page: 5 }).page).toBe(0);
  });
});

describe("renderSms", () => {
  it("renders every v0.1 turn kind", () => {
    expect(renderSms({ kind: "say", text: "Bye" }, ctx)).toMatchObject({ text: "Bye", end: true });
    expect(renderSms({ kind: "choose", question: "Pick", options: [{ label: "A" }] }, ctx).text).toBe("Pick\n1. A");
    expect(renderSms({ kind: "confirm", question: "Sure?" }, ctx).text).toBe("Sure?\nReply YES or NO");
    expect(renderSms({ kind: "ask", question: "Name?", input: "text" }, { t, page: 0, notice: "Oops" }).text).toBe(
      "Oops\nName?",
    );
  });
});

describe("interpret", () => {
  const menuTurn: Turn = { kind: "choose", options: [{ label: "Hours" }, { label: "Nurse" }] };
  const ussd = { kind: "ussd" as const, t, page: 0, pages: 1 };

  it("reads option numbers and labels", () => {
    expect(interpret(menuTurn, " 2 ", ussd)).toEqual({ type: "option", index: 1 });
    expect(interpret(menuTurn, "nurse", { ...ussd, kind: "sms" })).toEqual({ type: "option", index: 1 });
    expect(interpret(menuTurn, "3", ussd)).toEqual({ type: "invalid", reason: "common.invalidChoice" });
  });

  it("treats 98 as More only when there is a next page", () => {
    expect(interpret(menuTurn, "98", { ...ussd, pages: 2 })).toEqual({ type: "more" });
    expect(interpret(menuTurn, "98", { ...ussd, pages: 2, page: 1 })).toMatchObject({ type: "invalid" });
    expect(interpret(menuTurn, "98", { ...ussd, kind: "sms", pages: 2 })).toMatchObject({ type: "invalid" });
  });

  it("lets a paginated question's last page take 98 as an answer", () => {
    const q: Turn = { kind: "ask", question: "Code?", input: "number" };
    expect(interpret(q, "98", { ...ussd, pages: 2, page: 1 })).toEqual({ type: "answer", value: "98" });
  });

  it("reads yes/no by number, label and locale word", () => {
    const c: Turn = { kind: "confirm", question: "Sure?", yes: "Waaw", no: "Déedéet" };
    expect(interpret(c, "1", ussd)).toEqual({ type: "yes" });
    expect(interpret(c, "WAAW", ussd)).toEqual({ type: "yes" });
    expect(interpret(c, "yes", ussd)).toEqual({ type: "yes" });
    expect(interpret(c, "déedéet", ussd)).toEqual({ type: "no" });
    expect(interpret(c, "maybe", ussd)).toMatchObject({ type: "invalid" });
  });

  it("accepts decimal numbers with a dot or comma", () => {
    const q: Turn = { kind: "ask", question: "Weight?", input: "number" };
    expect(interpret(q, "3,5", ussd)).toEqual({ type: "answer", value: "3,5" });
    expect(interpret(q, "-3", ussd)).toMatchObject({ type: "invalid", reason: "common.invalidNumber" });
  });
});

describe("maskPhone", () => {
  it("keeps the country prefix and last four digits", () => {
    expect(maskPhone("+254700001001")).toBe("+254•••••1001");
    expect(maskPhone("0700001001")).toBe("070•••1001");
    expect(maskPhone("12345")).toBe("•••45");
  });
});
