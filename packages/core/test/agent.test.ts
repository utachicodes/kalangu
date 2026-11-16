import { describe, expect, it } from "vitest";
import {
  ask,
  confirm,
  createAgent,
  memoryStore,
  menu,
  say,
  smsChannel,
  ussdChannel,
  type AgentConfig,
  type Clock,
  type Logger,
  type Step,
  type TurnContext,
} from "../src/index.js";

const PHONE = "+254700000001";

function recordingLogger() {
  const lines: Array<{ level: string; message: string; fields?: unknown }> = [];
  const at = (level: string) => (message: string, fields?: unknown) => lines.push({ level, message, fields });
  const logger: Logger = { debug: at("debug"), info: at("info"), warn: at("warn"), error: at("error") };
  return { logger, lines };
}

function manualClock(start = 1_000_000): Clock & { advance(ms: number): void } {
  let now = start;
  return {
    now: () => now,
    setTimeout: () => 0,
    clearTimeout: () => {},
    advance(ms) {
      now += ms;
    },
  };
}

function setup(start: Step, extra: Partial<AgentConfig> = {}) {
  const { logger, lines } = recordingLogger();
  const clock = manualClock();
  const store = memoryStore();
  const agent = createAgent({
    start,
    channels: [ussdChannel(), smsChannel()],
    logger,
    clock,
    sessionStore: store,
    ...extra,
  });
  const dial = () => agent.handle({ channel: "ussd", phone: PHONE, input: "", newSession: true });
  const press = (input: string) => agent.handle({ channel: "ussd", phone: PHONE, input });
  const sms = (input: string) => agent.handle({ channel: "sms", phone: PHONE, input });
  return { agent, dial, press, sms, lines, clock, store };
}

const clinic = menu("Clinic line", {
  "Opening hours": say("Open Monday to Saturday, 8:00 to 18:00."),
  "Ask a nurse": ask("Type your question", (q) => `You asked: ${q}`),
  "Book a visit": confirm("Book for Monday?", {
    onYes: say("Booked for Monday."),
    onNo: () => "No booking made.",
  }),
});

describe("USSD menus", () => {
  it("shows the start menu on a fresh dial", async () => {
    const { dial } = setup(clinic);
    expect(await dial()).toEqual({
      text: "Clinic line\n1. Opening hours\n2. Ask a nurse\n3. Book a visit",
      end: false,
      stepId: "start",
      deferred: false,
    });
  });

  it("follows an option to a final screen and ends the session", async () => {
    const { dial, press } = setup(clinic);
    await dial();
    expect(await press("1")).toMatchObject({ text: "Open Monday to Saturday, 8:00 to 18:00.", end: true });
    // The next dial starts from the top, not the finished screen.
    expect((await dial()).text).toMatch(/^Clinic line/);
  });

  it("re-shows the menu with a notice on an invalid choice", async () => {
    const { dial, press } = setup(clinic);
    await dial();
    const out = await press("7");
    expect(out.end).toBe(false);
    expect(out.text).toBe("Invalid choice. Try again.\nClinic line\n1. Opening hours\n2. Ask a nurse\n3. Book a visit");
  });

  it("passes a typed answer to the ask handler", async () => {
    const { dial, press } = setup(clinic);
    await dial();
    expect(await press("2")).toMatchObject({ text: "Type your question", end: false, stepId: "start.2" });
    expect(await press("Is it open on Sunday?")).toMatchObject({ text: "You asked: Is it open on Sunday?", end: true });
  });

  it("asks again when an answer is empty", async () => {
    const { dial, press } = setup(clinic);
    await dial();
    await press("2");
    expect((await press("  ")).text).toBe("Please type an answer.\nType your question");
  });

  it("validates number answers", async () => {
    const age = ask("Your age?", (n) => `Age ${n}`, { input: "number" });
    const { dial, press } = setup(age);
    await dial();
    expect((await press("twelve")).text).toBe("Please enter a number.\nYour age?");
    expect((await press("12")).text).toBe("Age 12");
  });

  it("numbers confirm as 1/2 and routes yes and no", async () => {
    const { dial, press } = setup(clinic);
    await dial();
    expect((await press("3")).text).toBe("Book for Monday?\n1. Yes\n2. No");
    expect((await press("1")).text).toBe("Booked for Monday.");

    await dial();
    await press("3");
    expect((await press("2")).text).toBe("No booking made.");
  });

  it("pages through a long menu with 98 and keeps global numbering", async () => {
    const entries: Record<string, Step> = {};
    for (let i = 1; i <= 12; i++) entries[`Service number ${i} with a long name`] = say(`Picked ${i}`);
    const { dial, press } = setup(menu("Services", entries));

    const first = await dial();
    expect(first.text.length).toBeLessThanOrEqual(160);
    expect(first.text.endsWith("98. More")).toBe(true);

    const second = await press("98");
    expect(second.text).not.toContain("Services");
    expect(second.text.length).toBeLessThanOrEqual(160);
    const firstOnPage2 = second.text.split("\n")[0]?.split(".")[0];
    expect(Number(firstOnPage2)).toBeGreaterThan(1);

    expect((await press("12")).text).toBe("Picked 12");
  });

  it("pages through a long final message before ending", async () => {
    const long = say(Array.from({ length: 50 }, (_, i) => `word${i}`).join(" "));
    const { dial, press } = setup(long);
    const first = await dial();
    expect(first.end).toBe(false);
    expect(first.text.endsWith("98. More")).toBe(true);
    let out = first;
    while (!out.end) out = await press("98");
    expect(out.text).toContain("word49");
  });
});

