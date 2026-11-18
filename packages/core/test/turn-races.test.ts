import { describe, expect, it } from "vitest";
import {
  ask,
  createAgent,
  memoryStore,
  menu,
  say,
  silentLogger,
  smsChannel,
  ussdChannel,
  type Clock,
  type DetectedLanguage,
  type Language,
  type LanguageDetector,
  type SessionStore,
} from "../src/index.js";

const PHONE = "+14155550100"; // no country prior: languages appear in declared order
const en: Language = { code: "en", name: "English" };
const fr: Language = { code: "fr", name: "Français" };
const sw: Language = { code: "sw", name: "Kiswahili" };
const messages = { sw: { "common.yes": "yes-sw" } }; // placeholder for the test, not a translation

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
  const settle = async () => {
    for (let i = 0; i < 10; i++) await new Promise<void>((r) => setImmediate(r));
  };
  async function advance(ms: number) {
    const end = now + ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      now = due[1].at;
      due[1].fn();
      await settle();
    }
    now = end;
  }
  const sleep = (ms: number) => new Promise<void>((r) => clock.setTimeout(r, ms));
  return { clock, advance, settle, sleep };
}

/** A detector the test answers by hand. */
function heldDetector() {
  const pending: Array<(r: DetectedLanguage | null) => void> = [];
  const detector: LanguageDetector = {
    detect: () => new Promise((resolve) => pending.push(resolve)),
  };
  return { detector, pending };
}

function frenchDetector(): LanguageDetector {
  return { detect: async () => ({ code: "fr", confidence: 0.95 }) };
}

function detectionAgent(options: {
  sessions: SessionStore;
  detector: LanguageDetector;
  question?: string;
  handler?: (q: string, locale: string) => string;
}) {
  const handler = options.handler ?? ((q, locale) => `[${locale}] ${q}`);
  const agent = createAgent({
    start: menu("Clinic", {
      "Ask a nurse": ask(options.question ?? "Your question?", (q, ctx) => handler(q, ctx.locale)),
      Hours: say("8 to 18"),
    }),
    channels: [smsChannel()],
    logger: silentLogger,
    sessionStore: options.sessions,
    messages,
    languages: { supported: [en, fr, sw], detection: { detector: options.detector, threshold: 0.8, minChars: 10 } },
  });
  const sms = (input: string) => agent.handle({ channel: "sms", phone: PHONE, input });
  return { agent, sms };
}

async function toQuestion(sms: (input: string) => Promise<unknown>) {
  await sms("hi");
  await sms("1"); // English
  await sms("1"); // Ask a nurse
}

describe("the language menu resolves against what the caller saw", () => {
  function menuAgent(sessions: SessionStore, supported: Language[]) {
    const agent = createAgent({
      start: menu("Clinic", { Hours: say("8 to 18") }),
      channels: [smsChannel()],
      logger: silentLogger,
      sessionStore: sessions,
      messages,
      languages: { supported },
    });
    return (input: string) => agent.handle({ channel: "sms", phone: PHONE, input });
  }

  it("keeps a choice meaning the language listed, after the order changes", async () => {
    const sessions = memoryStore();
    const before = menuAgent(sessions, [en, fr, sw]);
    expect((await before("hi")).text).toContain("1. English");
    // A deployment reorders the languages while the menu is on the caller's screen.
    const after = menuAgent(sessions, [fr, en, sw]);
    await after("1");
    expect((await sessions.load(PHONE))?.locale).toBe("en");
  });

  it("shows the menu again when the chosen language is no longer offered", async () => {
    const sessions = memoryStore();
    const before = menuAgent(sessions, [en, fr, sw]);
    await before("hi");
    const after = menuAgent(sessions, [fr, sw]);
    const shown = await after("1");
    expect(shown.text).toContain("1. Français\n2. Kiswahili");
    expect((await sessions.load(PHONE))?.languageChosen).toBeFalsy();
  });
});

