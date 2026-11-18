import { describe, expect, it } from "vitest";
import {
  createAgent,
  memoryStore,
  menu,
  say,
  silentLogger,
  smsChannel,
  ussdChannel,
  type DetectedLanguage,
  type Language,
  type LanguageDetector,
} from "../src/index.js";

const PHONE = "+14155550100"; // no country prior: languages appear in declared order
const en: Language = { code: "en", name: "English" };
const fr: Language = { code: "fr", name: "Français" };
const sw: Language = { code: "sw", name: "Kiswahili" };
const messages = { sw: { "common.yes": "yes-sw" } }; // placeholder for the test, not a translation

function setup(answer: DetectedLanguage | null = { code: "fr", confidence: 0.95 }) {
  const calls: string[] = [];
  const detector: LanguageDetector = {
    async detect(text) {
      calls.push(text);
      return answer;
    },
  };
  const sessions = memoryStore();
  const agent = createAgent({
    start: menu({ en: "Clinic", fr: "Clinique" }, { Hours: say("8 to 18") }),
    channels: [ussdChannel(), smsChannel()],
    logger: silentLogger,
    sessionStore: sessions,
    messages,
    languages: { supported: [en, fr, sw], detection: { detector, threshold: 0.8, minChars: 10 } },
  });
  const sms = (input: string) => agent.handle({ channel: "sms", phone: PHONE, input });
  const dial = () => agent.handle({ channel: "ussd", phone: PHONE, input: "", newSession: true });
  /** A number that chose English and finished a conversation. */
  async function knownEnglish() {
    await sms("hi");
    await sms("1"); // English
    await sms("1"); // Hours: the conversation ends
    calls.length = 0;
  }
  return { sms, dial, sessions, calls, knownEnglish };
}

describe("detection on a conversation's first SMS", () => {
  it("lists the language a new number wrote in first, and chooses nothing", async () => {
    const t = setup();
    const shown = await t.sms("Bonjour, je voudrais un rendez-vous");
    expect(shown.text).toContain("1. Français\n2. English\n3. Kiswahili");
    expect((await t.sessions.load(PHONE))?.languageChosen).toBeFalsy();
    await t.sms("1");
    expect((await t.sessions.load(PHONE))?.locale).toBe("fr");
  });

  it("keeps the usual order for a short message, a number, or a weak score", async () => {
    const t = setup();
    expect((await t.sms("salut")).text).toContain("1. English\n2. Français");
    expect(t.calls).toEqual([]);
    const digits = setup();
    await digits.sms("254700000001 254700000002");
    expect(digits.calls).toEqual([]);
    const weak = setup({ code: "fr", confidence: 0.5 });
    expect((await weak.sms("Bonjour, je voudrais un rendez-vous")).text).toContain("1. English\n2. Français");
  });

  it("never runs on a USSD dial", async () => {
    const t = setup();
    await t.dial();
    expect(t.calls).toEqual([]);
  });

  it("offers a known number the language it wrote in, and Yes starts in it", async () => {
    const t = setup();
    await t.knownEnglish();
    const offer = await t.sms("Bonjour, je voudrais un rendez-vous");
    expect(offer.text).toContain("Français");
    expect(t.calls).toEqual(["Bonjour, je voudrais un rendez-vous"]);
    const started = await t.sms("1"); // Yes
    expect(started.text).toContain("Clinique");
    expect((await t.sessions.load(PHONE))?.locale).toBe("fr");
  });

  it("remembers a No for good and starts in the language already chosen", async () => {
    const t = setup();
    await t.knownEnglish();
    await t.sms("Bonjour, je voudrais un rendez-vous");
    const started = await t.sms("2"); // No
    expect(started.text).toContain("Clinic\n1. Hours");
    await t.sms("1"); // Hours: ends again
    t.calls.length = 0;
    expect((await t.sms("Bonjour, encore une question")).text).toContain("Clinic\n1. Hours");
    expect(t.calls).toEqual([]);
  });

  it("offers nothing when the message is in the language already chosen", async () => {
    const t = setup({ code: "en", confidence: 0.95 });
    await t.knownEnglish();
    expect((await t.sms("Hello, I would like an appointment")).text).toContain("Clinic\n1. Hours");
  });

  it("starts once when Yes arrives twice at the same moment", async () => {
    const t = setup();
    await t.knownEnglish();
    await t.sms("Bonjour, je voudrais un rendez-vous");
    const [a, b] = await Promise.all([t.sms("1"), t.sms("1")]);
    expect([a.text, b.text].every((text) => text.includes("Clinique"))).toBe(true);
    expect((await t.sessions.load(PHONE))?.locale).toBe("fr");
  });
});