describe("handlers", () => {
  it("goes back up to the menu above when a handler returns nothing", async () => {
    const start = menu("Main", {
      Settings: menu("Settings", { "Reset data": (_input: string, ctx: TurnContext) => void (ctx.session["n"] = 0) }),
    });
    const { dial, press } = setup(start);
    await dial();
    await press("1");
    expect((await press("1")).text).toBe("Main\n1. Settings");
  });

  it("shows a step a handler returns", async () => {
    const thanks = say("Thanks!");
    const start = ask("Name?", () => thanks);
    const { dial, press } = setup(start, { steps: [thanks] });
    await dial();
    expect(await press("Awa")).toMatchObject({ text: "Thanks!", end: true, stepId: "steps.0" });
  });

  it("refuses a step that is not part of the agent", async () => {
    const start = ask("Name?", () => say("Not registered"));
    const { dial, press, lines } = setup(start);
    await dial();
    const out = await press("Awa");
    expect(out).toMatchObject({ text: "Sorry, something went wrong. Please try again later.", end: true });
    expect(lines.find((l) => l.level === "error")?.fields).toMatchObject({
      error: expect.stringContaining("isn't part of the agent"),
    });
  });

  it("keeps session data between turns", async () => {
    const start = menu("Counter", {
      Add: (_input: string, ctx: TurnContext) => {
        ctx.session["count"] = ((ctx.session["count"] as number | undefined) ?? 0) + 1;
        return `Count: ${ctx.session["count"]}`;
      },
    });
    const { dial, press } = setup(start);
    await dial();
    expect((await press("1")).text).toBe("Count: 1");
    await dial();
    expect((await press("1")).text).toBe("Count: 2");
  });

  it("passes the model and context to handlers", async () => {
    const model = { answer: async (q: string) => `A: ${q}` };
    const start = ask("Q?", (q: string, ctx: TurnContext<typeof model>) => ctx.model.answer(q));
    const { dial, press } = setup(start, { model });
    await dial();
    expect((await press("hi")).text).toBe("A: hi");
  });

  it("answers with a localized apology and logs a masked number when a handler throws", async () => {
    const start = ask("Q?", () => {
      throw new Error("boom");
    });
    const { dial, press, lines } = setup(start);
    await dial();
    expect(await press("x")).toMatchObject({ text: "Sorry, something went wrong. Please try again later.", end: true });
    const error = lines.find((l) => l.level === "error");
    expect(error?.fields).toMatchObject({ phone: "+254•••••0001", error: "Error: boom" });
    expect(JSON.stringify(lines)).not.toContain(PHONE);
  });

  it("rejects a reply that is not a string, say turn, step or nothing", async () => {
    const start = ask("Q?", () => ({ kind: "ask", question: "?", input: "text" }) as never);
    const { dial, press } = setup(start);
    await dial();
    expect((await press("x")).end).toBe(true);
  });
});

