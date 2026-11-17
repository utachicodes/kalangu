import { describe, expect, it } from "vitest";
import {
  ask,
  createAgent,
  memoryStore,
  menu,
  say,
  smsChannel,
  ussdChannel,
  type AgentConfig,
  type Clock,
  type DetectedLanguage,
  type Language,
  type LanguageDetector,
  type Logger,
} from "../src/index.js";

const PHONE = "+14155550100"; // no country prior: languages appear in declared order
const en: Language = { code: "en", name: "English" };
const fr: Language = { code: "fr", name: "Français" };
const sw: Language = { code: "sw", name: "Kiswahili" };
const messages = { sw: { "common.yes": "yes-sw" } }; // placeholder for the test, not a translation

function recordingLogger() {
  const warnings: string[] = [];
  const noop = () => {};
  const logger: Logger = { debug: noop, info: noop, warn: (m) => void warnings.push(m), error: noop };
  return { logger, warnings };
}

/** A clock whose timers fire when the test advances time. */
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
      for (let i = 0; i < 10; i++) await new Promise<void>((r) => setImmediate(r));
    }
    now = end;
  }
  return { clock, advance };
}

function fakeDetector(answer: DetectedLanguage | null | (() => Promise<DetectedLanguage | null>)) {
  const calls: Array<{ text: string; candidates: readonly string[] }> = [];
  const detector: LanguageDetector = {
    async detect(text, { candidates }) {
      calls.push({ text, candidates });
      return typeof answer === "function" ? answer() : answer;
    },
  };
  return { detector, calls };
}

function setup(
  detection: Partial<NonNullable<NonNullable<AgentConfig["languages"]>["detection"]>> | null,
  extra: Partial<AgentConfig> = {},
) {
  const { logger, warnings } = recordingLogger();
  const timers = timerClock();
  const sessions = memoryStore();
  const fake = fakeDetector({ code: "fr", confidence: 0.95 });
  const agent = createAgent({
    start: menu("Clinic", {
      "Ask a nurse": ask("Your question?", (q, ctx) => `[${ctx.locale}] ${q}`),
      Hours: say("8 to 18"),
    }),
    channels: [ussdChannel(), smsChannel()],
    logger,
    clock: timers.clock,
    sessionStore: sessions,
    messages,
    languages: {
      supported: [en, fr, sw],
      ...(detection === null ? {} : { detection: { detector: fake.detector, threshold: 0.8, minChars: 10, ...detection } }),
    },
    ...extra,
  });
  const sms = (input: string) => agent.handle({ channel: "sms", phone: PHONE, input });
  /** Picks English at the language menu and opens "Ask a nurse". */
  async function toQuestion() {
    await sms("hi");
    await sms("1"); // English
    return sms("1"); // Ask a nurse
  }
  return { agent, sms, toQuestion, fake, warnings, sessions, advance: timers.advance };
}

describe("language detection on typed answers", () => {
  it("does nothing when no detector is configured", async () => {
    const t = setup(null);
    await t.toQuestion();
    expect((await t.sms("Je voudrais un rendez-vous")).text).toBe("[en] Je voudrais un rendez-vous");
  });

  it("never runs on menu choices, only on typed answers", async () => {
    const t = setup({});
    await t.toQuestion();
    expect(t.fake.calls).toHaveLength(0);
  });

  it("does not run on an answer shorter than minChars", async () => {
    const t = setup({ minChars: 30 });
    await t.toQuestion();
    expect((await t.sms("Bonjour madame")).text).toBe("[en] Bonjour madame");
    expect(t.fake.calls).toHaveLength(0);
  });

  it("passes the trimmed text and the agent's languages as candidates", async () => {
    const f = fakeDetector(null);
    const t = setup({ detector: f.detector });
    await t.toQuestion();
    await t.sms("   Je voudrais un rendez-vous   ");
    expect(f.calls).toEqual([{ text: "Je voudrais un rendez-vous", candidates: ["en", "fr", "sw"] }]);
  });

  it("asks, in the suggested language, whether to continue in it, holding the answer", async () => {
    const t = setup({});
    await t.toQuestion();
    const out = await t.sms("Je voudrais un rendez-vous");
    expect(out.text).toContain("Continuer en Français ?");
    expect(out.end).toBe(false);
    expect((await t.sessions.load(PHONE))?.locale).toBe("en"); // nothing switched yet
  });

  it("Yes switches the language and answers the held question in it", async () => {
    const t = setup({});
    await t.toQuestion();
    await t.sms("Je voudrais un rendez-vous");
    expect((await t.sms("1")).text).toBe("[fr] Je voudrais un rendez-vous");
    expect(await t.sessions.load(PHONE)).toMatchObject({ locale: "fr", languageChosen: true, languageSuggestion: null });
  });

  it("No keeps the language, answers the held question, and does not ask again this session", async () => {
    const t = setup({});
    await t.toQuestion();
    await t.sms("Je voudrais un rendez-vous");
    expect((await t.sms("2")).text).toBe("[en] Je voudrais un rendez-vous");
    expect((await t.sessions.load(PHONE))?.languageSuggestionDeclined).toBe(true);
    await t.sms("hi"); // the conversation ended with the answer: an SMS starts again at the menu
    await t.sms("1"); // Ask a nurse
    expect((await t.sms("Encore une question, s'il vous plait")).text).toBe("[en] Encore une question, s'il vous plait");
    expect(t.fake.calls).toHaveLength(1); // not even asked
  });

  it("switches nothing below the threshold", async () => {
    const f = fakeDetector({ code: "fr", confidence: 0.79 });
    const t = setup({ detector: f.detector, threshold: 0.8 });
    await t.toQuestion();
    expect((await t.sms("Je voudrais un rendez-vous")).text).toBe("[en] Je voudrais un rendez-vous");
  });

  it("offers nothing when the detected language is the current one", async () => {
    const f = fakeDetector({ code: "en", confidence: 0.99 });
    const t = setup({ detector: f.detector });
    await t.toQuestion();
    expect((await t.sms("I would like an appointment")).text).toBe("[en] I would like an appointment");
  });

  it("ignores an answer outside the agent's languages", async () => {
    const f = fakeDetector({ code: "ha", confidence: 0.99 });
    const t = setup({ detector: f.detector });
    await t.toQuestion();
    expect((await t.sms("Ina son ganin likita don Allah")).text).toBe("[en] Ina son ganin likita don Allah");
  });

  it("carries on, with a warning, when the detector fails", async () => {
    const f = fakeDetector(async () => {
      throw new Error("service down");
    });
    const t = setup({ detector: f.detector });
    await t.toQuestion();
    expect((await t.sms("Je voudrais un rendez-vous")).text).toBe("[en] Je voudrais un rendez-vous");
    expect(t.warnings.some((w) => w.includes("detection failed"))).toBe(true);
  });

  it("gives up on a slow detector after timeoutMs and answers normally", async () => {
    const f = fakeDetector(() => new Promise(() => {})); // never answers
    const t = setup({ detector: f.detector, timeoutMs: 500 });
    await t.toQuestion();
    const pending = t.sms("Je voudrais un rendez-vous");
    for (let i = 0; i < 20; i++) await new Promise<void>((r) => setImmediate(r)); // let it reach the detector
    expect(f.calls).toHaveLength(1);
    await t.advance(500);
    expect((await pending).text).toBe("[en] Je voudrais un rendez-vous");
    expect(t.warnings.some((w) => w.includes("timed out"))).toBe(true);
  });
});

