// Regression tests for the independent review of #21 to #30 (17 Nov 2026).
import { describe, expect, it } from "vitest";
import {
  ask,
  checkLocale,
  confirm,
  createAgent,
  en,
  interpret,
  languageMenu,
  memoryStore,
  menu,
  say,
  smsChannel,
  ussdChannel,
  type Clock,
  type DetectedLanguage,
  type Language,
  type LanguageDetector,
  type Turn,
} from "../src/index.js";

const PHONE = "+14155550100";
const english: Language = { code: "en", name: "English" };
const french: Language = { code: "fr", name: "Français" };
const quiet = { debug() {}, info() {}, warn() {}, error() {} };
const flush = async () => {
  for (let i = 0; i < 20; i++) await new Promise<void>((r) => setImmediate(r));
};

function timerClock(start = Date.now()) {
  let now = start;
  let id = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const clock: Clock = {
    now: () => now,
    setTimeout(fn, ms) {
      const n = id++;
      timers.set(n, { at: now + ms, fn });
      return n;
    },
    clearTimeout(h) {
      timers.delete(h as number);
    },
  };
  async function advance(ms: number) {
    const end = now + ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      now = due[1].at;
      due[1].fn();
      await flush();
    }
    now = end;
  }
  return { clock, advance };
}

function detector(answer: DetectedLanguage | null) {
  const calls: string[] = [];
  const d: LanguageDetector = {
    async detect(text) {
      calls.push(text);
      return answer;
    },
  };
  return { d, calls };
}

describe("1. a pending language suggestion never answers a later question", () => {
  it("a redial that replays a shortcut to a confirm gets that confirm, not the old suggestion", async () => {
    const sessions = memoryStore();
    const det = detector({ code: "fr", confidence: 0.99 });
    const ran: string[] = [];
    const agent = createAgent({
      start: menu("Clinic", {
        Ask: ask("Q?", (q) => {
          ran.push(`ask:${q}`);
          return "answered";
        }),
        Book: confirm("Book?", {
          onYes: () => {
            ran.push("booked");
            return "Booked.";
          },
          onNo: say("No."),
        }),
      }),
      channels: [ussdChannel(), smsChannel()],
      logger: quiet,
      sessionStore: sessions,
      languages: { supported: [english, french], detection: { detector: det.d, threshold: 0.5, minChars: 5 } },
    });
    const ussd = (input: string, extra: object = {}) => agent.handle({ channel: "ussd", phone: PHONE, input, ...extra });
    await ussd("", { newSession: true });
    await ussd("1"); // English
    await ussd("1"); // Ask
    expect((await ussd("Je voudrais un rendez-vous")).text).toContain("Continuer en"); // suggestion pending
    // The call drops; the user redials with a shortcut that books: *123*2*1#
    const out = await ussd("1", { newSession: true, gatewaySessionId: "new", inputs: ["2", "1"] });
    expect(out.text).toBe("Booked.");
    expect(ran).toEqual(["booked"]);
  });
});

describe("2. detection never sees a number answer", () => {
  it("skips number asks and answers with no letters", async () => {
    const det = detector({ code: "fr", confidence: 0.99 });
    const agent = createAgent({
      start: menu("Clinic", {
        Account: ask("Account number?", (n) => `ok ${n}`, { input: "number" }),
        Note: ask("Note?", (n) => `ok ${n}`),
      }),
      channels: [smsChannel()],
      logger: quiet,
      languages: { supported: [english, french], detection: { detector: det.d, threshold: 0.5, minChars: 5 } },
    });
    const sms = (input: string) => agent.handle({ channel: "sms", phone: PHONE, input });
    await sms("hi");
    await sms("1"); // English
    await sms("1"); // Account
    expect((await sms("7712345678")).text).toBe("ok 7712345678");
    await sms("hi");
    await sms("2"); // Note, free text but only digits and symbols
    expect((await sms("12/03 - 15:30")).text).toBe("ok 12/03 - 15:30");
    expect(det.calls).toEqual([]);
  });
});

