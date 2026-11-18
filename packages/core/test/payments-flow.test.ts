import { describe, expect, it } from "vitest";
import {
  createAgent,
  en,
  fr,
  memoryPaymentStore,
  memoryStore,
  menu,
  pay,
  say,
  smsChannel,
  ussdChannel,
  type AgentConfig,
  type Clock,
  MAX_NOTIFY_ATTEMPTS,
  type InitiateResult,
  type Logger,
  type MessageKey,
  type PaymentProvider,
  type PaymentRecord,
  type PayTarget,
  type PaymentsConfig,
  type StatusResult,
} from "../src/index.js";

const PHONE = "+254700000001";

/** A clock whose timers fire when the test advances time. */
function timerClock(start = Date.now()) {
  let now = start;
  let nextId = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const clock: Clock = {
    now: () => now,
    setTimeout(fn, ms) {
      const id = nextId++;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimeout(handle) {
      timers.delete(handle as number);
    },
  };
  /** Moves time forward, firing due timers in order and letting their work run. */
  async function advance(ms: number) {
    const end = now + ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      now = Math.max(now, due[1].at);
      due[1].fn();
      await flush();
    }
    now = end;
    await flush();
  }
  return { clock, advance };
}

async function flush() {
  for (let i = 0; i < 20; i++) await new Promise<void>((resolve) => setImmediate(resolve));
}

function silent(): { logger: Logger; errors: string[] } {
  const errors: string[] = [];
  const noop = () => {};
  return { logger: { debug: noop, info: noop, warn: noop, error: (m) => void errors.push(m) }, errors };
}

interface FakeOptions {
  initiate?: () => Promise<InitiateResult>;
  resolve?: PaymentProvider["resolve"];
}

/** A provider whose status the test sets by hand. */
function controllableProvider(options: FakeOptions = {}) {
  const statuses = new Map<string, StatusResult>();
  const initiated: PaymentRecord[] = [];
  const provider: PaymentProvider = {
    id: "test",
    resolve:
      options.resolve ??
      (async (phone) => ({ provider: "TEST_MOMO", phone: phone.replace(/^\+/, ""), country: "KEN" })),
    async initiate(payment) {
      initiated.push(payment);
      return options.initiate ? options.initiate() : { status: "ACCEPTED" };
    },
    async status(id) {
      return statuses.get(id) ?? { found: true, status: "PROCESSING" };
    },
  };
  return { provider, initiated, set: (id: string, result: StatusResult) => statuses.set(id, result) };
}

function setup(
  options: {
    provider?: ReturnType<typeof controllableProvider>;
    payments?: Partial<PaymentsConfig>;
    amount?: string;
    agent?: Partial<AgentConfig>;
    /** While `on`, the SMS gateway fails every send. */
    failSends?: { on: boolean };
    onFailed?: PayTarget;
    onPaid?: Extract<PayTarget, (...args: never[]) => unknown>;
    /** Share these with an earlier agent to simulate a restart. */
    shared?: { store: ReturnType<typeof memoryPaymentStore>; sessions: ReturnType<typeof memoryStore>; clock: Clock };
  } = {},
) {
  const fake = options.provider ?? controllableProvider();
  const timers = timerClock();
  const clock = options.shared?.clock ?? timers.clock;
  const advance = timers.advance;
  const { logger, errors } = silent();
  const store = options.shared?.store ?? memoryPaymentStore();
  const sessions = options.shared?.sessions ?? memoryStore();
  const sent: Array<{ to: string; text: string }> = [];
  const paid: unknown[] = [];

  const consult = pay(
    { amount: options.amount ?? "500", currency: "KES", reason: { en: "Consultation", fr: "Consultation" } },
    {
      onPaid: (payment, ctx) => {
        paid.push(payment);
        return options.onPaid ? options.onPaid(payment, ctx) : "Paid. See you on Monday.";
      },
      onFailed: options.onFailed ?? ((payment) => `Payment not completed: ${payment.failureMessage}`),
      onDeclined: say("No problem."),
    },
  );
  const start = menu("Clinic", { "Pay consultation": consult, "Hours": say("8 to 18") });

  const agent = createAgent({
    start,
    channels: [
      ussdChannel(),
      smsChannel({
        send: async (out) => {
          if (options.failSends?.on) throw new Error("gateway down");
          sent.push({ to: out.to, text: out.text });
        },
      }),
    ],
    logger,
    clock,
    sessionStore: sessions,
    ...options.agent,
    payments: {
      provider: fake.provider,
      store,
      payeeName: "CLINIC",
      policy: { currencies: ["KES"], maxPerPayment: { KES: "5000" }, maxPerDayPerPhone: { KES: "10000" } },
      pollScheduleMs: [1000, 2000],
      pollRepeatMs: 2000,
      giveUpAfterMs: 20_000,
      newId: (() => {
        let n = 0;
        return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
      })(),
      ...options.payments,
    },
  });
  const dial = () => agent.handle({ channel: "ussd", phone: PHONE, input: "", newSession: true });
  const press = (input: string) => agent.handle({ channel: "ussd", phone: PHONE, input });
  const sms = (input: string) => agent.handle({ channel: "sms", phone: PHONE, input });
  return { agent, dial, press, sms, store, sessions, clock, sent, paid, advance, errors, fake };
}

