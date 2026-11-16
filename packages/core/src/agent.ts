/**
 * The engine (docs/design.md §4.3): loads the caller's session, reads their
 * input against what they were last shown, runs the matching step or
 * handler, renders the result for the channel, and saves the session.
 *
 * Handlers on a live channel (USSD) run under a deadline (§4.6). If one
 * misses it, the user gets the "we'll text you" screen, the handler keeps
 * running in the background, and its answer arrives by SMS.
 */

import { inProcessBackground, type BackgroundWork } from "./background.js";
import { toUssdSafe } from "./budget/ussd.js";
import type { Channel, InboundEvent, Outcome, RouteAgent } from "./channel.js";
import { systemClock, type Clock } from "./clock.js";
import { createCatalog, type Catalog, type Messages, type Translate } from "./locales.js";
import { consoleLogger, maskPhone, type Logger } from "./logger.js";
import { interpret, type Rendered } from "./render.js";
import { freshRecord, memoryStore, type SessionRecord, type SessionStore } from "./session.js";
import {
  indexSteps,
  isStep,
  type Handler,
  type Reply,
  type Step,
  type StepIndex,
  type Target,
  type TurnContext,
} from "./steps.js";
import { assertNever, type Turn } from "./turns.js";

export interface AgentConfig<M = any> {
  /** The first step shown on a fresh dial or a first SMS. */
  start: Step;
  channels: readonly Channel[];
  /** Your model handle; core only passes it to handlers as `ctx.model`. */
  model?: M;
  /** Locale for new users. Default "en". */
  defaultLocale?: string;
  /** Overrides for the built-in messages, or whole new locales. */
  messages?: Readonly<Record<string, Partial<Messages>>>;
  sessionStore?: SessionStore;
  logger?: Logger;
  /** Log raw phone numbers. Off by default: numbers are masked. */
  logPhoneNumbers?: boolean;
  clock?: Clock;
  /**
   * How long a handler on a live channel may take before the answer is
   * deferred to SMS, in ms. Default 4000. Above 8000 logs a warning; above
   * 10000 is refused, since gateways expect a reply within 10 s.
   */
  deadlineMs?: number;
  /** Where deferred answers and SMS replies run. Default: in this process. */
  background?: BackgroundWork;
  /**
   * How long a dropped session can be resumed by redialing, in ms.
   * After that the user starts from the top (their data and locale stay).
   * Default 5 minutes.
   */
  resumeWindowMs?: number;
  /** Steps that handlers return but that aren't reachable from `start`. */
  steps?: readonly Step[];
}

export interface Agent<M = any> extends RouteAgent {
  handle(event: InboundEvent): Promise<Outcome>;
  /** Standard `Request` → `Response`, dispatched by pathname to the channels' routes. */
  readonly requestHandler: (req: Request) => Promise<Response>;
  /** The same agent with other channels, e.g. a simulator's. Shares the session store. */
  withChannels(channels: readonly Channel[]): Agent<M>;
  channel(id: string): Channel | undefined;
  readonly channels: readonly Channel[];
  readonly logger: Logger;
}

export const DEFAULT_RESUME_WINDOW_MS = 5 * 60 * 1000;
export const DEFAULT_DEADLINE_MS = 4000;
export const DEADLINE_WARN_MS = 8000;
export const DEADLINE_MAX_MS = 10_000;
/** A deferral older than this is treated as lost (e.g. the process restarted). */
export const DEFERRAL_TTL_MS = 15 * 60 * 1000;

export function createAgent<M = any>(config: AgentConfig<M>): Agent<M> {
  const store = config.sessionStore ?? memoryStore();
  return buildAgent({ ...config, sessionStore: store });
}

