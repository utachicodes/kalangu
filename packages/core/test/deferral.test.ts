import { setImmediate as flushIO } from "node:timers/promises";
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
  type BackgroundWork,
  type Clock,
  type Logger,
  type TurnContext,
} from "../src/index.js";

const PHONE = "+254700000001";

/** A clock whose timers only fire when the test advances it. */
function fakeClock() {
  let now = 1_000_000;
  let nextId = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const clock: Clock & { advance(ms: number): void; readonly pending: number } = {
    now: () => now,
    setTimeout: (fn, ms) => {
      const id = nextId++;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimeout: (id) => void timers.delete(id as number),
    advance(ms) {
      now += ms;
      for (const [id, timer] of [...timers]) {
        if (timer.at <= now) {
          timers.delete(id);
          timer.fn();
        }
      }
    },
    get pending() {
      return timers.size;
    },
  };
  return clock;
}

/** A promise the test resolves or rejects by hand. */
function controllable<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function trackedBackground(): BackgroundWork & { settle(): Promise<void>; count: number } {
  const tasks: Promise<void>[] = [];
  return {
    count: 0,
    run(task) {
      this.count += 1;
      tasks.push(task());
    },
    async settle() {
      await Promise.allSettled(tasks);
    },
  };
}

function recordingLogger() {
  const lines: Array<{ level: string; message: string; fields?: unknown }> = [];
  const at = (level: string) => (message: string, fields?: unknown) => lines.push({ level, message, fields });
  const logger: Logger = { debug: at("debug"), info: at("info"), warn: at("warn"), error: at("error") };
  return { logger, lines };
}

/** Lets pending promise callbacks and I/O callbacks run. */
const flush = async () => {
  for (let i = 0; i < 5; i++) await flushIO();
};

function setup(extra: Partial<AgentConfig> = {}) {
  const clock = fakeClock();
  const background = trackedBackground();
  const { logger, lines } = recordingLogger();
  const sent: Array<{ to: string; text: string }> = [];
  const model = { next: controllable<string>(), calls: 0 };
  const store = memoryStore();

  const start = menu("Clinic line", {
    "Opening hours": say("Open Monday to Saturday."),
    "Ask a nurse": ask("Type your question", async (q: string, ctx: TurnContext<typeof model>) => {
      ctx.model.calls += 1;
      ctx.session["lastQuestion"] = q;
      return ctx.model.next.promise;
    }),
  });

  const agent = createAgent({
    start,
    model,
    clock,
    background,
    logger,
    sessionStore: store,
    channels: [ussdChannel(), smsChannel({ send: async (out) => void sent.push(out) })],
    ...extra,
  });

  const dial = () => agent.handle({ channel: "ussd", phone: PHONE, input: "", newSession: true });
  const press = (input: string) => agent.handle({ channel: "ussd", phone: PHONE, input });
  const sms = (input: string) => agent.handle({ channel: "sms", phone: PHONE, input });

  /** Presses `input` and lets `ms` pass while the handler runs. */
  const pressAndWait = async (input: string, ms: number) => {
    const pending = press(input);
    await flush();
    clock.advance(ms);
    return pending;
  };

  return { agent, clock, background, lines, sent, model, store, dial, press, sms, pressAndWait };
}

describe("deadline", () => {
  it("never involves the deadline for fixed menus", async () => {
    const { dial, press, clock, model, background } = setup();
    await dial();
    expect(clock.pending).toBe(0);
    expect((await press("1")).text).toBe("Open Monday to Saturday.");
    expect(clock.pending).toBe(0);
    expect(model.calls).toBe(0);
    expect(background.count).toBe(0);
  });

  it("renders an answer that arrives in time on the USSD screen", async () => {
    const { dial, press, clock, model, sent, background } = setup();
    await dial();
    await press("2");
    const pending = press("Open on Sunday?");
    await flush();
    clock.advance(3000);
    model.next.resolve("Closed on Sundays.");
    expect(await pending).toEqual({ text: "Closed on Sundays.", end: true, stepId: null, deferred: false });
    expect(clock.pending).toBe(0);
    expect(sent).toHaveLength(0);
    expect(background.count).toBe(0);
  });

  it("ends with the notice at the deadline and sends exactly one SMS when the answer arrives", async () => {
    const { dial, press, pressAndWait, model, sent, background, store, lines } = setup();
    await dial();
    await press("2");

    const out = await pressAndWait("Open on Sunday?", 4000);
    expect(out).toEqual({
      text: "We are working on your question. You will receive an SMS shortly.",
      end: true,
      stepId: null,
      deferred: true,
    });
    expect((await store.load(PHONE))?.deferred).not.toBeNull();
    expect(sent).toHaveLength(0);

    model.next.resolve("The clinic is closed on Sundays.");
    await background.settle();

    expect(sent).toEqual([{ to: PHONE, text: "The clinic is closed on Sundays." }]);
    const record = await store.load(PHONE);
    expect(record).toMatchObject({ deferred: null, channel: "sms", data: { lastQuestion: "Open on Sunday?" } });
    expect(lines.some((l) => l.message === "Answer deferred to SMS")).toBe(true);
    expect(JSON.stringify(lines)).not.toContain(PHONE);
  });

  it("does not defer one millisecond early", async () => {
    const { dial, press, pressAndWait, model } = setup();
    await dial();
    await press("2");
    const pending = pressAndWait("q", 3999);
    await flush();
    model.next.resolve("in time");
    expect((await pending).deferred).toBe(false);
  });

  it("re-notices a redial while the answer is pending, then resumes normally", async () => {
    const { dial, press, pressAndWait, model, background } = setup();
    await dial();
    await press("2");
    await pressAndWait("q", 4000);

    expect(await dial()).toMatchObject({ deferred: true, end: true, text: expect.stringContaining("SMS shortly") });
    model.next.resolve("answer");
    await background.settle();
    expect((await dial()).text).toMatch(/^Clinic line/);
  });

  it("answers an SMS sent while the answer is pending with the notice", async () => {
    const { dial, press, pressAndWait, sms } = setup();
    await dial();
    await press("2");
    await pressAndWait("q", 4000);
    expect(await sms("hello?")).toMatchObject({ deferred: true, text: expect.stringContaining("SMS shortly") });
  });

  it("logs a late failure and sends one apology SMS", async () => {
    const { dial, press, pressAndWait, model, sent, background, lines, store } = setup();
    await dial();
    await press("2");
    await pressAndWait("q", 4000);

    model.next.reject(new Error("model timeout"));
    await background.settle();

    expect(sent).toEqual([{ to: PHONE, text: "Sorry, something went wrong. Please try again later." }]);
    expect(lines.find((l) => l.message === "Deferred answer failed")?.fields).toMatchObject({
      phone: "+254•••••0001",
      error: "Error: model timeout",
    });
    expect((await store.load(PHONE))?.deferred).toBeNull();
  });

  it("sends a late answer in the user's locale and keeps the SMS within budget", async () => {
    const { dial, press, pressAndWait, model, sent, background, lines } = setup();
    await dial();
    await press("2");
    await pressAndWait("q", 4000);
    model.next.resolve("x".repeat(2000));
    await background.settle();
    expect(sent).toEqual([{ to: PHONE, text: "Sorry, something went wrong. Please try again later." }]);
    expect(lines.find((l) => l.message === "Deferred answer failed")?.fields).toMatchObject({
      error: expect.stringContaining("segments"),
    });
  });

  it("does not use the deadline on SMS, where nobody is waiting on a screen", async () => {
    const { sms, clock, model, background } = setup();
    await sms("hi");
    await sms("2");
    const pending = sms("Open on Sunday?");
    await flush();
    expect(clock.pending).toBe(0);
    model.next.resolve("Closed on Sundays.");
    expect(await pending).toMatchObject({ text: "Closed on Sundays.", deferred: false });
    expect(background.count).toBe(0);
  });

  it("uses a configured deadline", async () => {
    const { dial, press, pressAndWait } = setup({ deadlineMs: 2000 });
    await dial();
    await press("2");
    expect((await pressAndWait("q", 2000)).deferred).toBe(true);
  });

  it("apologises at the deadline when no SMS channel can send", async () => {
    const clock = fakeClock();
    const { logger, lines } = recordingLogger();
    const slow = controllable<string>();
    const agent = createAgent({
      start: ask("Q?", () => slow.promise),
      channels: [ussdChannel()],
      clock,
      logger,
    });
    expect(lines.some((l) => l.message.startsWith("No SMS channel can send"))).toBe(true);
    await agent.handle({ channel: "ussd", phone: PHONE, input: "", newSession: true });
    const pending = agent.handle({ channel: "ussd", phone: PHONE, input: "x" });
    await flush();
    clock.advance(4000);
    expect(await pending).toMatchObject({ end: true, deferred: false, text: expect.stringContaining("Sorry") });
  });

  it("forgets a deferral that never completed after its time-to-live", async () => {
    const { dial, press, pressAndWait, clock } = setup();
    await dial();
    await press("2");
    await pressAndWait("q", 4000);
    clock.advance(16 * 60_000);
    expect((await dial()).text).toMatch(/^Clinic line/);
  });
});

describe("deadline configuration", () => {
  const base = { start: say("hi"), channels: [ussdChannel()] };

  it("refuses more than 10 seconds", () => {
    expect(() => createAgent({ ...base, deadlineMs: 10_001 })).toThrow(RangeError);
    expect(() => createAgent({ ...base, deadlineMs: 0 })).toThrow(RangeError);
  });

  it("warns above 8 seconds", () => {
    const { logger, lines } = recordingLogger();
    createAgent({ ...base, logger, deadlineMs: 9000 });
    expect(lines.some((l) => l.level === "warn" && l.message.includes("deadlineMs is 9000"))).toBe(true);
  });
});

describe("a late answer and what happened meanwhile", () => {
  /** A handler that writes to the session only after the deadline, when its answer arrives. */
  function lateWriter() {
    const answer = controllable<string>();
    const start = menu("Clinic line", {
      "Ask a nurse": ask("Type your question", async (_q: string, ctx: TurnContext) => {
        const text = await answer.promise;
        ctx.session["answer"] = text;
        return text;
      }),
    });
    return { answer, start };
  }

  it("keeps what was saved meanwhile and applies only what the late handler changed", async () => {
    const late = lateWriter();
    const { dial, press, pressAndWait, background, store, sent } = setup({ start: late.start });
    await dial();
    await press("1");
    expect((await pressAndWait("Open on Sunday?", 4000)).deferred).toBe(true);

    // Something else saves the session while the answer is pending, as a payment outcome would.
    const other = (await store.load(PHONE))!;
    other.data["paid"] = "yes";
    other.locale = "fr";
    await store.save(other);

    late.answer.resolve("Closed on Sundays.");
    await background.settle();
    expect(sent).toEqual([{ to: PHONE, text: "Closed on Sundays." }]);
    const record = await store.load(PHONE);
    expect(record?.data).toMatchObject({ paid: "yes", answer: "Closed on Sundays." });
    expect(record?.locale).toBe("fr");
    expect(record?.deferred).toBeNull();
  });

  it("keeps the place of a user who moved on after the deferral expired, and still sends the answer", async () => {
    const late = lateWriter();
    const { dial, press, pressAndWait, background, store, sent, clock } = setup({ start: late.start });
    await dial();
    await press("1");
    await pressAndWait("Open on Sunday?", 4000);
    clock.advance(16 * 60_000); // past the deferral's time-to-live
    expect((await dial()).text).toMatch(/^Clinic line/); // a new session, at the menu

    late.answer.resolve("Closed on Sundays.");
    await background.settle();
    expect(sent.map((m) => m.text)).toEqual(["Closed on Sundays."]);
    const record = await store.load(PHONE);
    expect(record?.turn).toMatchObject({ kind: "choose", question: "Clinic line" });
    expect(record?.data["answer"]).toBe("Closed on Sundays.");
    // The menu still answers.
    expect((await press("1")).text).toBe("Type your question");
  });
});
