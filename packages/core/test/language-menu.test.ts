import { describe, expect, it } from "vitest";
import {
  createAgent,
  languageMenu,
  memoryStore,
  menu,
  say,
  silentLogger,
  smsChannel,
  ussdChannel,
  type AgentConfig,
  type Language,
} from "../src/index.js";

const SENEGAL = "+221771234567";
const KENYA = "+254700000001";

const en: Language = { code: "en", name: "English" };
const fr: Language = { code: "fr", name: "Français" };
const wo: Language = { code: "wo", name: "Wolof" };
const sw: Language = { code: "sw", name: "Kiswahili" };

// Placeholder strings for the test only: not real translations.
const messages = {
  wo: { "common.yes": "yes-wo", "common.invalidChoice": "invalid-wo" },
  sw: { "common.yes": "yes-sw" },
};

function setup(extra: Partial<AgentConfig> = {}) {
  const sessions = memoryStore();
  const agent = createAgent({
    start: menu({ en: "Clinic", fr: "Clinique", wo: "Clinic-wo", sw: "Kliniki" }, { Hours: say("8 to 18") }),
    channels: [ussdChannel(), smsChannel()],
    logger: silentLogger,
    sessionStore: sessions,
    messages,
    languages: { supported: [en, fr, wo, sw] },
    ...extra,
  });
  const dial = (phone: string, inputs?: string[]) =>
    agent.handle({
      channel: "ussd",
      phone,
      input: inputs ? (inputs.at(-1) ?? "") : "",
      newSession: true,
      ...(inputs ? { inputs } : {}),
    });
  const press = (phone: string, input: string) => agent.handle({ channel: "ussd", phone, input });
  const sms = (phone: string, input: string) => agent.handle({ channel: "sms", phone, input });
  return { agent, sessions, dial, press, sms };
}

describe("first-contact language menu", () => {
  it("is shown before the start step, with the languages likely for the country first", async () => {
    const t = setup();
    // USSD shows accents as plain letters (Français becomes Francais).
    expect((await t.dial(SENEGAL)).text).toBe("Langue / Language\n1. Francais\n2. Wolof\n3. English\n4. Kiswahili");
    expect((await t.dial(KENYA)).text).toBe("Language / Langue\n1. Kiswahili\n2. English\n3. Francais\n4. Wolof");
  });

  it("keeps accents on SMS", async () => {
    const t = setup();
    expect((await t.sms(SENEGAL, "hi")).text).toBe("Langue / Language\n1. Français\n2. Wolof\n3. English\n4. Kiswahili");
  });

  it("sets the language for good and carries on to the start step in it", async () => {
    const t = setup();
    await t.dial(SENEGAL);
    expect((await t.press(SENEGAL, "1")).text).toBe("Clinique\n1. Hours");
    const record = (await t.sessions.load(SENEGAL))!;
    expect(record).toMatchObject({ locale: "fr", languageChosen: true });
  });

  it("asks only once: later dials go straight to the start step", async () => {
    const t = setup();
    await t.dial(SENEGAL);
    await t.press(SENEGAL, "2"); // Wolof
    expect((await t.dial(SENEGAL)).text).toBe("Clinic-wo\n1. Hours");
  });

  it("asks per phone number", async () => {
    const t = setup();
    await t.dial(SENEGAL);
    await t.press(SENEGAL, "1");
    expect((await t.dial(KENYA)).text).toContain("Kiswahili");
  });

  it("accepts a language typed by its own name", async () => {
    const t = setup();
    await t.sms(SENEGAL, "hi");
    expect((await t.sms(SENEGAL, "wolof")).text).toContain("Clinic-wo");
    expect((await t.sessions.load(SENEGAL))?.locale).toBe("wo");
  });

  it("re-shows the menu with a notice for an invalid choice, and chooses nothing", async () => {
    const t = setup();
    await t.dial(SENEGAL);
    const out = await t.press(SENEGAL, "9");
    expect(out.text).toBe("Invalid choice. Try again.\nLangue / Language\n1. Francais\n2. Wolof\n3. English\n4. Kiswahili");
    expect((await t.sessions.load(SENEGAL))?.languageChosen).toBeUndefined();
  });

  it("drops a dial-string shortcut once, since its first input is not a language choice", async () => {
    const t = setup();
    const out = await t.dial(SENEGAL, ["1", "2"]); // *384*1*2#
    expect(out.text).toBe("Langue / Language\n1. Francais\n2. Wolof\n3. English\n4. Kiswahili");
    expect((await t.sessions.load(SENEGAL))?.languageChosen).toBeUndefined();
  });

  it("applies to SMS conversations as a numbered list", async () => {
    const t = setup();
    await t.sms(KENYA, "hello");
    expect((await t.sms(KENYA, "1")).text).toContain("Kliniki");
  });

  it("asks a user whose session predates languages, once", async () => {
    const t = setup();
    await t.sessions.save({
      phone: SENEGAL, locale: "fr", stepId: null, turn: null, page: 0, data: {}, channel: null,
      deferred: null, updatedAt: Date.now(), gatewaySessionId: null,
    });
    expect((await t.dial(SENEGAL)).text).toContain("Langue / Language");
  });

  it("lists the languages in declared order for an id that is not a phone number", async () => {
    const t = setup();
    expect((await t.sms("US.13491208655302741918", "hi")).text).toBe(
      "Language / Langue\n1. English\n2. Français\n3. Wolof\n4. Kiswahili",
    );
  });

  it("uses the chosen language for fixed text afterwards", async () => {
    const t = setup();
    await t.dial(SENEGAL);
    await t.press(SENEGAL, "2"); // Wolof: its messages override common.invalidChoice
    expect((await t.press(SENEGAL, "9")).text).toContain("invalid-wo");
  });
});