function buildAgent<M>(config: AgentConfig<M> & { sessionStore: SessionStore }): Agent<M> {
  const store = config.sessionStore;
  const logger = config.logger ?? consoleLogger();
  const clock = config.clock ?? systemClock;
  const catalog = createCatalog(config.defaultLocale ?? "en", config.messages);
  const steps = indexSteps(config.start, config.steps);
  const resumeWindow = config.resumeWindowMs ?? DEFAULT_RESUME_WINDOW_MS;
  const deadlineMs = checkDeadline(config.deadlineMs ?? DEFAULT_DEADLINE_MS, logger);
  const background = config.background ?? inProcessBackground(logger);
  const mask = (phone: string) => (config.logPhoneNumbers ? phone : maskPhone(phone));

  const channels = new Map<string, Channel>();
  for (const channel of config.channels) {
    if (channels.has(channel.id)) throw new TypeError(`Two channels share the id ${JSON.stringify(channel.id)}`);
    channels.set(channel.id, channel);
  }
  const routes = new Map<string, { channel: Channel; route: NonNullable<Channel["routes"]>[number] }>();
  for (const channel of config.channels) {
    for (const route of channel.routes ?? []) {
      if (routes.has(route.path)) throw new TypeError(`Two routes share the path ${JSON.stringify(route.path)}`);
      routes.set(route.path, { channel, route });
    }
  }
  const smsSender = config.channels.find((c) => c.kind === "sms" && c.send);
  if (!smsSender && config.channels.some((c) => c.live)) {
    logger.warn("No SMS channel can send: answers that miss the deadline cannot be delivered");
  }

  const errorText = (locale?: string) =>
    catalog.translator(locale && catalog.has(locale) ? locale : catalog.defaultLocale)("common.error");

  const deps: Omit<RunDeps<M>, "saved"> = {
    catalog,
    steps,
    logger,
    model: config.model as M,
    mask,
    store,
    clock,
    background,
    deadlineMs,
    smsSender,
  };

  const agent: Agent<M> = {
    channels: config.channels,
    logger,
    mask,
    errorText,
    background: (task) => background.run(task),
    channel: (id) => channels.get(id),
    withChannels: (next) => buildAgent({ ...config, channels: next }),

    async handle(event) {
      const channel = channels.get(event.channel);
      if (!channel) throw new TypeError(`No channel with id ${JSON.stringify(event.channel)}`);

      const now = clock.now();
      const loaded = await store.load(event.phone);
      const record = loaded ?? freshRecord(event.phone, catalog.defaultLocale, now);
      if (loaded && now - loaded.updatedAt > resumeWindow) resetPosition(record);
      if (record.deferred && now - record.deferred.since > DEFERRAL_TTL_MS) record.deferred = null;
      const newGatewaySession =
        channel.live &&
        event.gatewaySessionId !== undefined &&
        event.gatewaySessionId !== record.gatewaySessionId;
      if (event.gatewaySessionId) record.gatewaySessionId = event.gatewaySessionId;
      if (newGatewaySession) event = { ...event, newSession: true };

      let markSaved!: () => void;
      const saved = new Promise<void>((resolve) => (markSaved = resolve));
      const turn = new TurnRun<M>(record, channel, event, { ...deps, saved });

      let outcome: Outcome;
      try {
        outcome = await turn.run();
      } catch (err) {
        logger.error("Turn failed", {
          channel: channel.id,
          phone: mask(event.phone),
          step: record.stepId,
          error: describeError(err),
        });
        resetPosition(record);
        const text = errorText(record.locale);
        outcome = {
          text: channel.kind === "ussd" ? toUssdSafe(text).text : text,
          end: true,
          stepId: null,
          deferred: false,
        };
      }

      record.channel = channel.id;
      record.updatedAt = clock.now();
      try {
        await store.save(record);
      } finally {
        markSaved();
      }
      logger.debug("Turn", {
        channel: channel.id,
        phone: mask(event.phone),
        step: outcome.stepId,
        end: outcome.end,
        deferred: outcome.deferred,
      });
      return outcome;
    },

    requestHandler: async (req) => {
      const { pathname } = new URL(req.url);
      const match = routes.get(pathname) ?? routes.get(pathname.replace(/\/+$/, ""));
      if (!match) return new Response("Not found", { status: 404, headers: { "content-type": "text/plain" } });
      return match.route.handle(req, agent);
    },
  };
  return agent;
}

