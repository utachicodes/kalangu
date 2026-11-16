/**
 * Turns: what an agent step returns instead of text.
 *
 * A step never writes straight to a phone. It returns one of these, and a
 * renderer per channel turns it into what that channel can show (a numbered
 * USSD menu, a numbered SMS reply list, and so on). See docs/design.md §4.1.
 */

export interface Option {
  /** What the user sees, e.g. "Book a visit". */
  readonly label: string;
  /** What the handler receives. Defaults to `label` when omitted. */
  readonly value?: string;
}

export interface SayTurn {
  readonly kind: "say";
  readonly text: string;
}

export interface ChooseTurn {
  readonly kind: "choose";
  readonly question?: string;
  readonly options: readonly Option[];
}

export interface AskTurn {
  readonly kind: "ask";
  readonly question: string;
  readonly input: "text" | "number";
}

export interface ConfirmTurn {
  readonly kind: "confirm";
  readonly question: string;
  /** Overrides the localized "Yes" label. */
  readonly yes?: string;
  /** Overrides the localized "No" label. */
  readonly no?: string;
}

/**
 * Reserved for 0.2. Parsed and type-checked now so the union and every
 * exhaustive switch already account for it; no channel renders it yet.
 */
export interface PayTurn {
  readonly kind: "pay";
  readonly amount: number;
  /** ISO 4217 code, e.g. "KES", "XOF". */
  readonly currency: string;
  readonly reason?: string;
}

export type Turn = SayTurn | ChooseTurn | AskTurn | ConfirmTurn | PayTurn;

export type TurnKind = Turn["kind"];

export const TURN_KINDS: readonly TurnKind[] = ["say", "choose", "ask", "confirm", "pay"];

/** Turn kinds that channels can render in v0.1. */
export const RENDERABLE_TURN_KINDS: readonly TurnKind[] = ["say", "choose", "ask", "confirm"];

/**
 * Compile-time guard for exhaustive switches over `Turn["kind"]`.
 * Adding a variant to `Turn` makes every switch that forgot it fail to build.
 */
export function assertNever(value: never, message = "Unhandled turn"): never {
  throw new TypeError(`${message}: ${JSON.stringify(value)}`);
}

/** The value a handler receives for an option. */
export function optionValue(option: Option): string {
  return option.value ?? option.label;
}

export class TurnError extends Error {
  override readonly name = "TurnError";
  /** Where the problem is, e.g. `options[2].label`. Empty for the turn itself. */
  readonly path: string;

  constructor(path: string, problem: string) {
    super(path ? `Invalid turn at ${path}: ${problem}` : `Invalid turn: ${problem}`);
    this.path = path;
  }
}

/**
 * Validates a value that did not come from typed code (a stored session, a
 * model's structured output, JSON from a test fixture) and returns a clean
 * `Turn`. Unknown fields are rejected so typos such as `optons` fail loudly
 * instead of rendering an empty menu.
 *
 * @throws TurnError describing the first problem found.
 */
export function parseTurn(value: unknown): Turn {
  const obj = record(value, "");
  const kind = obj["kind"];

  switch (kind) {
    case "say":
      onlyKeys(obj, ["kind", "text"]);
      return { kind, text: text(obj, "text") };

    case "choose": {
      onlyKeys(obj, ["kind", "question", "options"]);
      const question = optionalText(obj, "question");
      const options = parseOptions(obj["options"]);
      return question === undefined ? { kind, options } : { kind, question, options };
    }

    case "ask": {
      onlyKeys(obj, ["kind", "question", "input"]);
      const input = obj["input"];
      if (input !== "text" && input !== "number") {
        throw new TurnError("input", `expected "text" or "number", got ${describe(input)}`);
      }
      return { kind, question: text(obj, "question"), input };
    }

    case "confirm": {
      onlyKeys(obj, ["kind", "question", "yes", "no"]);
      const turn: { kind: "confirm"; question: string; yes?: string; no?: string } = {
        kind,
        question: text(obj, "question"),
      };
      const yes = optionalText(obj, "yes");
      const no = optionalText(obj, "no");
      if (yes !== undefined) turn.yes = yes;
      if (no !== undefined) turn.no = no;
      if (yes !== undefined && no !== undefined && yes.trim().toLowerCase() === no.trim().toLowerCase()) {
        throw new TurnError("no", "must differ from yes");
      }
      return turn;
    }

    case "pay": {
      onlyKeys(obj, ["kind", "amount", "currency", "reason"]);
      const amount = obj["amount"];
      if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
        throw new TurnError("amount", `expected a positive finite number, got ${describe(amount)}`);
      }
      const currency = obj["currency"];
      if (typeof currency !== "string" || !/^[A-Z]{3}$/.test(currency)) {
        throw new TurnError("currency", `expected an ISO 4217 code such as "KES", got ${describe(currency)}`);
      }
      const reason = optionalText(obj, "reason");
      return reason === undefined ? { kind, amount, currency } : { kind, amount, currency, reason };
    }

    default:
      throw new TurnError("kind", `expected one of ${TURN_KINDS.join(", ")}, got ${describe(kind)}`);
  }
}

/** `parseTurn` without the throw. */
export function isTurn(value: unknown): value is Turn {
  try {
    parseTurn(value);
    return true;
  } catch (err) {
    if (err instanceof TurnError) return false;
    throw err;
  }
}

function parseOptions(value: unknown): Option[] {
  if (!Array.isArray(value)) {
    throw new TurnError("options", `expected an array, got ${describe(value)}`);
  }
  if (value.length === 0) {
    throw new TurnError("options", "must contain at least one option");
  }

  const seen = new Map<string, number>();
  return value.map((item, i) => {
    const path = `options[${i}]`;
    const obj = record(item, path);
    onlyKeys(obj, ["label", "value"], path);
    const label = text(obj, "label", path);
    const value = optionalText(obj, "value", path);
    const option: Option = value === undefined ? { label } : { label, value };

    const effective = optionValue(option);
    const first = seen.get(effective);
    if (first !== undefined) {
      throw new TurnError(path, `has the same value as options[${first}] (${JSON.stringify(effective)})`);
    }
    seen.set(effective, i);
    return option;
  });
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TurnError(path, `expected an object, got ${describe(value)}`);
  }
  return value as Record<string, unknown>;
}

function onlyKeys(obj: Record<string, unknown>, allowed: readonly string[], path = ""): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) {
      throw new TurnError(join(path, key), `unknown field (allowed: ${allowed.join(", ")})`);
    }
  }
}

function text(obj: Record<string, unknown>, key: string, path = ""): string {
  const value = obj[key];
  if (typeof value !== "string") {
    throw new TurnError(join(path, key), `expected a string, got ${describe(value)}`);
  }
  if (value.trim() === "") {
    throw new TurnError(join(path, key), "must not be empty");
  }
  return value;
}

function optionalText(obj: Record<string, unknown>, key: string, path = ""): string | undefined {
  return obj[key] === undefined ? undefined : text(obj, key, path);
}

function join(path: string, key: string): string {
  return path ? `${path}.${key}` : key;
}

function describe(value: unknown): string {
  if (value === undefined) return "nothing";
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  if (typeof value === "string") return JSON.stringify(value.length > 40 ? `${value.slice(0, 40)}…` : value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return `a ${typeof value}`;
}