async function toConfirm(t: ReturnType<typeof setup>) {
  await t.dial();
  return t.press("1");
}

describe("pay step", () => {
  it("shows a confirm with the payee from config, before anything is recorded", async () => {
    const t = setup();
    const out = await toConfirm(t);
    expect(out.text).toBe("Pay 500 KES to CLINIC for Consultation?\n1. Yes\n2. No");
    expect(out.end).toBe(false);
    expect(t.store.size).toBe(0);
    expect(t.fake.initiated).toHaveLength(0);
  });

  it("a stale Yes from an earlier turn starts no payment; the current one does", async () => {
    const t = setup();
    const sms = (input: string, turnId?: number) =>
      t.agent.handle({ channel: "sms", phone: PHONE, input, ...(turnId !== undefined ? { turnId } : {}) });
    const token = async () => (await t.sessions.load(PHONE))?.turnId;
    await sms("hi"); // the menu
    const menuToken = await token();
    await sms("1"); // the pay confirm
    const confirmToken = await token();

    const stale = await sms("1", menuToken); // a tap on the old menu's "Pay consultation", read as Yes
    expect(stale.text).toContain("That choice has expired.");
    expect(stale.text).toContain("Pay 500 KES to CLINIC for Consultation?");
    await flush();
    expect(t.store.size).toBe(0);
    expect(t.fake.initiated).toHaveLength(0);

    const fresh = await sms("1", confirmToken);
    expect(fresh.text).toBe("You will receive a prompt to enter your PIN.");
    await flush();
    expect(t.store.size).toBe(1);
  });

  it("two simultaneous selections cannot make a Yes on one confirmation pay the other's amount", async () => {
    const fake = controllableProvider();
    const { clock } = timerClock();
    const { logger } = silent();
    const sessions = memoryStore();
    const store = memoryPaymentStore();
    const renders: Array<{ text: string; id: number | undefined }> = [];
    const base = smsChannel({ id: "sms", send: async () => {} });
    const channel = {
      ...base,
      render(turn: Parameters<typeof base.render>[0], ctx: Parameters<typeof base.render>[1]) {
        const out = base.render(turn, ctx);
        if (turn.kind === "confirm") renders.push({ text: out.text, id: ctx.turnId });
        return out;
      },
    };
    const outcomes = { onPaid: say("paid"), onFailed: say("failed"), onDeclined: say("no") };
    const agent = createAgent({
      start: menu("Fees", {
        Small: pay({ amount: "500", currency: "KES" }, outcomes),
        Big: pay({ amount: "1000", currency: "KES" }, outcomes),
      }),
      channels: [channel],
      logger,
      clock,
      sessionStore: sessions,
      payments: { provider: fake.provider, store, payeeName: "CLINIC", policy: { currencies: ["KES"], maxPerPayment: { KES: "5000" } } },
    });
    await agent.handle({ channel: "sms", phone: PHONE, input: "hi" });

    // Both selections read the menu session before either saves.
    const realLoad = sessions.load.bind(sessions);
    const waiting: Array<() => void> = [];
    sessions.load = async (phone) => {
      const record = await realLoad(phone);
      await new Promise<void>((resolve) => {
        waiting.push(resolve);
        if (waiting.length === 2) waiting.forEach((release) => release());
      });
      return record;
    };
    await Promise.all([
      agent.handle({ channel: "sms", phone: PHONE, input: "1" }),
      agent.handle({ channel: "sms", phone: PHONE, input: "2" }),
    ]);
    sessions.load = realLoad;

    expect(renders).toHaveLength(2);
    expect(renders[0]!.id).not.toBe(renders[1]!.id); // each confirmation has its own token
    const current = (await sessions.load(PHONE))!.turnId;
    const winner = renders.find((r) => r.id === current)!;
    const loser = renders.find((r) => r.id !== current)!;

    // A Yes on the confirmation the session no longer shows is refused and charges nothing.
    const refused = await agent.handle({ channel: "sms", phone: PHONE, input: "1", turnId: loser.id! });
    expect(refused.text).toContain("That choice has expired.");
    await flush();
    expect(store.size).toBe(0);

    // A Yes on the one it does show pays exactly the amount that confirmation named.
    await agent.handle({ channel: "sms", phone: PHONE, input: "1", turnId: winner.id! });
    await flush();
    const payment = fake.initiated[0]!;
    expect(winner.text).toContain(`Pay ${Number(payment.amount)} KES`);
    expect(loser.text).not.toContain(`Pay ${Number(payment.amount)} KES`);
  });

  it("declining runs onDeclined and records nothing", async () => {
    const t = setup();
    await toConfirm(t);
    expect(await t.press("2")).toMatchObject({ text: "No problem.", end: true });
    expect(t.store.size).toBe(0);
  });

  it("Yes ends the USSD session first, then initiates in the background", async () => {
    const t = setup();
    await toConfirm(t);
    const out = await t.press("1");
    expect(out).toMatchObject({ text: "You will receive a prompt to enter your PIN.", end: true });
    await flush();
    expect(t.fake.initiated).toHaveLength(1);
    expect(t.fake.initiated[0]).toMatchObject({
      phone: PHONE,
      amount: "500.00",
      currency: "KES",
      reason: "Consultation",
      provider: "TEST_MOMO",
      status: "CREATED",
    });
    expect((await t.store.get(t.fake.initiated[0]!.id))?.status).toBe("ACCEPTED");
  });

  it("sends onPaid and a receipt by SMS when polling finds COMPLETED, exactly once", async () => {
    const t = setup();
    await toConfirm(t);
    await t.press("1");
    await flush();
    const id = t.fake.initiated[0]!.id;
    t.fake.set(id, { found: true, status: "COMPLETED" });

    await t.advance(1000);
    expect(t.sent.map((m) => m.text)).toEqual([
      "Paid. See you on Monday.",
      "Receipt: 500.00 KES paid to CLINIC. Ref 00000000.",
    ]);
    expect(t.sent.every((m) => m.to === PHONE)).toBe(true);
    expect((await t.store.get(id))?.status).toBe("COMPLETED");

    // A late duplicate callback must not notify again.
    await t.agent.payments?.settle(id);
    await t.advance(10_000);
    expect(t.sent).toHaveLength(2);
  });

  it("a callback settles through check-status, not the callback body", async () => {
    const t = setup();
    await toConfirm(t);
    await t.press("1");
    await flush();
    const id = t.fake.initiated[0]!.id;

    // Provider still says PROCESSING: a callback claiming success changes nothing.
    await t.agent.payments?.settle(id);
    expect((await t.store.get(id))?.status).toBe("PROCESSING");
    expect(t.sent).toHaveLength(0);

    t.fake.set(id, { found: true, status: "COMPLETED" });
    await t.agent.payments?.settle(id);
    expect((await t.store.get(id))?.status).toBe("COMPLETED");
    expect(t.sent[0]?.text).toBe("Paid. See you on Monday.");
  });

  it("failure goes to onFailed with a readable reason, never the provider code", async () => {
    const t = setup({ provider: controllableProvider({ initiate: async () => ({ status: "REJECTED", failureCode: "PAYER_LIMIT_REACHED" }) }) });
    await toConfirm(t);
    await t.press("1");
    await flush();
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0]?.text).toBe("Payment not completed: The payment was not completed. Nothing was charged.");
    expect(t.sent[0]?.text).not.toContain("PAYER_LIMIT");
    const stored = await t.store.get(t.fake.initiated[0]!.id);
    expect(stored).toMatchObject({ status: "REJECTED", failureCode: "PAYER_LIMIT_REACHED" });
  });

  it("an unknown initiate outcome is never failed on a guess: it keeps polling", async () => {
    const t = setup({
      provider: controllableProvider({
        initiate: async () => {
          throw new Error("socket hang up");
        },
      }),
    });
    await toConfirm(t);
    await t.press("1");
    await flush();
    const id = t.fake.initiated[0]!.id;
    expect((await t.store.get(id))?.status).toBe("UNKNOWN");
    expect(t.sent).toHaveLength(0);

    t.fake.set(id, { found: true, status: "COMPLETED" });
    await t.advance(1000);
    expect(t.sent[0]?.text).toBe("Paid. See you on Monday.");
  });

  it("gives up as UNRESOLVED after the window and tells the user to contact the payee", async () => {
    const t = setup();
    await toConfirm(t);
    await t.press("1");
    await flush();
    const id = t.fake.initiated[0]!.id;
    await t.advance(25_000);
    expect((await t.store.get(id))?.status).toBe("UNRESOLVED");
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0]?.text).toContain("Please contact CLINIC before paying again");
    expect(t.errors.some((e) => e.includes("unresolved"))).toBe(true);
  });

  it("refuses above the per-payment limit before any confirm screen", async () => {
    const t = setup({ amount: "5000.01" });
    await t.dial();
    const out = await t.press("1");
    expect(out.text).toContain("Payment not completed: Sorry, this payment cannot be made. This payment is above the allowed limit.");
    expect(out.text).not.toContain("1. Yes");
    expect(t.store.size).toBe(0);
  });

  it("refuses when the operator is unknown", async () => {
    const t = setup({
      provider: controllableProvider({ resolve: async () => ({ kind: "unknown-operator", message: "We could not find your operator." }) }),
    });
    await t.dial();
    const out = await t.press("1");
    expect(out.text).toContain("We could not identify your mobile money operator.");
    expect(out.text).not.toContain("We could not find your operator."); // the provider's English is for logs
    expect(t.store.size).toBe(0);
  });

  it("shows policy refusals in the user's language", async () => {
    const t = setup({ amount: "5000.01", agent: { defaultLocale: "fr" } });
    await t.dial();
    const out = await t.press("1");
    // USSD transliterates accents to stay within the safe character set.
    expect(out.text).toContain("Desole, ce paiement ne peut pas etre effectue. Ce paiement depasse la limite autorisee.");
    expect(out.text).not.toContain("allowed limit");
  });

  it("names the currency in a currency refusal", async () => {
    const t = setup({ payments: { policy: { currencies: ["XOF"], maxPerPayment: { XOF: "100000" } } } });
    await t.dial();
    expect((await t.press("1")).text).toContain("Payments in KES are not accepted.");
  });

  it("lets the developer override a refusal message", async () => {
    const t = setup({
      amount: "5000.01",
      agent: { messages: { en: { "payments.refusal.per-payment": "Too much for one visit." } } },
    });
    await t.dial();
    expect((await t.press("1")).text).toContain("Sorry, this payment cannot be made. Too much for one visit.");
  });

  it("has an English and a French message for every refusal reason", () => {
    const reasons = ["currency", "per-payment", "per-day", "pending-limit", "provider-closed", "amount-bounds", "decimals", "unknown-operator"];
    for (const messages of [en, fr]) {
      for (const reason of reasons) {
        expect(messages[`payments.refusal.${reason}` as MessageKey], reason).toBeTruthy();
      }
    }
  });

  it("allows one payment in flight per phone by default", async () => {
    const t = setup();
    await toConfirm(t);
    await t.press("1");
    await flush();
    await t.dial();
    const out = await t.press("1");
    expect(out.text).toContain("You already have a payment in progress");
    expect(t.fake.initiated).toHaveLength(1);
  });

  it("counts pending payments toward the daily limit", async () => {
    const t = setup({ amount: "5000", payments: { policy: { currencies: ["KES"], maxPerPayment: { KES: "5000" }, maxPerDayPerPhone: { KES: "6000" }, maxPendingPerPhone: 5 } } });
    await toConfirm(t);
    await t.press("1");
    await flush();
    await t.dial();
    expect((await t.press("1")).text).toContain("daily payment limit");
  });
});

