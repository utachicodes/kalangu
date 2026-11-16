/**
 * SMS length, by encoding (docs/design.md §5.3).
 *
 * A message is GSM-7 when every character is in the GSM 03.38 basic alphabet
 * or its extension table; extension characters take two septets. One
 * character outside GSM-7 makes the whole message UCS-2, which holds far
 * less. Concatenated messages lose room per segment to the UDH header.
 */

import { BudgetError } from "./errors.js";

// GSM 03.38 basic alphabet, without the escape character (0x1B).
const GSM7_BASIC = new Set(
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?" +
    "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà",
);

// GSM 03.38 extension table: each costs an escape septet plus itself.
const GSM7_EXTENSION = new Set("^{}\\[]~|€\f");

export type SmsEncoding = "gsm7" | "ucs2";

export const SMS_LIMITS = {
  gsm7: { single: 160, concatenated: 153 },
  ucs2: { single: 70, concatenated: 67 },
} as const;

export type GsmClass = "basic" | "extension" | "none";

/** Which part of GSM-7 a single character (code point) belongs to. */
export function gsmClass(char: string): GsmClass {
  if (GSM7_BASIC.has(char)) return "basic";
  if (GSM7_EXTENSION.has(char)) return "extension";
  return "none";
}

export interface SmsLength {
  encoding: SmsEncoding;
  /** Septets for GSM-7, UTF-16 code units for UCS-2. */
  units: number;
  segments: number;
  /** 160/70 for a single segment, 153/67 once concatenated. */
  charsPerSegment: number;
  /** Characters that forced UCS-2, in order of first appearance. */
  nonGsmChars: string[];
}

export function smsEncoding(text: string): SmsEncoding {
  for (const ch of text) if (gsmClass(ch) === "none") return "ucs2";
  return "gsm7";
}

export function smsLength(text: string): SmsLength {
  const nonGsm: string[] = [];
  for (const ch of text) {
    if (gsmClass(ch) === "none" && !nonGsm.includes(ch)) nonGsm.push(ch);
  }
  const encoding: SmsEncoding = nonGsm.length > 0 ? "ucs2" : "gsm7";
  const units = unitsOf(text, encoding);
  const limits = SMS_LIMITS[encoding];
  const segments = units <= limits.single ? 1 : splitSegments(text, encoding).length;
  return {
    encoding,
    units,
    segments,
    charsPerSegment: segments === 1 ? limits.single : limits.concatenated,
    nonGsmChars: nonGsm,
  };
}

/**
 * Splits text the way a concatenated SMS is split: never across a GSM-7
 * escape pair or a UTF-16 surrogate pair, so the count is exact rather than
 * `ceil(units / 153)`, which can undercount by one.
 */
export function splitSegments(text: string, encoding: SmsEncoding = smsEncoding(text)): string[] {
  const limits = SMS_LIMITS[encoding];
  if (unitsOf(text, encoding) <= limits.single) return [text];

  const segments: string[] = [];
  let current = "";
  let used = 0;
  for (const ch of text) {
    const cost = charUnits(ch, encoding);
    if (used + cost > limits.concatenated) {
      segments.push(current);
      current = "";
      used = 0;
    }
    current += ch;
    used += cost;
  }
  if (current) segments.push(current);
  return segments;
}

export interface SmsBudget {
  /** Cap on segments for one outbound message. Default 4. */
  maxSegments?: number;
}

export const DEFAULT_SMS_MAX_SEGMENTS = 4;

/**
 * Checks a message against the segment cap. Returns its length when it fits;
 * throws `BudgetError("sms_too_long")` otherwise. Never truncates.
 */
export function budgetSms(text: string, budget: SmsBudget = {}): SmsLength {
  const max = budget.maxSegments ?? DEFAULT_SMS_MAX_SEGMENTS;
  if (!Number.isInteger(max) || max < 1) {
    throw new RangeError(`maxSegments must be a positive integer, got ${max}`);
  }
  const length = smsLength(text);
  if (length.segments > max) {
    const why =
      length.encoding === "ucs2"
        ? ` It is UCS-2 because of ${length.nonGsmChars.map((c) => JSON.stringify(c)).join(", ")}.`
        : "";
    throw new BudgetError(
      "sms_too_long",
      `SMS needs ${length.segments} segments (${length.units} ${length.encoding} units); the cap is ${max}.${why}`,
    );
  }
  return length;
}

function unitsOf(text: string, encoding: SmsEncoding): number {
  if (encoding === "ucs2") return text.length;
  let n = 0;
  for (const ch of text) n += charUnits(ch, encoding);
  return n;
}

function charUnits(ch: string, encoding: SmsEncoding): number {
  if (encoding === "ucs2") return ch.length; // 2 for astral characters (emoji)
  return gsmClass(ch) === "extension" ? 2 : 1;
}
