import { describe, expect, it } from "vitest";
import {
  createAgent,
  en,
  foldForMatch,
  interpret,
  memoryStore,
  menu,
  say,
  silentLogger,
  ussdChannel,
  type Turn,
} from "../src/index.js";

const t = (key: string) => (en as Record<string, string>)[key] ?? key;
const read = (turn: Turn, typed: string, kind: "ussd" | "sms" = "sms") => interpret(turn, typed, { kind, t, page: 0, pages: 1 });
const choose = (...labels: string[]): Turn => ({ kind: "choose", question: "Pick", options: labels.map((label) => ({ label })) });

describe("foldForMatch", () => {
  it("drops accents, case, extra spaces and apostrophe style", () => {
    expect(foldForMatch("  Français ")).toBe("francais");
    expect(foldForMatch("JËF   ñaari")).toBe("jef naari");
    expect(foldForMatch("Ina’a")).toBe(foldForMatch("ina'a"));
    expect(foldForMatch("ʼya")).toBe("'ya");
  });

  it("keeps letters that are not accented forms", () => {
    expect(foldForMatch("ŋ")).toBe("ŋ");
    expect(foldForMatch("ɗan")).toBe("ɗan");
  });
});

describe("typed answers to a menu", () => {
  const languages = choose("Français", "Wolof");

  it("accepts a language name typed without its accent: the bug", () => {
    for (const typed of ["francais", "FRANCAIS", "Francais ", "  français  ", "Français"]) {
      expect(read(languages, typed), typed).toEqual({ type: "option", index: 0 });
    }
  });

  it("accepts what a USSD screen showed for letters USSD rewrites", () => {
    // USSD shows Ɗan as "Dan" and Ŋaam as "Ngaam": both must be typeable back.
    const hausa = choose("Ɗan", "Ƙasa");
    expect(read(hausa, "dan", "ussd")).toEqual({ type: "option", index: 0 });
    expect(read(hausa, "kasa", "ussd")).toEqual({ type: "option", index: 1 });
    expect(read(hausa, "ɗan")).toEqual({ type: "option", index: 0 });
    const wolof = choose("Ŋaam", "Jëf");
    expect(read(wolof, "ngaam")).toEqual({ type: "option", index: 0 });
    expect(read(wolof, "ŋaam")).toEqual({ type: "option", index: 0 });
    expect(read(wolof, "jef")).toEqual({ type: "option", index: 1 });
  });

  it("matches across apostrophe styles", () => {
    expect(read(choose("Ina'a", "Other"), "ina’a")).toEqual({ type: "option", index: 0 });
  });

  it("prefers an exact match when folding would make two labels equal", () => {
    const close = choose("Côte", "Cote");
    expect(read(close, "cote")).toEqual({ type: "option", index: 1 });
    expect(read(close, "côte")).toEqual({ type: "option", index: 0 });
  });

  it("refuses a folded match that fits more than one label", () => {
    expect(read(choose("Côte", "Côté"), "cote")).toEqual({ type: "invalid", reason: "common.invalidChoice" });
  });

  it("still refuses what matches nothing, and an empty answer", () => {
    expect(read(languages, "fransais")).toEqual({ type: "invalid", reason: "common.invalidChoice" });
    expect(read(languages, "   ")).toEqual({ type: "invalid", reason: "common.invalidChoice" });
  });

  it("still takes numbers first", () => {
    expect(read(languages, "2")).toEqual({ type: "option", index: 1 });
  });
});

describe("typed answers to yes/no", () => {
  const custom: Turn = { kind: "confirm", question: "Continue?", yes: "Ëe", no: "A'a" };

  it("folds the yes and no words too", () => {
    expect(read(custom, "ee")).toEqual({ type: "yes" });
    expect(read(custom, "a’a")).toEqual({ type: "no" });
    expect(read(custom, "YES")).toEqual({ type: "yes" }); // the built-in word still works
  });
});

describe("end to end on USSD", () => {
  it("a user typing the language name the screen showed gets that language", async () => {
    const sessions = memoryStore();
    const agent = createAgent({
      start: menu({ en: "Clinic", fr: "Clinique" }, { Hours: say("8 to 18") }),
      channels: [ussdChannel()],
      logger: silentLogger,
      sessionStore: sessions,
      languages: { supported: [{ code: "en", name: "English" }, { code: "fr", name: "Français" }] },
    });
    const phone = "+221771234567";
    const shown = await agent.handle({ channel: "ussd", phone, input: "", newSession: true });
    expect(shown.text).toContain("Francais"); // what the screen shows
    expect((await agent.handle({ channel: "ussd", phone, input: "francais" })).text).toBe("Clinique\n1. Hours");
    expect((await sessions.load(phone))?.locale).toBe("fr");
  });
});