describe("pay configuration", () => {
  it("refuses a session store that cannot do compare-and-set", () => {
    const { provider } = controllableProvider();
    const plain = { ...memoryStore(), atomic: false };
    expect(() =>
      createAgent({
        start: say("hi"),
        channels: [ussdChannel()],
        sessionStore: plain,
        payments: { provider, store: memoryPaymentStore(), payeeName: "X", policy: { currencies: ["KES"], maxPerPayment: { KES: "100" } } },
      }),
    ).toThrow(/compare|atomic/i);
  });

  const base = { start: say("hi"), channels: [ussdChannel()] };
  const step = pay({ amount: "5", currency: "KES" }, { onPaid: say("ok"), onFailed: say("no"), onDeclined: say("bye") });

  it("fails at startup when a pay step has no payments config", () => {
    expect(() => createAgent({ start: menu("m", { Pay: step }), channels: [ussdChannel()] })).toThrow(/pay step/);
  });

  it("fails at startup without a policy", () => {
    const { provider } = controllableProvider();
    expect(() =>
      createAgent({ ...base, payments: { provider, store: memoryPaymentStore(), payeeName: "X" } as unknown as PaymentsConfig }),
    ).toThrow(/policy/);
  });

  it("requires a per-payment cap for every accepted currency", () => {
    const { provider } = controllableProvider();
    expect(() =>
      createAgent({
        ...base,
        payments: { provider, store: memoryPaymentStore(), payeeName: "X", policy: { currencies: ["KES", "XOF"], maxPerPayment: { KES: "100" } } },
      }),
    ).toThrow(/XOF/);
  });

  it("rejects a non-decimal limit", () => {
    const { provider } = controllableProvider();
    expect(() =>
      createAgent({
        ...base,
        payments: { provider, store: memoryPaymentStore(), payeeName: "X", policy: { currencies: ["KES"], maxPerPayment: { KES: "5e3" } } },
      }),
    ).toThrow(/decimal string/);
  });
});