describe("4. the first-contact language menu keeps its id when extra steps change", () => {
  it("is stored under a fixed id", async () => {
    for (const steps of [[], [say("extra one")], [say("a"), say("b")]]) {
      const sessions = memoryStore();
      const agent = createAgent({
        start: say("hi"),
        steps,
        channels: [smsChannel()],
        logger: quiet,
        sessionStore: sessions,
        languages: { supported: [english, french] },
      });
      await agent.handle({ channel: "sms", phone: PHONE, input: "hello" });
      expect((await sessions.load(PHONE))?.stepId).toBe("language");
    }
  });
});

describe("5. yes and no labels that differ only by accents", () => {
  const t = (key: string) => (en as Record<string, string>)[key] ?? key;
  const turn: Turn = { kind: "confirm", question: "?", yes: "Sí", no: "Si" };
  const read = (typed: string) => interpret(turn, typed, { kind: "sms", t, page: 0, pages: 1 });

  it("an exact label wins over a folded one", () => {
    expect(read("Si")).toEqual({ type: "no" });
    expect(read("si")).toEqual({ type: "no" });
    expect(read("Sí")).toEqual({ type: "yes" });
  });

  it("a folded answer that fits both is refused, not guessed", () => {
    const both: Turn = { kind: "confirm", question: "?", yes: "Sí", no: "Sì" };
    expect(interpret(both, "si", { kind: "sms", t, page: 0, pages: 1 })).toEqual({ type: "invalid", reason: "common.invalidChoice" });
  });
});

describe("6. one language offer per conversation", () => {
  it("after accepting, a later answer in the same conversation is not offered another switch", async () => {
    const answers: DetectedLanguage[] = [{ code: "fr", confidence: 0.99 }, { code: "en", confidence: 0.99 }];
    const calls: string[] = [];
    const d: LanguageDetector = {
      async detect(text) {
        calls.push(text);
        return answers.shift() ?? null;
      },
    };
    const second = ask("Another?", (q2, ctx) => `[${ctx.locale}] ${q2}`);
    const agent = createAgent({
      start: menu("Clinic", { Ask: ask("Q?", () => second) }),
      steps: [second],
      channels: [smsChannel()],
      logger: quiet,
      languages: { supported: [english, french], detection: { detector: d, threshold: 0.5, minChars: 5 } },
    });
    const sms = (input: string) => agent.handle({ channel: "sms", phone: PHONE, input });
    await sms("hi");
    await sms("1"); // English
    await sms("1"); // Ask
    expect((await sms("Je voudrais un rendez-vous")).text).toContain("Continuer en");
    expect((await sms("1")).text).toContain("Another?"); // accepted French; the held answer led to the next question
    // This answer looks English, but the user switched a moment ago: no flip-flop.
    expect((await sms("I would also like to ask something")).text).toBe("[fr] I would also like to ask something");
  });
});

describe("7. the locale checker and Object.prototype names", () => {
  it("reports toString and constructor as unknown keys instead of crashing", () => {
    const report = checkLocale("wo", { toString: "x", constructor: "y", __proto__: "z" } as Record<string, unknown>);
    const unknown = report.issues.filter((i) => i.code === "unknown-key").map((i) => i.key).sort();
    expect(unknown).toEqual(expect.arrayContaining(["constructor", "toString"]));
  });
});

describe("languageMenu in the tree is unaffected by the fixed id", () => {
  it("still gets a positional id", async () => {
    const sessions = memoryStore();
    const agent = createAgent({
      start: menu("Clinic", { Language: languageMenu({ languages: [english, french] }) }),
      channels: [smsChannel()],
      logger: quiet,
      sessionStore: sessions,
    });
    await agent.handle({ channel: "sms", phone: PHONE, input: "hi" });
    await agent.handle({ channel: "sms", phone: PHONE, input: "1" });
    expect((await sessions.load(PHONE))?.stepId).toBe("start.1");
  });
});
