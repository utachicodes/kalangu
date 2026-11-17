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
  type InitiateResult,
  type Logger,
  type MessageKey,
  type PaymentProvider,
  type PaymentRecord,
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
      onPaid: (payment) => {
        paid.push(payment);
        return "Paid. See you on Monday.";
      },
      onFailed: (payment) => `Payment not completed: ${payment.failureMessage}`,
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
  return { agent, dial, press, store, sessions, clock, sent, paid, advance, errors, fake };
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
    id, phone: PHONE, provider: "TEST_MOMO", amount: "500.00", currency: "KES", reason: "Consultation",
    stepId: "start.1", locale: "en", status: "CREATED", createdAt: now, updatedAt: now, ...extra,
  });

  it("finishes a payment whose polling died with the old process, and tells the user", async () => {
    const { first, id, second } = await started();
    first.fake.set(id, { found: true, status: "COMPLETED" });

    const report = await second.agent.payments!.reconcile({ minAgeMs: 0 });
    expect(report).toEqual({ checked: 1, completed: 1, failed: 0, unresolved: 0, stillPending: 0, errors: 0 });
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
      id: "done", phone: PHONE, provider: "TEST_MOMO", amount: "500.00", currency: "KES", reason: "Consultation",
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
