/**
 * USSD screen budgeting (docs/design.md §5.2).
 *
 * Telcos cannot render special characters on USSD, and when a screen is too
 * long they paginate it themselves with reserved `98`/`00` codes. We keep
 * every screen within the limit so that never happens, restrict text to a
 * safe character set, and number options around the reserved codes.
 */

import { BudgetError } from "./errors.js";

export interface UssdBudget {
  /** Characters per screen. Safaricom KE and Nigeria: 160; Airtel KE: 184. */
  maxChars: number;
  /** The number the user presses for the next page. */
  more: string;
  /** Option numbers never used for our own options. */
  reserved: readonly string[];
  /** What to do with characters outside the safe set. */
  unsafeChars: "strip" | "throw";
}

export const DEFAULT_USSD_BUDGET: UssdBudget = {
  maxChars: 160,
  more: "98",
  reserved: ["98", "00"],
  unsafeChars: "strip",
};

// Letters that Unicode normalization does not reduce to ASCII, including
// those used in Wolof, Hausa and other West African orthographies.
const TRANSLITERATE: Record<string, string> = {
  "œ": "oe", "Œ": "OE", "æ": "ae", "Æ": "AE", "ß": "ss",
  "ø": "o", "Ø": "O", "đ": "d", "Đ": "D", "ł": "l", "Ł": "L", "ı": "i",
  "ŋ": "ng", "Ŋ": "Ng", "ɲ": "ny", "Ɲ": "Ny",
  "ɓ": "b", "Ɓ": "B", "ɗ": "d", "Ɗ": "D", "ƙ": "k", "Ƙ": "K", "ƴ": "y", "Ƴ": "Y",
  "ɛ": "e", "Ɛ": "E", "ɔ": "o", "Ɔ": "O",
  "‘": "'", "’": "'", "ʼ": "'", "‛": "'", "“": '"', "”": '"', "„": '"', "«": '"', "»": '"',
  "–": "-", "—": "-", "‐": "-", "−": "-", "•": "-", "·": ".", "…": "...", "×": "x",
  "€": "EUR", "£": "GBP", " ": " ", " ": " ", "\t": " ",
};

export interface SafeText {
  text: string;
  /** Characters that had no safe form and were removed, in order of first appearance. */
  removed: string[];
  /** True when anything was transliterated or removed. */
  changed: boolean;
}

/**
 * Restricts text to printable ASCII plus newline. Accented letters lose their
 * accents (é → e), known letters are transliterated (ŋ → ng), and anything
 * else is removed, or throws in strict mode.
 */
export function toUssdSafe(text: string, mode: UssdBudget["unsafeChars"] = "strip"): SafeText {
  const removed: string[] = [];
  let out = "";
  for (const ch of text.replace(/\r\n?/g, "\n")) {
    if (isSafe(ch)) {
      out += ch;
      continue;
    }
    const mapped = TRANSLITERATE[ch] ?? stripMarks(ch);
    if (mapped !== null) {
      out += mapped;
      continue;
    }
    if (mode === "throw") {
      throw new BudgetError("unsafe_char", `Character ${JSON.stringify(ch)} cannot be shown on USSD`);
    }
    if (!removed.includes(ch)) removed.push(ch);
  }
  return { text: out, removed, changed: out !== text };
}

function isSafe(ch: string): boolean {
  if (ch === "\n") return true;
  const code = ch.codePointAt(0) ?? 0;
  return code >= 0x20 && code <= 0x7e;
}

function stripMarks(ch: string): string | null {
  const base = ch.normalize("NFD").replace(/\p{M}/gu, "");
  return base !== "" && [...base].every(isSafe) ? base : null;
}

/**
 * Option numbers 1, 2, 3, … skipping reserved codes, so an option can never
 * collide with the telco's or our own navigation.
 */
export function optionNumbers(count: number, reserved: readonly string[] = DEFAULT_USSD_BUDGET.reserved): string[] {
  const numbers: string[] = [];
  for (let n = 1; numbers.length < count; n++) {
    if (!reserved.includes(String(n))) numbers.push(String(n));
  }
  return numbers;
}

/**
 * Splits text into screens of at most `maxChars`. Every screen but the last
 * ends with `moreLine` (e.g. "98. More"). Breaks at whitespace where it can,
 * mid-word only when a single word is longer than a screen.
 */
export function paginateText(text: string, maxChars: number, moreLine: string): string[] {
  if (text.length <= maxChars) return [text];
  const room = maxChars - moreLine.length - 1;
  if (room < 1) {
    throw new BudgetError("line_too_long", `A ${maxChars}-character screen has no room beside ${JSON.stringify(moreLine)}`);
  }

  const pages: string[] = [];
  let rest = text;
  while (rest.length > maxChars) {
    let cut = lastBreak(rest, room);
    if (cut <= 0) cut = room;
    pages.push(`${rest.slice(0, cut).trimEnd()}\n${moreLine}`);
    rest = rest.slice(cut).replace(/^[ \n]+/, "");
  }
  pages.push(rest);
  return pages;
}

function lastBreak(text: string, room: number): number {
  // The break may sit exactly at `room` (the character after the fitted part).
  for (let i = Math.min(room, text.length - 1); i > 0; i--) {
    const ch = text[i];
    if (ch === " " || ch === "\n") return i;
  }
  return -1;
}

export interface MenuLayout {
  /** Lines shown on the first page only (notice, question). */
  head: readonly string[];
  /** Lines that must not be split or separated from their number. */
  items: readonly string[];
  maxChars: number;
  moreLine: string;
}

/**
 * Lays out a menu across screens. The head goes on the first page, items fill
 * pages in order, and every page but the last ends with `moreLine`.
 *
 * @throws BudgetError("line_too_long") when an item cannot fit on a page.
 */
export function paginateMenu({ head, items, maxChars, moreLine }: MenuLayout): string[] {
  const pages: string[] = [];
  let lines = [...head];
  let i = 0;

  while (i < items.length) {
    const fitsAll = size([...lines, ...items.slice(i)]) <= maxChars;
    if (fitsAll) {
      lines.push(...items.slice(i));
      i = items.length;
      break;
    }
    const start = i;
    while (i < items.length && size([...lines, items[i] as string, moreLine]) <= maxChars) {
      lines.push(items[i] as string);
      i++;
    }
    if (i === start) {
      const what = lines.length > 0 && pages.length === 0 ? "The question and first option" : "A menu option";
      throw new BudgetError(
        "line_too_long",
        `${what} do not fit on a ${maxChars}-character USSD screen: ${JSON.stringify(items[i])}`,
      );
    }
    lines.push(moreLine);
    pages.push(lines.join("\n"));
    lines = [];
  }

  if (lines.length > 0 || pages.length === 0) {
    const page = lines.join("\n");
    if (page.length > maxChars) {
      throw new BudgetError("line_too_long", `Screen is ${page.length} characters; the limit is ${maxChars}`);
    }
    pages.push(page);
  }
  return pages;
}

function size(lines: readonly string[]): number {
  return lines.join("\n").length;
}
