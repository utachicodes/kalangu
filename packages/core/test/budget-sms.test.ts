import { describe, expect, it } from "vitest";
import { BudgetError, budgetSms, gsmClass, smsEncoding, smsLength, splitSegments } from "../src/index.js";

describe("gsmClass", () => {
  it.each(["a", "Z", "0", " ", "\n", "@", "£", "é", "è", "à", "ù", "Ç", "ñ", "ß", "Δ"])("%j is basic", (ch) => {
    expect(gsmClass(ch)).toBe("basic");
  });

  it.each(["^", "{", "}", "\\", "[", "]", "~", "|", "€"])("%j is in the extension table", (ch) => {
    expect(gsmClass(ch)).toBe("extension");
  });

  // French letters outside GSM-7 (lowercase ç is not in the table; only Ç is),
  // Wolof ɲ/ŋ, Hausa ɓ/ɗ/ƙ, Arabic, Devanagari, emoji.
  it.each(["ç", "ê", "â", "î", "ô", "û", "ë", "ï", "œ", "Œ", "ŷ", "ɲ", "ŋ", "ɓ", "ɗ", "ƙ", "ع", "क", "😀", "’"])(
    "%j forces UCS-2",
    (ch) => {
      expect(gsmClass(ch)).toBe("none");
    },
  );
});

describe("smsLength", () => {
  it("counts plain text as GSM-7, one segment up to 160", () => {
    expect(smsLength("a".repeat(160))).toEqual({
      encoding: "gsm7",
      units: 160,
      segments: 1,
      charsPerSegment: 160,
      nonGsmChars: [],
    });
  });

  it("uses 153 per segment once concatenated", () => {
    expect(smsLength("a".repeat(161))).toMatchObject({ segments: 2, charsPerSegment: 153 });
    expect(smsLength("a".repeat(306))).toMatchObject({ segments: 2 });
    expect(smsLength("a".repeat(307))).toMatchObject({ segments: 3 });
  });

  it("counts extension characters twice", () => {
    expect(smsLength("€".repeat(80))).toMatchObject({ encoding: "gsm7", units: 160, segments: 1 });
    expect(smsLength("€".repeat(80) + "a")).toMatchObject({ units: 161, segments: 2 });
  });

  it("keeps French é/à in GSM-7", () => {
    expect(smsEncoding("Votre rendez-vous est confirmé à 10 h.")).toBe("gsm7");
  });

  it("switches the whole message to UCS-2 for one character", () => {
    const text = "a".repeat(69) + "ç";
    expect(smsLength(text)).toEqual({
      encoding: "ucs2",
      units: 70,
      segments: 1,
      charsPerSegment: 70,
      nonGsmChars: ["ç"],
    });
    expect(smsLength(text + "a")).toMatchObject({ segments: 2, charsPerSegment: 67 });
  });

  it("uses 67 per segment for concatenated UCS-2", () => {
    expect(smsLength("ŋ".repeat(134))).toMatchObject({ segments: 2 });
    expect(smsLength("ŋ".repeat(135))).toMatchObject({ segments: 3 });
  });

  it("counts emoji as two UTF-16 units", () => {
    expect(smsLength("😀".repeat(35))).toMatchObject({ encoding: "ucs2", units: 70, segments: 1 });
  });

  it("lists each character that forced UCS-2 once", () => {
    expect(smsLength("ɓaɗaɓa").nonGsmChars).toEqual(["ɓ", "ɗ"]);
  });

  it("treats an empty message as one segment", () => {
    expect(smsLength("")).toMatchObject({ encoding: "gsm7", units: 0, segments: 1 });
  });
});

describe("splitSegments", () => {
  it("never splits a GSM-7 escape pair, which can add a segment", () => {
    // 152 plain septets then '€' (2 septets) would straddle the 153 boundary.
    const text = "a".repeat(152) + "€" + "a".repeat(10);
    const segments = splitSegments(text);
    expect(segments[0]).toBe("a".repeat(152));
    expect(segments[1]?.startsWith("€")).toBe(true);
    expect(segments.join("")).toBe(text);
  });

  it("never splits a surrogate pair", () => {
    const text = "ŋ".repeat(66) + "😀" + "ŋ".repeat(10);
    const segments = splitSegments(text);
    expect(segments[0]).toBe("ŋ".repeat(66));
    expect(segments[1]?.startsWith("😀")).toBe(true);
    expect(segments.join("")).toBe(text);
  });

  it("returns the text whole when it fits one segment", () => {
    expect(splitSegments("hello")).toEqual(["hello"]);
  });

  it("is what smsLength counts", () => {
    const text = "a".repeat(152) + "€" + "a".repeat(152) + "€";
    expect(smsLength(text).segments).toBe(splitSegments(text).length);
  });
});

describe("budgetSms", () => {
  it("accepts up to 4 segments by default", () => {
    expect(budgetSms("a".repeat(153 * 4)).segments).toBe(4);
  });

  it("refuses more than the cap instead of truncating", () => {
    const err = catchError(() => budgetSms("a".repeat(153 * 4 + 1)));
    expect(err).toBeInstanceOf(BudgetError);
    expect((err as BudgetError).code).toBe("sms_too_long");
    expect((err as BudgetError).message).toContain("5 segments");
  });

  it("says which characters made the message UCS-2", () => {
    expect(() => budgetSms("ç".repeat(70), { maxSegments: 1 })).not.toThrow();
    expect(() => budgetSms("ç" + "a".repeat(70), { maxSegments: 1 })).toThrow(/because of "ç"/);
  });

  it("takes a custom cap and rejects nonsense caps", () => {
    expect(() => budgetSms("a".repeat(161), { maxSegments: 1 })).toThrow(BudgetError);
    expect(() => budgetSms("a", { maxSegments: 0 })).toThrow(RangeError);
    expect(() => budgetSms("a", { maxSegments: 1.5 })).toThrow(RangeError);
  });
});

function catchError(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error("expected an error");
}