describe("a held answer runs only with the question it answered", () => {
  it("lapses when the question at its step has changed", async () => {
    const sessions = memoryStore();
    const before = detectionAgent({ sessions, detector: frenchDetector() });
    await toQuestion(before.sms);
    expect((await before.sms("Je voudrais un rendez-vous")).text).toContain("Français");

    const ran: string[] = [];
    const after = detectionAgent({
      sessions,
      detector: frenchDetector(),
      question: "Why are you cancelling?",
      handler: (q) => {
        ran.push(q);
        return "cancelled";
      },
    });
    const shown = await after.sms("1"); // Yes
    expect(ran).toEqual([]);
    expect(shown.text).toContain("Clinic"); // back to the start, in the old language
    expect((await sessions.load(PHONE))?.locale).toBe("en");
  });

  it("still runs when the question is unchanged", async () => {
    const sessions = memoryStore();
    const before = detectionAgent({ sessions, detector: frenchDetector() });
    await toQuestion(before.sms);
    await before.sms("Je voudrais un rendez-vous");
    const after = detectionAgent({ sessions, detector: frenchDetector() });
    expect((await after.sms("1")).text).toBe("[fr] Je voudrais un rendez-vous");
  });
});

describe("two turns on one session", () => {
  it("runs a held answer once when Yes arrives twice at the same moment", async () => {
    const sessions = memoryStore();
    let runs = 0;
    const t = detectionAgent({
      sessions,
      detector: frenchDetector(),
      handler: (q, locale) => {
        runs += 1;
        return `[${locale}] ${q}`;
      },
    });
    await toQuestion(t.sms);
    await t.sms("Je voudrais un rendez-vous");
    const [first, second] = await Promise.all([t.sms("1"), t.sms("1")]);
    expect(runs).toBe(1);
    expect([first.text, second.text]).toContain("[fr] Je voudrais un rendez-vous");
  });

  it("drops a slow detector's suggestion when a newer turn has saved meanwhile", async () => {
    const sessions = memoryStore();
    const held = heldDetector();
    const t = detectionAgent({ sessions, detector: held.detector });
    await toQuestion(t.sms);

    const slow = t.sms("Je voudrais un rendez-vous");
    await new Promise<void>((r) => setImmediate(r));
    expect(held.pending).toHaveLength(1);
    // The user moves on before the detector answers: "short" is under minChars.
    expect((await t.sms("short")).text).toBe("[en] short");

    held.pending[0]!({ code: "fr", confidence: 0.95 });
    await slow;
    const stored = await sessions.load(PHONE);
    expect(stored?.languageSuggestion ?? null).toBeNull();
    // The slow turn would have left its Yes/No question on screen.
    expect(stored?.turn?.kind).not.toBe("confirm");
    expect(stored?.languageOffered).toBeFalsy();
  });
});

describe("one time budget per live turn", () => {
  it("shares the deadline between handlers a dial string runs one after another", async () => {
    const timers = timerClock();
    const sent: Array<{ to: string; text: string }> = [];
    const second = ask("Second?", async (a) => {
      await timers.sleep(3000);
      return `done: ${a}`;
    });
    const agent = createAgent({
      start: menu("Clinic", {
        Start: ask("First?", async () => {
          await timers.sleep(3000);
          return second;
        }),
      }),
      steps: [second],
      channels: [ussdChannel(), smsChannel({ send: async (out) => void sent.push(out) })],
      logger: silentLogger,
      clock: timers.clock,
      deadlineMs: 4000,
    });
    const turn = agent.handle({ channel: "ussd", phone: PHONE, input: "b", newSession: true, inputs: ["1", "a", "b"] });
    await timers.settle();
    await timers.advance(4000);
    // 3000 ms for the first handler leaves 1000 for the second, which needs 3000.
    const outcome = await turn;
    expect(outcome.deferred).toBe(true);
    await timers.advance(3000);
    await timers.settle();
    expect(sent.map((s) => s.text)).toEqual(["done: b"]);
  });
});