describe("reconcile", () => {
  /** A new process: same stores and provider, none of the old process's timers. */
  function restart(old: ReturnType<typeof setup>) {
    const frozen: Clock = { now: () => old.clock.now(), setTimeout: () => 0, clearTimeout: () => {} };
    return setup({ provider: old.fake, shared: { store: old.store, sessions: old.sessions, clock: frozen } });
  }

  /** Starts a payment, then "restarts": the returned agent has no polling for it. */
  async function started() {
    const first = setup();
    await toConfirm(first);
    await first.press("1");
    await flush();
    const id = first.fake.initiated[0]!.id;
    return { first, id, second: restart(first) };
  }

  const record = (id: string, now: number, extra: Partial<PaymentRecord> = {}): PaymentRecord => ({
    id, phone: PHONE, provider: "TEST_MOMO", providerPhone: "254700000001", amount: "500.00", currency: "KES", reason: "Consultation",
    stepId: "start.1", locale: "en", status: "CREATED", createdAt: now, updatedAt: now, ...extra,
  });

  it("finishes a payment whose polling died with the old process, and tells the user", async () => {
    const { first, id, second } = await started();
    first.fake.set(id, { found: true, status: "COMPLETED" });

    const report = await second.agent.payments!.reconcile({ minAgeMs: 0 });
    expect(report).toEqual({ checked: 1, completed: 1, failed: 0, unresolved: 0, stillPending: 0, redelivered: 0, errors: 0 });
    expect(second.sent.map((m) => m.text)).toEqual([
      "Paid. See you on Monday.",
      "Receipt: 500.00 KES paid to CLINIC. Ref 00000000.",
    ]);
  });

  it("is safe to run twice: the outcome is sent once", async () => {
    const { first, id, second } = await started();
    first.fake.set(id, { found: true, status: "COMPLETED" });
    await second.agent.payments!.reconcile({ minAgeMs: 0 });
    const again = await second.agent.payments!.reconcile({ minAgeMs: 0 });
    expect(again.checked).toBe(0); // Final payments are no longer pending.
    expect(second.sent).toHaveLength(2);
  });

  it("leaves a payment still processing alone", async () => {
    const { second } = await started();
    const report = await second.agent.payments!.reconcile({ minAgeMs: 0 });
    expect(report).toMatchObject({ checked: 1, stillPending: 1 });
    expect(second.sent).toHaveLength(0);
  });

  it("skips payments younger than minAgeMs", async () => {
    const { second } = await started();
    expect(await second.agent.payments!.reconcile()).toMatchObject({ checked: 0 }); // default 30 s
  });

  it("re-initiates a payment recorded but never initiated, while it is fresh", async () => {
    const t = setup();
    const now = t.clock.now();
    await t.store.create(record("fresh", now - 5000));
    t.fake.set("fresh", { found: false });

    const report = await t.agent.payments!.reconcile({ minAgeMs: 0 });
    expect(t.fake.initiated.map((p) => p.id)).toEqual(["fresh"]);
    expect(report).toMatchObject({ checked: 1, stillPending: 1 });
    expect((await t.store.get("fresh"))?.status).toBe("ACCEPTED");
  });

  it("fails an old never-initiated payment as not started, with nothing charged", async () => {
    const t = setup();
    const now = t.clock.now();
    await t.store.create(record("old", now - 3_600_000));
    t.fake.set("old", { found: false });

    const report = await t.agent.payments!.reconcile({ minAgeMs: 0 });
    expect(t.fake.initiated).toHaveLength(0);
    expect(report).toMatchObject({ checked: 1, failed: 1 });
    expect(await t.store.get("old")).toMatchObject({ status: "FAILED", failureCode: "NOT_FOUND" });
    expect(t.sent[0]?.text).toContain("Nothing was charged");
  });

  it("marks a payment UNRESOLVED once it is older than the give-up window", async () => {
    const t = setup(); // giveUpAfterMs is 20 s here
    const now = t.clock.now();
    await t.store.create(record("ancient", now - 60_000, { status: "PROCESSING" }));

    const report = await t.agent.payments!.reconcile({ minAgeMs: 0 });
    expect(report).toMatchObject({ checked: 1, unresolved: 1 });
    expect((await t.store.get("ancient"))?.status).toBe("UNRESOLVED");
    expect(t.sent[0]?.text).toContain("contact CLINIC");
  });

  it("counts a failing check as an error and carries on with the rest", async () => {
    const t = setup();
    const now = t.clock.now();
    await t.store.create(record("a", now - 5000, { status: "PROCESSING" }));
    await t.store.create(record("b", now - 5000, { status: "PROCESSING" }));
    const real = t.fake.provider.status;
    t.fake.provider.status = async (id) => {
      if (id === "a") throw new Error("provider down");
      return real(id);
    };
    t.fake.set("b", { found: true, status: "COMPLETED" });

    const report = await t.agent.payments!.reconcile({ minAgeMs: 0 });
    expect(report).toMatchObject({ checked: 2, completed: 1, errors: 1 });
    expect((await t.store.get("a"))?.status).toBe("PROCESSING"); // retried next sweep
  });
});

