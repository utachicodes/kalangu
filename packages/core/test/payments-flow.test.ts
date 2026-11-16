import { describe, expect, it } from "vitest";
import {
  createAgent,
  memoryPaymentStore,
  memoryStore,
  menu,
  pay,
  say,
  smsChannel,
  ussdChannel,
  type Clock,
  type InitiateResult,
  type Logger,
  type PaymentProvider,
  type PaymentRecord,
  type PaymentsConfig,
  type StatusResult,
} from "../src/index.js";

const PHONE = "+254700000001";

/** A clock whose timers fire when the test advances time. */
function timerClock(start = 1_000_000) {
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
  options: { provider?: ReturnType<typeof controllableProvider>; payments?: Partial<PaymentsConfig>; amount?: string } = {},
) {
  const fake = options.provider ?? controllableProvider();
  const { clock, advance } = timerClock();
  const { logger, errors } = silent();
  const store = memoryPaymentStore();
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
    sessionStore: memoryStore(),
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
  return { agent, dial, press, store, sent, paid, advance, errors, fake };
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
    expect(out.text).toContain("We could not find your operator.");
    expect(t.store.size).toBe(0);
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
