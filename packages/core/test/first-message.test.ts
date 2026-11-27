import { describe, expect, it } from "vitest";
import {
  ask,
  createAgent,
  freshRecord,
  memoryStore,
  menu,
  say,
  silentLogger,
  smsChannel,
  ussdChannel,
  type Clock,
  type Handler,
  type Language,
  type LanguageDetector,
  type Reply,
} from "../src/index.js";

// docs/first-message-design.md §7: one test (or more) per item of the plan.

const PHONE = "+14155550100"; // no country prior: languages appear in declared order
const en: Language = { code: "en", name: "English" };
const fr: Language = { code: "fr", name: "Français" };

/** A clock the test moves by hand. */
function manualClock(): Clock & { advance(ms: number): void } {
  let t = 1_800_000_000_000;
  return { now: () => t, setTimeout: () => 0, clearTimeout: () => {}, advance: (ms) => (t += ms) };
}

function setup(options: { onMessage?: Handler; languages?: boolean; detector?: LanguageDetector } = {}) {
  const calls: Array<{ text: string; locale: string; channel: string }> = [];
  const onMessage: Handler =
    options.onMessage ??
    ((text, ctx) => {
      calls.push({ text, locale: ctx.locale, channel: ctx.channelKind });
      return text.length >= 10 ? `Report received: ${text}` : undefined;
    });
  const sessions = memoryStore();
  const clock = manualClock();
  const followUp = ask("Which village?", (v) => `Noted for ${v}.`);
  const agent = createAgent({
    start: menu({ en: "Clinic", fr: "Clinique" }, { Hours: say("8 to 18"), Village: followUp }),
    steps: [followUp],
    channels: [ussdChannel(), smsChannel()],
    logger: silentLogger,
    sessionStore: sessions,
    clock,
    onMessage,
    ...(options.languages || options.detector
      ? {
          languages: {
            supported: [en, fr],
            ...(options.detector ? { detection: { detector: options.detector, threshold: 0.8, minChars: 10 } } : {}),
          },
        }
      : {}),
  });
  const sms = (input: string) => agent.handle({ channel: "sms", phone: PHONE, input });
  const dial = (input = "") => agent.handle({ channel: "ussd", phone: PHONE, input, newSession: true });
  return { agent, sms, dial, sessions, clock, calls, followUp };
}

describe("onMessage: a conversation's first SMS as input", () => {
  it("is called with the trimmed text, and a string reply ends the conversation", async () => {
    const t = setup();
    const out = await t.sms("  The borehole is broken  ");
    expect(t.calls).toEqual([{ text: "The borehole is broken", locale: "en", channel: "sms" }]);
    expect(out).toMatchObject({ text: "Report received: The borehole is broken", end: true });
    // Ended: the next SMS starts a conversation again.
    await t.sms("The pump is still broken");
    expect(t.calls).toHaveLength(2);
  });

  it("shows the start when it returns nothing, as without it", async () => {
    const t = setup();
    const out = await t.sms("hi");
    expect(t.calls.map((c) => c.text)).toEqual(["hi"]);
    expect(out.text).toBe("Clinic\n1. Hours\n2. Village");
    expect(out.end).toBe(false);
  });

  it("can return a step, and the conversation goes on from it", async () => {
    const t = setup({ onMessage: (): Reply => t.followUp });
    expect((await t.sms("Report: no water")).text).toBe("Which village?");
    expect((await t.sms("Keur Ali")).text).toBe("Noted for Keur Ali.");
  });

  it("passes a bare number as text (design §8, question 2)", async () => {
    const t = setup();
    const out = await t.sms("2");
    expect(t.calls.map((c) => c.text)).toEqual(["2"]);
    expect(out.text).toBe("Clinic\n1. Hours\n2. Village"); // returned nothing: the menu, not option 2
  });

  it("is never called on USSD, a dial string included", async () => {
    const t = setup();
    expect((await t.dial()).text).toBe("Clinic\n1. Hours\n2. Village");
    expect((await t.dial("1")).text).toBe("8 to 18");
    expect(t.calls).toHaveLength(0);
  });

  it("is not called for an SMS that answers a waiting question; free text there stays an invalid choice (question 3)", async () => {
    const t = setup();
    await t.sms("hi"); // the menu is now waiting
    t.calls.length = 0;
    expect((await t.sms("1")).text).toBe("8 to 18");
    await t.sms("hi");
    t.calls.length = 0;
    const out = await t.sms("The borehole is broken");
    expect(t.calls).toHaveLength(0);
    expect(out.text).toMatch(/Invalid choice/);
  });

  it("is not called while a deferred answer is on its way", async () => {
    const t = setup();
    await t.sessions.save({ ...freshRecord(PHONE, "en", t.clock.now()), deferred: { since: t.clock.now() } });
    const out = await t.sms("The borehole is broken");
    expect(t.calls).toHaveLength(0);
    expect(out.text).toMatch(/You will receive an SMS/);
  });

  it("is called once a waiting question has lapsed after the resume window", async () => {
    const t = setup();
    await t.sms("hi"); // the menu is waiting
    t.calls.length = 0;
    t.clock.advance(5 * 60 * 1000 + 1);
    await t.sms("The borehole is broken");
    expect(t.calls.map((c) => c.text)).toEqual(["The borehole is broken"]);
  });

  it("answers a throw with the usual error and leaves the session at the start", async () => {
    const t = setup({
      onMessage: () => {
        throw new Error("database down");
      },
    });
    const out = await t.sms("The borehole is broken");
    expect(out).toMatchObject({ end: true });
    expect(out.text).toMatch(/something went wrong/i);
    const stored = await t.sessions.load(PHONE);
    expect(stored).toMatchObject({ stepId: null, turn: null });
  });

  it("must be a function", () => {
    expect(() =>
      createAgent({ start: say("x"), channels: [smsChannel()], logger: silentLogger, onMessage: "no" as unknown as Handler }),
    ).toThrow(/onMessage/);
  });
});