describe("two processes sharing one store", () => {
  function twoProcesses() {
    const first = setup({ payments: { policy: { currencies: ["KES"], maxPerPayment: { KES: "5000" }, maxPendingPerPhone: 1 } } });
    const frozen: Clock = { now: () => first.clock.now(), setTimeout: () => 0, clearTimeout: () => {} };
    const second = setup({ provider: first.fake, shared: { store: first.store, sessions: first.sessions, clock: frozen } });
    return { first, second };
  }

  it("notifies once when both processes deliver the same finished-but-unannounced payment", async () => {
    const { first, second } = twoProcesses();
    const now = first.clock.now();
    // Final in the store, outcome never sent: e.g. the process died right after the status landed.
    await first.store.create({
      id: "done", phone: PHONE, provider: "TEST_MOMO", providerPhone: "254700000001", amount: "500.00", currency: "KES", reason: "Consultation",
      stepId: "start.1", locale: "en", status: "COMPLETED", createdAt: now - 1000, updatedAt: now - 1000,
    });
    await Promise.all([first.agent.payments!.settle("done"), second.agent.payments!.settle("done")]);
    await flush();
    expect(first.sent.length + second.sent.length).toBe(2); // the outcome and the receipt, once
  });

  it("notifies once when both processes see the final status at the same time", async () => {
    const { first, second } = twoProcesses();
    await toConfirm(first);
    await first.press("1");
    await flush();
    const id = first.fake.initiated[0]!.id;
    first.fake.set(id, { found: true, status: "COMPLETED" });
    await Promise.all([first.agent.payments!.settle(id), second.agent.payments!.settle(id)]);
    await flush();
    expect(first.sent.length + second.sent.length).toBe(2);
  });

  it("starts one payment when two Yes answers race past the limit check", async () => {
    const first = setup();
    // Slow the limit check so both answers are inside it at once; without a lock both pass.
    const real = first.store.totals.bind(first.store);
    first.store.totals = async (...args) => {
      const result = await real(...args);
      await new Promise((resolve) => setTimeout(resolve, 10));
      return result;
    };
    await first.dial();
    await first.press("1");
    // Same session copy answered twice at once, e.g. a double-tapped Yes on SMS.
    const record = await first.sessions.load(PHONE);
    const second = setup({
      provider: first.fake,
      shared: { store: first.store, sessions: first.sessions, clock: first.clock },
      payments: { newId: () => "ffffffff-0000-4000-8000-000000000002" }, // distinct from the first process's ids
    });
    await Promise.all([first.press("1"), (async () => { await first.sessions.save(record!); return second.press("1"); })()]);
    await flush();
    expect(first.store.size).toBe(1);
    expect(first.fake.initiated).toHaveLength(1);
  });

  it("a double-tapped Yes starts one payment even when several are allowed in flight", async () => {
    const policy = { currencies: ["KES"], maxPerPayment: { KES: "5000" }, maxPendingPerPhone: 5 };
    const first = setup({ payments: { policy } });
    const second = setup({
      provider: first.fake,
      shared: { store: first.store, sessions: first.sessions, clock: first.clock },
      payments: { policy, newId: () => "ffffffff-0000-4000-8000-000000000002" },
    });
    await first.dial();
    await first.press("1"); // the confirm screen is showing

    // Both Yes requests read the stored session before either of them writes.
    const realLoad = first.sessions.load.bind(first.sessions);
    const waiting: Array<() => void> = [];
    first.sessions.load = async (phone) => {
      const record = await realLoad(phone);
      await new Promise<void>((resolve) => {
        waiting.push(resolve);
        if (waiting.length === 2) waiting.forEach((release) => release());
      });
      return record;
    };
    const [a, b] = await Promise.all([first.press("1"), second.press("1")]);
    first.sessions.load = realLoad;
    await flush();

    expect(first.store.size).toBe(1);
    expect(first.fake.initiated).toHaveLength(1);
    expect([a.text, b.text].sort()).toEqual([
      "You will receive a prompt to enter your PIN.",
      "Your payment is already being processed.",
    ]);
  });

  it("never lets a stale status read overwrite a final one", async () => {
    const { first } = twoProcesses();
    await toConfirm(first);
    await first.press("1");
    await flush();
    const id = first.fake.initiated[0]!.id;

    // This process asks the provider and is slow to get the answer, which is already out of date.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    first.fake.provider.status = async () => {
      await gate;
      return { found: true, status: "IN_RECONCILIATION" };
    };
    const stale = first.agent.payments!.settle(id);
    await flush();

    // Meanwhile another process records the real outcome.
    await first.store.transition(id, { status: "COMPLETED", finalizedAt: Date.now() }, ["ACCEPTED", "PROCESSING"]);
    release();
    await stale;
    expect((await first.store.get(id))?.status).toBe("COMPLETED");
  });
});