function checkDeadline(ms: number, logger: Logger): number {
  if (!Number.isFinite(ms) || ms <= 0) throw new RangeError(`deadlineMs must be a positive number, got ${ms}`);
  if (ms > DEADLINE_MAX_MS) {
    throw new RangeError(
      `deadlineMs is ${ms}; gateways expect a USSD reply within ${DEADLINE_MAX_MS} ms, so the most allowed is ${DEADLINE_MAX_MS}`,
    );
  }
  if (ms > DEADLINE_WARN_MS) {
    logger.warn(`deadlineMs is ${ms}; above ${DEADLINE_WARN_MS} ms leaves little room before the gateway gives up`);
  }
  return ms;
}

interface RunDeps<M> {
  catalog: Catalog;
  steps: StepIndex;
  logger: Logger;
  model: M;
  mask: (phone: string) => string;
  store: SessionStore;
  clock: Clock;
  background: BackgroundWork;
  deadlineMs: number;
  /** The channel deferred answers go out on. */
  smsSender: Channel | undefined;
  /** Resolves once this turn's record has been saved. */
  saved: Promise<void>;
}

type Race<T> = { done: true; value: T } | { done: false };

/** One inbound event's worth of work. Mutates `record`; the caller saves it. */
class TurnRun<M> {
  private t: Translate;

  constructor(
    private readonly record: SessionRecord,
    private readonly channel: Channel,
    private readonly event: InboundEvent,
    private readonly deps: RunDeps<M>,
  ) {
    this.t = deps.catalog.translator(record.locale);
  }

  async run(): Promise<Outcome> {
    const { record, channel, event } = this;

    if (record.deferred) {
      // An earlier answer is still on its way; say so again rather than block.
      return this.deferredNotice();
    }

    const shown = record.turn;
    if (channel.live && event.newSession) {
      const replay = event.inputs ?? (event.input !== "" ? [event.input] : []);
      if (replay.length === 0) {
        // A fresh dial: resume where a dropped session left off, or start over.
        return shown ? this.display(shown) : this.showStep(this.deps.steps.start);
      }
      // A dial string with choices in it: start from the top and replay them.
      let outcome = this.showStep(this.deps.steps.start);
      for (const input of replay) {
        const current = this.record.turn;
        if (outcome.end || !current) break;
        outcome = await this.answer(current, input);
      }
      return outcome;
    }
    if (!shown) return this.showStep(this.deps.steps.start);
    if (channel.kind === "sms" && shown.kind === "say") {
      // Nothing is waiting for an answer: an SMS starts the flow from the top.
      return this.showStep(this.deps.steps.start);
    }
    return this.answer(shown, event.input);
  }

  /** Turns a handler's reply into what to show next. Public for deferred delivery. */
  finish(reply: Reply, owner: Step): Outcome {
    if (reply === undefined || reply === null) {
      const ownerId = this.deps.steps.id(owner);
      const up = (ownerId && this.deps.steps.parent(ownerId)) || this.deps.steps.start;
      return this.showStep(up);
    }
    if (typeof reply === "string") return this.showTurn({ kind: "say", text: reply }, null);
    if (isStep(reply)) {
      if (!this.deps.steps.id(reply)) {
        throw new TypeError(
          "A handler returned a step that isn't part of the agent. Declare it in the tree or pass it in createAgent({ steps }).",
        );
      }
      return this.showStep(reply);
    }
    if (typeof reply === "object" && (reply as { kind?: unknown }).kind === "say") {
      return this.showTurn(reply, null);
    }
    throw new TypeError(
      "A handler may return a string, a say turn, a step, or nothing. For questions, return an ask, choose or confirm step.",
    );
  }