describe("onMessage with languages (design §5)", () => {
  it("holds a new number's message through the language menu and runs it in the language chosen", async () => {
    const t = setup({ languages: true });
    const menuShown = await t.sms("Le forage est en panne");
    expect(menuShown.text).toMatch(/1\. English\n2\. Fran/);
    expect(t.calls).toHaveLength(0);
    const out = await t.sms("2");
    expect(t.calls).toEqual([{ text: "Le forage est en panne", locale: "fr", channel: "sms" }]);
    expect(out.text).toBe("Report received: Le forage est en panne");
    expect((await t.sessions.load(PHONE))?.heldMessage ?? null).toBeNull();
  });

  it("shows the start after the choice when the held message returns nothing", async () => {
    const t = setup({ languages: true });
    await t.sms("hi");
    expect((await t.sms("2")).text).toBe("Clinique\n1. Hours\n2. Village");
    expect(t.calls.map((c) => c.text)).toEqual(["hi"]);
  });

  it("holds only one message: a second SMS before the choice answers the menu", async () => {
    const t = setup({ languages: true });
    await t.sms("Le forage est en panne");
    const out = await t.sms("Another long message here");
    expect(out.text).toMatch(/Invalid choice/);
    await t.sms("1");
    expect(t.calls.map((c) => c.text)).toEqual(["Le forage est en panne"]);
  });

  it("drops a held message when the session resets", async () => {
    const t = setup({ languages: true });
    await t.sms("Le forage est en panne");
    t.clock.advance(5 * 60 * 1000 + 1);
    await t.sms("1"); // a new conversation: the menu again, holding "1"
    await t.sms("1");
    expect(t.calls.map((c) => c.text)).toEqual(["1"]);
  });

  it("drops a held message when the language is chosen on USSD", async () => {
    const t = setup({ languages: true });
    await t.sms("Le forage est en panne");
    await t.dial();
    const out = await t.agent.handle({ channel: "ussd", phone: PHONE, input: "2" });
    expect(t.calls).toHaveLength(0);
    expect(out.text).toBe("Clinique\n1. Hours\n2. Village");
  });

  it("runs a held message once when two answers to the menu race", async () => {
    const t = setup({ languages: true });
    await t.sms("Le forage est en panne");
    await Promise.all([t.sms("1"), t.sms("1")]);
    expect(t.calls).toHaveLength(1);
  });

  it("holds the message through a 'Continue in…?' offer and runs it after Yes, in that language", async () => {
    const detector: LanguageDetector = { detect: async () => ({ code: "fr", confidence: 0.95 }) };
    const t = setup({ detector });
    await t.sms("hi");
    await t.sms("1"); // English
    await t.sms("1"); // Hours: ended
    t.calls.length = 0;
    const offer = await t.sms("Le forage est en panne depuis hier");
    expect(offer.text).toMatch(/Continuer en Français/);
    expect(t.calls).toHaveLength(0);
    const out = await t.sms("1"); // Yes
    expect(t.calls).toEqual([{ text: "Le forage est en panne depuis hier", locale: "fr", channel: "sms" }]);
    expect(out.text).toBe("Report received: Le forage est en panne depuis hier");
  });

  it("runs it after No too, in the language kept", async () => {
    const detector: LanguageDetector = { detect: async () => ({ code: "fr", confidence: 0.95 }) };
    const t = setup({ detector });
    await t.sms("hi");
    await t.sms("1"); // English
    await t.sms("1"); // ended
    t.calls.length = 0;
    await t.sms("Le forage est en panne depuis hier");
    await t.sms("2"); // No
    expect(t.calls).toEqual([{ text: "Le forage est en panne depuis hier", locale: "en", channel: "sms" }]);
  });
});