describe("review fixes", () => {
  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

  it("stores the provider's destination number on the payment", async () => {
    const t = setup();
    await toConfirm(t);
    await t.press("1");
    await flush();
    expect(await t.store.get(t.fake.initiated[0]!.id)).toMatchObject({ providerPhone: "254700000001" });
  });

  describe("an outcome that could not be delivered", () => {
    it("is released, retried by reconcile, and delivered once", async () => {
      const failSends = { on: true };
      const t = setup({ failSends });
      await toConfirm(t);
      await t.press("1");
      await flush();
      const id = t.fake.initiated[0]!.id;
      t.fake.set(id, { found: true, status: "COMPLETED" });
      await t.advance(1000); // the poll finds COMPLETED; sending retries at +1 s and +5 s, then fails
      await t.advance(6000);

      expect(t.sent).toHaveLength(0);
      const stuck = await t.store.get(id);
      expect(stuck).toMatchObject({ status: "COMPLETED", notifyAttempts: 1 });
      expect(stuck?.notifiedAt).toBeUndefined();
      expect(t.errors.some((e) => e.includes("reconcile will retry"))).toBe(true);

      failSends.on = false;
      const report = await t.agent.payments!.reconcile({ minAgeMs: 0 });
      expect(report).toMatchObject({ redelivered: 1, errors: 0 });
      expect(t.sent.map((m) => m.text)).toEqual([
        "Paid. See you on Monday.",
        "Receipt: 500.00 KES paid to CLINIC. Ref 00000000.",
      ]);
      // onPaid ran once: the retry resent its message without running it again.
      expect(t.paid).toHaveLength(1);
      // Delivered now: a second sweep sends nothing more.
      expect((await t.agent.payments!.reconcile({ minAgeMs: 0 })).redelivered).toBe(0);
      expect(t.sent).toHaveLength(2);
    });

    it("stops retrying after the attempt limit and leaves it for a human", async () => {
      const t = setup();
      const now = t.clock.now();
      await t.store.create({
        id: "stuck", phone: PHONE, provider: "TEST_MOMO", providerPhone: "254700000001", amount: "500.00", currency: "KES",
        reason: "Consultation", stepId: "start.1", locale: "en", status: "COMPLETED",
        createdAt: now - 10_000, updatedAt: now - 10_000, finalizedAt: now - 10_000, notifyAttempts: MAX_NOTIFY_ATTEMPTS,
      });
      const report = await t.agent.payments!.reconcile({ minAgeMs: 0 });
      expect(report.redelivered).toBe(0);
      expect(t.sent).toHaveLength(0);
    });
  });

  it("keeps the outcome's session when the provider rejects before the turn is saved", async () => {
    const t = setup({
      provider: controllableProvider({ initiate: async () => ({ status: "REJECTED", failureCode: "X" }) }),
      onFailed: menu("Try again?", { Retry: say("ok") }),
    });
    await toConfirm(t);
    // Slow only the turn's own final save, the second one (the first is the offer's claim), so the
    // outcome would be written first and then clobbered if delivery did not wait for it.
    const real = t.sessions.save.bind(t.sessions);
    let saves = 0;
    t.sessions.save = async (record, options) => {
      saves++;
      if (saves === 2) await sleep(30);
      return real(record, options);
    };
    await t.press("1");
    await sleep(80);
    await flush();
    expect(t.sent[0]?.text).toContain("Try again?");
    expect((await t.sessions.load(PHONE))?.turn?.kind).toBe("choose");
  });

  it("gives up on a payment whose status check keeps failing", async () => {
    const t = setup(); // giveUpAfterMs is 20 s
    const now = t.clock.now();
    await t.store.create({
      id: "down", phone: PHONE, provider: "TEST_MOMO", providerPhone: "254700000001", amount: "500.00", currency: "KES",
      reason: "Consultation", stepId: "start.1", locale: "en", status: "PROCESSING", createdAt: now - 60_000, updatedAt: now - 60_000,
    });
    t.fake.provider.status = async () => {
      throw new Error("provider down");
    };
    const report = await t.agent.payments!.reconcile({ minAgeMs: 0 });
    expect(report).toMatchObject({ checked: 1, unresolved: 1, errors: 1 });
    expect((await t.store.get("down"))?.status).toBe("UNRESOLVED");
    expect(t.sent[0]?.text).toContain("contact CLINIC");
  });

  it("does not give up on a young payment just because a check failed", async () => {
    const t = setup();
    const now = t.clock.now();
    await t.store.create({
      id: "young", phone: PHONE, provider: "TEST_MOMO", providerPhone: "254700000001", amount: "500.00", currency: "KES",
      reason: "Consultation", stepId: "start.1", locale: "en", status: "PROCESSING", createdAt: now - 5000, updatedAt: now - 5000,
    });
    t.fake.provider.status = async () => {
      throw new Error("provider down");
    };
    expect(await t.agent.payments!.reconcile({ minAgeMs: 0 })).toMatchObject({ unresolved: 0, errors: 1 });
    expect((await t.store.get("young"))?.status).toBe("PROCESSING");
  });

  it("does not fail a payment as not found when another process has since seen it", async () => {
    const t = setup();
    const now = t.clock.now();
    await t.store.create({
      id: "race", phone: PHONE, provider: "TEST_MOMO", providerPhone: "254700000001", amount: "500.00", currency: "KES",
      reason: "Consultation", stepId: "start.1", locale: "en", status: "UNKNOWN", createdAt: now - 5000, updatedAt: now - 5000,
    });
    // This process asks the provider and is slow to hear that it has never seen the payment.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    t.fake.provider.status = async () => {
      await gate;
      return { found: false };
    };
    const slow = t.agent.payments!.settle("race");
    await flush();
    // Meanwhile another process learns the provider has it.
    await t.store.transition("race", { status: "PROCESSING" }, ["UNKNOWN"]);
    release();
    await slow;
    expect((await t.store.get("race"))?.status).toBe("PROCESSING");
    expect(t.sent).toHaveLength(0);
  });

  it("uses pollRepeatMs once the schedule is used up", async () => {
    const t = setup({ payments: { pollScheduleMs: [1000], pollRepeatMs: 50_000, giveUpAfterMs: 500_000 } });
    await toConfirm(t);
    await t.press("1");
    await flush();
    const id = t.fake.initiated[0]!.id;
    await t.advance(1000); // the one scheduled check: still processing
    t.fake.set(id, { found: true, status: "COMPLETED" });
    await t.advance(10_000); // an old build would have checked again 1 s after the schedule's end
    expect(t.sent).toHaveLength(0);
    await t.advance(50_000);
    expect(t.sent[0]?.text).toBe("Paid. See you on Monday.");
  });

  it("ends with a message when a root pay step is refused and its handler returns nothing", async () => {
    const fake = controllableProvider();
    const { clock } = timerClock();
    const { logger } = silent();
    const root = pay(
      { amount: "5000.01", currency: "KES" },
      { onPaid: say("ok"), onFailed: () => undefined, onDeclined: say("bye") },
    );
    const agent = createAgent({
      start: root,
      channels: [ussdChannel(), smsChannel({ send: async () => {} })],
      logger,
      clock,
      payments: { provider: fake.provider, store: memoryPaymentStore(), payeeName: "CLINIC", policy: { currencies: ["KES"], maxPerPayment: { KES: "5000" } } },
    });
    // Going back to "the menu above" would be this same pay step again, forever.
    const out = await Promise.race([
      agent.handle({ channel: "ussd", phone: PHONE, input: "", newSession: true }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("looped")), 1500)),
    ]);
    expect(out.text).toBe("Sorry, this payment cannot be made. This payment is above the allowed limit.");
    expect(out.end).toBe(true);
  });

  it("tells the user to try later when looking up the operator misses the USSD deadline", async () => {
    const t = setup({ provider: controllableProvider({ resolve: () => new Promise(() => {}) }) });
    await t.dial();
    const pending = t.press("1");
    await flush();
    await t.advance(5000); // past the 4 s deadline
    const out = await pending;
    expect(out.text).toBe("Payments are unavailable right now. Nothing was charged. Please try again later.");
    expect(out.end).toBe(true);
    expect(t.store.size).toBe(0);
    expect((await t.sessions.load(PHONE))?.payIntent ?? null).toBeNull();
  });

  it("does not apply the deadline to SMS, where nobody is waiting on a live session", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const t = setup({
      provider: controllableProvider({
        resolve: async (phone) => {
          await gate;
          return { provider: "TEST_MOMO", phone: phone.replace(/^\+/, ""), country: "KEN" };
        },
      }),
    });
    await t.agent.handle({ channel: "sms", phone: PHONE, input: "hi" });
    const pending = t.agent.handle({ channel: "sms", phone: PHONE, input: "1" });
    await flush();
    await t.advance(60_000);
    release();
    expect((await pending).text).toContain("Pay 500 KES to CLINIC for Consultation?");
  });
});