describe("a language menu in the tree", () => {
  const supported = [en, fr];

  it("switches the language and goes back up when it has no next step", async () => {
    const t = setup({
      languages: undefined,
      start: menu({ en: "Clinic", fr: "Clinique" }, { Language: languageMenu({ languages: supported }), Hours: say("8 to 18") }),
    });
    expect((await t.sms(KENYA, "hi")).text).toBe("Clinic\n1. Language\n2. Hours");
    // Kenya's prior lists Swahili and English: English comes first, then French.
    expect((await t.sms(KENYA, "1")).text).toBe("Language / Langue\n1. English\n2. Français");
    expect((await t.sms(KENYA, "2")).text).toBe("Clinique\n1. Language\n2. Hours");
    expect(await t.sessions.load(KENYA)).toMatchObject({ locale: "fr", languageChosen: true });
  });

  it("runs a handler as its next step", async () => {
    const t = setup({
      languages: undefined,
      start: languageMenu({ languages: supported, then: (_input, ctx) => `locale is ${ctx.locale}` }),
    });
    await t.sms(KENYA, "hi");
    expect((await t.sms(KENYA, "2")).text).toBe("locale is fr");
  });

  it("uses the agent's languages when the step names none", async () => {
    const t = setup({ languages: { supported: [en, fr] }, start: menu("Clinic", { Language: languageMenu() }) });
    await t.sms(SENEGAL, "hi"); // first contact: the implicit menu, French first for Senegal
    await t.sms(SENEGAL, "1"); // chooses French
    const opened = await t.sms(SENEGAL, "1"); // opens the Language entry
    expect(opened.text).toBe("Langue / Language\n1. Français\n2. English");
  });
});

describe("startup checks", () => {
  const base = { start: say("hi"), channels: [ussdChannel()], logger: silentLogger };

  it("needs at least two languages", () => {
    expect(() => createAgent({ ...base, languages: { supported: [en] } })).toThrow(/at least two/);
  });

  it("refuses a language listed twice, or two with the same name", () => {
    expect(() => createAgent({ ...base, languages: { supported: [en, fr, { code: "en", name: "Other" }] } })).toThrow(/listed twice/);
    expect(() => createAgent({ ...base, languages: { supported: [en, { code: "fr", name: "English" }] } })).toThrow(/both called/);
  });

  it("refuses a language that has no messages", () => {
    expect(() => createAgent({ ...base, languages: { supported: [en, { code: "ha", name: "Hausa" }] } })).toThrow(/"ha" has no messages/);
  });

  it("accepts a language once messages are passed for it", () => {
    expect(() =>
      createAgent({ ...base, messages: { ha: { "common.yes": "yes-ha" } }, languages: { supported: [en, { code: "ha", name: "Hausa" }] } }),
    ).not.toThrow();
  });

  it("refuses a language menu in the tree with no languages anywhere", () => {
    expect(() => createAgent({ ...base, start: menu("m", { Language: languageMenu() }) })).toThrow(/needs `createAgent\(\{ languages \}\)`/);
  });

  it("checks the languages a menu in the tree names itself", () => {
    expect(() =>
      createAgent({ ...base, start: menu("m", { Language: languageMenu({ languages: [en, { code: "zz", name: "Zed" }] }) }) }),
    ).toThrow(/"zz" has no messages/);
  });
});