describe("detection config checks", () => {
  const base = (detection: Record<string, unknown>, extra: Partial<AgentConfig> = {}) => () =>
    createAgent({
      start: say("hi"),
      channels: [ussdChannel()],
      languages: { supported: [en, fr], detection: { detector: fakeDetector(null).detector, threshold: 0.8, minChars: 10, ...detection } as never },
      ...extra,
    });

  it("requires a threshold above 0 and at most 1, with no default", () => {
    expect(base({ threshold: undefined })).toThrow(/threshold/);
    expect(base({ threshold: 0 })).toThrow(/threshold/);
    expect(base({ threshold: 1.5 })).toThrow(/threshold/);
    expect(base({ threshold: 1 })).not.toThrow();
  });

  it("requires a whole minChars of at least 1, with no default", () => {
    expect(base({ minChars: undefined })).toThrow(/minChars/);
    expect(base({ minChars: 0 })).toThrow(/minChars/);
    expect(base({ minChars: 2.5 })).toThrow(/minChars/);
  });

  it("requires a detector with a detect function", () => {
    expect(base({ detector: {} })).toThrow(/detect/);
  });

  it("refuses a deadline and detection timeout that together outlast the gateway", () => {
    expect(base({}, { deadlineMs: 9500 })).toThrow(/plus the language detection timeout/);
    expect(base({ timeoutMs: 400 }, { deadlineMs: 9500 })).not.toThrow();
  });
});

describe("a model per language", () => {
  const models = { default: "multilingual", fr: "french" };

  function modelAgent(extra: Partial<AgentConfig> = {}) {
    const { logger, warnings } = recordingLogger();
    const seen: string[] = [];
    const agent = createAgent({
      start: menu("Clinic", {
        Ask: ask("Q?", (_q, ctx) => {
          seen.push(`${ctx.locale}:${ctx.model}`);
          return "ok";
        }),
        Switch: (_i, ctx) => {
          seen.push(`before ${ctx.model}`);
          ctx.locale = "fr";
          seen.push(`after ${ctx.model}`);
          return "switched";
        },
      }),
      channels: [smsChannel()],
      logger,
      messages,
      models,
      ...extra,
    });
    return { agent, seen, warnings, sms: (i: string) => agent.handle({ channel: "sms", phone: PHONE, input: i }) };
  }

  it("gives handlers the model for the user's language", async () => {
    const t = modelAgent({ defaultLocale: "fr" });
    await t.sms("hi");
    await t.sms("1");
    await t.sms("question");
    expect(t.seen).toEqual(["fr:french"]);
  });

  it("falls back to the default model, with one warning per language", async () => {
    const t = modelAgent({ defaultLocale: "sw" });
    for (let i = 0; i < 2; i++) {
      await t.sms("hi");
      await t.sms("1");
      await t.sms("question");
    }
    expect(t.seen).toEqual(["sw:multilingual", "sw:multilingual"]);
    expect(t.warnings.filter((w) => w.includes("No model for this language"))).toHaveLength(1);
  });

  it("follows a language change made inside the handler", async () => {
    const t = modelAgent();
    await t.sms("hi");
    await t.sms("2");
    expect(t.seen).toEqual(["before multilingual", "after french"]);
  });

  it("checks the map at startup", () => {
    const make = (extra: Partial<AgentConfig>) => () => createAgent({ start: say("hi"), channels: [smsChannel()], ...extra });
    expect(make({ model: "one", models })).toThrow(/either `model` or `models`/);
    expect(make({ models: { fr: "french" } as never })).toThrow(/default/);
    expect(make({ models: { default: "m", zz: "x" } })).toThrow(/models.zz/);
    expect(make({ models })).not.toThrow();
  });
});
