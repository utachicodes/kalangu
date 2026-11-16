import { describe, expect, it } from "vitest";
import {
  RENDERABLE_TURN_KINDS,
  TURN_KINDS,
  TurnError,
  assertNever,
  isTurn,
  optionValue,
  parseTurn,
  type Turn,
  type TurnKind,
} from "../src/index.js";

describe("parseTurn: valid turns", () => {
  const valid: Turn[] = [
    { kind: "say", text: "Your visit is booked." },
    { kind: "say", text: "Rendez-vous confirmé à 10 h." },
    { kind: "choose", options: [{ label: "Book" }, { label: "Cancel" }] },
    {
      kind: "choose",
      question: "What do you need?",
      options: [{ label: "Book a visit", value: "book" }, { label: "Ask a nurse", value: "ask" }],
    },
    { kind: "ask", question: "Your age?", input: "number" },
    { kind: "ask", question: "Describe your symptoms", input: "text" },
    { kind: "confirm", question: "Book for Monday?" },
    { kind: "confirm", question: "Réserver lundi ?", yes: "Oui", no: "Non" },
    { kind: "pay", amount: 500, currency: "KES" },
    { kind: "pay", amount: 2500.5, currency: "XOF", reason: "Consultation" },
  ];

  it.each(valid.map((t) => [t.kind, t] as const))("accepts %s", (_kind, turn) => {
    expect(parseTurn(turn)).toEqual(turn);
    expect(isTurn(turn)).toBe(true);
  });

  it("returns a fresh object, not the input", () => {
    const input = { kind: "choose", options: [{ label: "A" }] };
    const out = parseTurn(input);
    expect(out).not.toBe(input);
    if (out.kind !== "choose") throw new Error("expected choose");
    expect(out.options[0]).not.toBe(input.options[0]);
  });

  it("parses turns that went through JSON", () => {
    const turn: Turn = { kind: "confirm", question: "Sure?", yes: "Ndax", no: "Déedéet" };
    expect(parseTurn(JSON.parse(JSON.stringify(turn)))).toEqual(turn);
  });
});

describe("parseTurn: rejects bad input with a path", () => {
  const cases: Array<[string, unknown, string]> = [
    ["null", null, ""],
    ["a string", "hello", ""],
    ["an array", [], ""],
    ["missing kind", { text: "hi" }, "kind"],
    ["unknown kind", { kind: "shout", text: "hi" }, "kind"],
    ["say without text", { kind: "say" }, "text"],
    ["say with empty text", { kind: "say", text: "   " }, "text"],
    ["say with a number", { kind: "say", text: 42 }, "text"],
    ["typo'd field", { kind: "choose", optons: [{ label: "A" }] }, "optons"],
    ["choose without options", { kind: "choose", question: "Pick" }, "options"],
    ["choose with no options", { kind: "choose", options: [] }, "options"],
    ["choose with a non-object option", { kind: "choose", options: ["A"] }, "options[0]"],
    ["choose with an empty label", { kind: "choose", options: [{ label: "A" }, { label: "" }] }, "options[1].label"],
    ["option with an extra field", { kind: "choose", options: [{ label: "A", id: 1 }] }, "options[0].id"],
    ["duplicate labels", { kind: "choose", options: [{ label: "A" }, { label: "A" }] }, "options[1]"],
    [
      "label colliding with another value",
      { kind: "choose", options: [{ label: "Book", value: "x" }, { label: "x" }] },
      "options[1]",
    ],
    ["choose with empty question", { kind: "choose", question: "", options: [{ label: "A" }] }, "question"],
    ["ask with bad input type", { kind: "ask", question: "Age?", input: "date" }, "input"],
    ["ask without input type", { kind: "ask", question: "Age?" }, "input"],
    ["confirm with same yes/no", { kind: "confirm", question: "Sure?", yes: "Ok", no: "ok " }, "no"],
    ["confirm with empty yes", { kind: "confirm", question: "Sure?", yes: "" }, "yes"],
    ["pay with zero", { kind: "pay", amount: 0, currency: "KES" }, "amount"],
    ["pay with negative", { kind: "pay", amount: -5, currency: "KES" }, "amount"],
    ["pay with NaN", { kind: "pay", amount: Number.NaN, currency: "KES" }, "amount"],
    ["pay with Infinity", { kind: "pay", amount: Number.POSITIVE_INFINITY, currency: "KES" }, "amount"],
    ["pay with string amount", { kind: "pay", amount: "500", currency: "KES" }, "amount"],
    ["pay with lowercase currency", { kind: "pay", amount: 5, currency: "kes" }, "currency"],
    ["pay with symbol currency", { kind: "pay", amount: 5, currency: "$" }, "currency"],
  ];

  it.each(cases)("%s", (_name, input, path) => {
    let caught: unknown;
    try {
      parseTurn(input);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(TurnError);
    expect((caught as TurnError).path).toBe(path);
    expect(isTurn(input)).toBe(false);
  });

  it("names the field and the problem in the message", () => {
    expect(() => parseTurn({ kind: "ask", question: "Age?", input: "date" })).toThrow(
      'Invalid turn at input: expected "text" or "number", got "date"',
    );
  });

  it("truncates long strings in messages", () => {
    expect(() => parseTurn({ kind: "x".repeat(100) })).toThrow(/x{40}…"/);
  });
});

describe("helpers", () => {
  it("optionValue falls back to the label", () => {
    expect(optionValue({ label: "Book" })).toBe("Book");
    expect(optionValue({ label: "Book", value: "book" })).toBe("book");
  });

  it("lists every kind once, and pay is not renderable yet", () => {
    expect(new Set(TURN_KINDS).size).toBe(TURN_KINDS.length);
    expect(TURN_KINDS).toContain("pay");
    expect(RENDERABLE_TURN_KINDS).not.toContain("pay");
    expect(RENDERABLE_TURN_KINDS.every((k) => TURN_KINDS.includes(k))).toBe(true);
  });

  it("an exhaustive switch covers every kind", () => {
    // If a variant is added to Turn without a case here, this file stops compiling.
    const label = (kind: TurnKind): string => {
      switch (kind) {
        case "say":
        case "choose":
        case "ask":
        case "confirm":
        case "pay":
          return kind;
        default:
          return assertNever(kind);
      }
    };
    expect(TURN_KINDS.map(label)).toEqual(TURN_KINDS);
  });

  it("assertNever throws at runtime if reached", () => {
    expect(() => assertNever("shout" as never)).toThrow(TypeError);
  });
});