describe("an outcome delivered while the user is in another turn", () => {
  /** A gate the test opens by hand, to hold onPaid while another turn runs. */
  function gate() {
    let open!: () => void;
    const opened = new Promise<void>((resolve) => (open = resolve));
    return { opened, open };
  }

  async function paidAndHeld(t: ReturnType<typeof setup>) {
    await toConfirm(t);
    await t.press("1");
    await flush();
    t.fake.set(t.fake.initiated[0]!.id, { found: true, status: "COMPLETED" });
    await t.advance(1000); // the poll finds COMPLETED and onPaid starts, then waits
    expect(t.paid).toHaveLength(1);
  }

  it("keeps the user's place and still saves what onPaid wrote, running it once", async () => {
    const held = gate();
    const t = setup({
      onPaid: async (payment, ctx) => {
        await held.opened;
        ctx.session["paid"] = payment.id ?? null;
        return "Paid. See you on Monday.";
      },
    });
    await paidAndHeld(t);
    expect((await t.sms("hi")).text).toContain("Clinic"); // a new conversation, waiting at the menu

    held.open();
    await flush();
    const session = await t.sessions.load(PHONE);
    expect(session?.data["paid"]).toBe(t.fake.initiated[0]!.id);
    expect(session?.turn).toMatchObject({ kind: "choose", question: "Clinic" });
    expect(t.sent.map((m) => m.text)).toContain("Paid. See you on Monday.");
    expect(t.paid).toHaveLength(1);
    // The menu still answers.
    expect((await t.sms("2")).text).toBe("8 to 18");
  });

  it("takes the outcome's follow-up question when the other turn left nothing waiting", async () => {
    const held = gate();
    const followUp = menu("Book a follow-up?", { "Yes, Monday": say("Booked for Monday.") });
    const t = setup({
      agent: { steps: [followUp] },
      onPaid: async () => {
        await held.opened;
        return followUp;
      },
    });
    await paidAndHeld(t);
    await t.sms("hi");
    expect((await t.sms("2")).text).toBe("8 to 18"); // that conversation ended

    held.open();
    await flush();
    expect(t.sent.some((m) => m.text.startsWith("Book a follow-up?"))).toBe(true);
    expect((await t.sms("1")).text).toBe("Booked for Monday.");
  });
});