describe("locales", () => {
  const start = menu({ en: "Main menu", fr: "Menu principal" }, [
    { label: { en: "Language", fr: "Langue" }, to: menu("Language", {
      English: (_i: string, ctx: TurnContext) => void (ctx.locale = "en"),
      "Français": (_i: string, ctx: TurnContext) => void (ctx.locale = "fr"),
    }) },
    { label: { en: "Hours", fr: "Horaires" }, to: say({ en: "Open at 8.", fr: "Ouvert à 8 h." }) },
  ]);

  it("switches locale, persists it, and makes USSD text safe", async () => {
    const { dial, press } = setup(start);
    expect((await dial()).text).toBe("Main menu\n1. Language\n2. Hours");
    expect((await press("1")).text).toBe("Language\n1. English\n2. Francais");
    expect((await press("2")).text).toBe("Menu principal\n1. Langue\n2. Horaires");
    expect((await press("2")).text).toBe("Ouvert a 8 h.");
    expect((await dial()).text).toMatch(/^Menu principal/);
  });

  it("localizes built-in messages", async () => {
    const { dial, press } = setup(start, { defaultLocale: "fr" });
    await dial();
    expect((await press("9")).text).toBe("Choix invalide. Reessayez.\nMenu principal\n1. Langue\n2. Horaires");
  });

  it("ignores an unknown locale with a warning", async () => {
    const s = menu("M", { Wolof: (_i: string, ctx: TurnContext) => void (ctx.locale = "wo") });
    const { dial, press, lines } = setup(s);
    await dial();
    await press("1");
    expect(lines.some((l) => l.level === "warn" && l.message === "Ignored unknown locale")).toBe(true);
  });

  it("accepts new locales through messages", async () => {
    const s = menu("M", { Wolof: (_i: string, ctx: TurnContext) => void (ctx.locale = "wo") });
    const { dial, press } = setup(s, { messages: { wo: { "common.invalidChoice": "Tànnéef bi baaxul." } } });
    await dial();
    await press("1");
    expect((await press("5")).text).toBe("Tanneef bi baaxul.\nM\n1. Wolof");
  });
});

describe("sessions", () => {
  it("resumes a dropped session on redial", async () => {
    const { dial, press, clock } = setup(clinic);
    await dial();
    await press("2");
    clock.advance(60_000);
    expect(await dial()).toMatchObject({ text: "Type your question", end: false });
  });

  it("starts over when the resume window has passed, keeping data and locale", async () => {
    const start = menu("M", {
      Remember: ask("Name?", (name: string, ctx: TurnContext) => {
        ctx.session["name"] = name;
        ctx.locale = "fr";
        return "ok";
      }),
      Recall: menu("R", { Show: (_i: string, ctx: TurnContext) => String(ctx.session["name"]) }),
    });
    const { dial, press, clock, store } = setup(start);
    await dial();
    await press("1");
    await press("Awa");
    await dial();
    await press("2");
    clock.advance(10 * 60_000);
    expect((await dial()).text).toBe("M\n1. Remember\n2. Recall");
    const record = await store.load(PHONE);
    expect(record).toMatchObject({ locale: "fr", data: { name: "Awa" } });
  });

  it("replays a dial string that carries choices", async () => {
    const { agent } = setup(clinic);
    const out = await agent.handle({
      channel: "ussd",
      phone: PHONE,
      input: "1",
      inputs: ["1"],
      gatewaySessionId: "ATUid_1",
    });
    expect(out).toMatchObject({ text: "Open Monday to Saturday, 8:00 to 18:00.", end: true });
  });

  it("treats a new gateway session as a fresh dial, not an answer to an old screen", async () => {
    const { agent } = setup(clinic);
    await agent.handle({ channel: "ussd", phone: PHONE, input: "", gatewaySessionId: "ATUid_1" });
    await agent.handle({ channel: "ussd", phone: PHONE, input: "2", inputs: ["2"], gatewaySessionId: "ATUid_1" });
    // Dropped while on "Type your question"; redialed with *384*1*3#.
    const out = await agent.handle({
      channel: "ussd",
      phone: PHONE,
      input: "3",
      inputs: ["3"],
      gatewaySessionId: "ATUid_2",
    });
    expect(out.text).toBe("Book for Monday?\n1. Yes\n2. No");
  });

  it("stops replaying once a screen ends the session", async () => {
    const { agent } = setup(clinic);
    const out = await agent.handle({
      channel: "ussd",
      phone: PHONE,
      input: "9",
      inputs: ["1", "9"],
      gatewaySessionId: "ATUid_1",
    });
    expect(out).toMatchObject({ text: "Open Monday to Saturday, 8:00 to 18:00.", end: true });
  });

  it("stores the gateway session id for correlation only", async () => {
    const { agent, store } = setup(clinic);
    await agent.handle({ channel: "ussd", phone: PHONE, input: "", newSession: true, gatewaySessionId: "ATUid_1" });
    expect((await store.load(PHONE))?.gatewaySessionId).toBe("ATUid_1");
  });
});