  private async answer(shown: Turn, input: string): Promise<Outcome> {
    const { record, channel } = this;
    const reading = interpret(shown, input, {
      kind: channel.kind,
      t: this.t,
      page: record.page,
      pages: this.pagesOf(shown),
      ...(channel.ussd ? { budget: channel.ussd } : {}),
    });

    if (reading.type === "more") {
      record.page += 1;
      return this.display(shown);
    }
    if (reading.type === "invalid") return this.display(shown, this.t(reading.reason));

    const step = record.stepId ? this.deps.steps.get(record.stepId) : undefined;
    if (!step) {
      // The tree changed under a stored session, or a handler's say had pages.
      return this.showStep(this.deps.steps.start);
    }

    switch (reading.type) {
      case "option": {
        if (step.type !== "menu") return this.showStep(this.deps.steps.start);
        const entry = step.entries[reading.index];
        if (!entry) return this.display(shown, this.t("common.invalidChoice"));
        const label = shown.kind === "choose" ? (shown.options[reading.index]?.label ?? "") : "";
        return this.go(entry.to, label, step);
      }
      case "answer":
        if (step.type !== "ask") return this.showStep(this.deps.steps.start);
        return this.runHandler(step.handler, reading.value, step);
      case "yes":
      case "no": {
        if (step.type !== "confirm") return this.showStep(this.deps.steps.start);
        return this.go(reading.type === "yes" ? step.onYes : step.onNo, input.trim(), step);
      }
      default:
        return assertNever(reading);
    }
  }

  private go(target: Target, input: string, from: Step): Promise<Outcome> {
    return isStep(target) ? Promise.resolve(this.showStep(target)) : this.runHandler(target, input, from);
  }

  private async runHandler(handler: Handler, input: string, owner: Step): Promise<Outcome> {
    const ctx = this.context(input);
    const work = Promise.resolve().then(() => handler(input, ctx));
    if (!this.channel.live) return this.finish(await work, owner);

    const result = await this.race(work);
    if (result.done) return this.finish(result.value, owner);
    return this.defer(work, owner);
  }

  /** Settles with the handler's reply, or `{ done: false }` at the deadline. */
  private race(work: Promise<Reply>): Promise<Race<Reply>> {
    const { clock, deadlineMs } = this.deps;
    return new Promise((resolve, reject) => {
      const timer = clock.setTimeout(() => resolve({ done: false }), deadlineMs);
      work.then(
        (value) => {
          clock.clearTimeout(timer);
          resolve({ done: true, value });
        },
        (err: unknown) => {
          clock.clearTimeout(timer);
          reject(err);
        },
      );
    });
  }

  /** Ends the live session with the notice and finishes the answer by SMS. */
  private defer(work: Promise<Reply>, owner: Step): Outcome {
    const { record, deps, event } = this;
    const sender = deps.smsSender;
    if (!sender?.send) {
      work.catch(() => {}); // Nobody will read it; don't let it go unhandled.
      throw new Error("A handler missed the deadline and no SMS channel can send the answer");
    }
    record.deferred = { since: deps.clock.now() };
    deps.logger.info("Answer deferred to SMS", {
      channel: this.channel.id,
      phone: deps.mask(event.phone),
      step: record.stepId,
      deadlineMs: deps.deadlineMs,
    });
    deps.background.run(() => this.deliverLater(work, owner, sender));
    return this.deferredNotice();
  }

  private deferredNotice(): Outcome {
    const outcome = this.showTurn({ kind: "say", text: this.t("common.deferredNotice") }, null);
    return { ...outcome, deferred: true };
  }

  /** Waits for the late answer, renders it for SMS, saves the session, and sends it. */
  private async deliverLater(work: Promise<Reply>, owner: Step, sender: Channel): Promise<void> {
    const { deps, event } = this;
    let reply: Reply;
    let failure: unknown;
    try {
      reply = await work;
    } catch (err) {
      failure = err;
    }
    await deps.saved;

    // Start from the stored record (other turns may have happened) but keep
    // what the handler changed. Last write wins, as documented.
    const latest = (await deps.store.load(event.phone)) ?? structuredClone(this.record);
    latest.data = this.record.data;
    latest.locale = this.record.locale;
    latest.deferred = null;

    const run = new TurnRun<M>(latest, sender, { channel: sender.id, phone: event.phone, input: "" }, {
      ...deps,
      saved: Promise.resolve(),
    });
    let text: string;
    if (failure === undefined) {
      try {
        text = run.finish(reply, owner).text;
      } catch (err) {
        failure = err;
        text = "";
      }
    } else {
      text = "";
    }
    if (failure !== undefined) {
      deps.logger.error("Deferred answer failed", {
        phone: deps.mask(event.phone),
        step: deps.steps.id(owner),
        error: describeError(failure),
      });
      resetPosition(latest);
      text = deps.catalog.translator(latest.locale)("common.error");
    }

    latest.channel = sender.id;
    latest.updatedAt = deps.clock.now();
    await deps.store.save(latest);
    await sender.send?.({ to: event.phone, text });
    deps.logger.info(failure === undefined ? "Deferred answer sent" : "Deferred apology sent", {
      channel: sender.id,
      phone: deps.mask(event.phone),
    });
  }

  private showStep(step: Step): Outcome {
    return this.showTurn(this.turnFor(step), this.deps.steps.id(step) ?? null);
  }

  private showTurn(turn: Turn, stepId: string | null): Outcome {
    this.record.stepId = stepId;
    this.record.page = 0;
    return this.display(turn);
  }

  /** Renders `turn` at the record's current page and updates the position. */
  private display(turn: Turn, notice?: string): Outcome {
    const { record, channel } = this;
    const rendered: Rendered = channel.render(turn, {
      t: this.t,
      page: record.page,
      ...(notice ? { notice } : {}),
    });
    for (const warning of rendered.warnings) {
      this.deps.logger.warn(warning, { channel: channel.id, step: record.stepId });
    }

    const stepId = record.stepId;
    record.page = rendered.page;
    if (rendered.end) resetPosition(record);
    else record.turn = turn;

    return { text: rendered.text, end: rendered.end, stepId, deferred: false };
  }

  private pagesOf(turn: Turn): number {
    // Re-render to learn how many pages the user is paging through.
    return this.channel.render(turn, { t: this.t, page: 0 }).pages;
  }

  private turnFor(step: Step): Turn {
    const text = (value: Parameters<Catalog["localize"]>[0]) =>
      this.deps.catalog.localize(value, this.record.locale);
    switch (step.type) {
      case "say":
        return { kind: "say", text: text(step.text) };
      case "menu":
        return {
          kind: "choose",
          ...(step.title !== undefined ? { question: text(step.title) } : {}),
          options: step.entries.map((e) => ({ label: text(e.label) })),
        };
      case "ask":
        return { kind: "ask", question: text(step.question), input: step.input };
      case "confirm":
        return {
          kind: "confirm",
          question: text(step.question),
          ...(step.yes !== undefined ? { yes: text(step.yes) } : {}),
          ...(step.no !== undefined ? { no: text(step.no) } : {}),
        };
      default:
        return assertNever(step);
    }
  }

  private context(input: string): TurnContext<M> {
    const { record, channel, event, deps } = this;
    const setLocale = (locale: string) => {
      if (!deps.catalog.has(locale)) {
        deps.logger.warn("Ignored unknown locale", { locale });
        return;
      }
      record.locale = locale;
      this.t = deps.catalog.translator(locale);
    };
    return {
      input,
      phone: event.phone,
      channel: channel.id,
      channelKind: channel.kind,
      session: record.data,
      get locale() {
        return record.locale;
      },
      set locale(locale: string) {
        setLocale(locale);
      },
      t: (key, vars) => this.t(key, vars),
      model: deps.model,
      logger: deps.logger,
    };
  }
}

function resetPosition(record: SessionRecord): void {
  record.stepId = null;
  record.turn = null;
  record.page = 0;
}

function describeError(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}