describe("SMS", () => {
  it("starts the menu on a first message and continues by number", async () => {
    const { sms } = setup(clinic);
    expect(await sms("hello")).toMatchObject({
      text: "Clinic line\n1. Opening hours\n2. Ask a nurse\n3. Book a visit",
      end: false,
    });
    expect(await sms("1")).toMatchObject({ text: "Open Monday to Saturday, 8:00 to 18:00.", end: true });
    expect((await sms("hi again")).text).toMatch(/^Clinic line/);
  });

  it("accepts an option label as well as its number", async () => {
    const { sms } = setup(clinic);
    await sms("hi");
    expect((await sms("opening hours")).text).toBe("Open Monday to Saturday, 8:00 to 18:00.");
  });

  it("asks yes/no in words and accepts localized replies", async () => {
    const { sms } = setup(clinic);
    await sms("hi");
    expect((await sms("3")).text).toBe("Book for Monday?\nReply YES or NO");
    expect((await sms("yes")).text).toBe("Booked for Monday.");
  });

  it("keeps accents on SMS", async () => {
    const { sms } = setup(menu("Menu", { Horaires: say("Ouvert à 8 h, fermé le dimanche.") }));
    await sms("hi");
    expect((await sms("1")).text).toBe("Ouvert à 8 h, fermé le dimanche.");
  });

  it("continues a question asked on USSD", async () => {
    const { dial, press, sms } = setup(clinic);
    await dial();
    await press("2");
    expect((await sms("Do you open on Sunday?")).text).toBe("You asked: Do you open on Sunday?");
  });

  it("apologises rather than sending a message over the segment cap", async () => {
    const { sms, lines } = setup(menu("M", { Long: say("x".repeat(1000)) }));
    await sms("hi");
    expect((await sms("1")).text).toBe("Sorry, something went wrong. Please try again later.");
    expect(lines.find((l) => l.level === "error")?.fields).toMatchObject({ error: expect.stringContaining("segments") });
  });
});

describe("agent setup and HTTP dispatch", () => {
  it("rejects duplicate channel ids", () => {
    expect(() => createAgent({ start: clinic, channels: [ussdChannel(), ussdChannel()] })).toThrow(/same id|share the id/);
  });

  it("rejects an unknown default locale", () => {
    expect(() => createAgent({ start: clinic, channels: [], defaultLocale: "wo" })).toThrow(/wo/);
  });

  it("dispatches requests to channel routes by pathname", async () => {
    const channel = ussdChannel({
      routes: [{ path: "/ussd", handle: async () => new Response("CON hi") }],
    });
    const agent = createAgent({ start: clinic, channels: [channel] });
    expect(await (await agent.requestHandler(new Request("http://x/ussd", { method: "POST" }))).text()).toBe("CON hi");
    expect(await (await agent.requestHandler(new Request("http://x/ussd/", { method: "POST" }))).text()).toBe("CON hi");
    expect((await agent.requestHandler(new Request("http://x/nope"))).status).toBe(404);
  });

  it("rebuilds with other channels while sharing the store", async () => {
    const { agent, store } = setup(clinic);
    const sim = agent.withChannels([ussdChannel({ id: "sim" })]);
    await sim.handle({ channel: "sim", phone: PHONE, input: "", newSession: true });
    expect((await store.load(PHONE))?.channel).toBe("sim");
    expect(sim.channel("ussd")).toBeUndefined();
  });

  it("fails loudly for an unknown channel id", async () => {
    const { agent } = setup(clinic);
    await expect(agent.handle({ channel: "fax", phone: PHONE, input: "" })).rejects.toThrow(/fax/);
  });
});
