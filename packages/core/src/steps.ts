/**
 * Steps (docs/design.md §4.2): the tree an agent is built from. A step is
 * data; the engine turns it into a `Turn` for the current locale and routes
 * the user's reply to the next step or handler.
 */

import type { Text } from "./locales.js";
import type { Json } from "./session.js";
import type { Logger } from "./logger.js";
import type { Translate } from "./locales.js";
import type { Language, LanguagePriors } from "./languages.js";
import type { SayTurn } from "./turns.js";

export type Awaitable<T> = T | Promise<T>;

export interface TurnContext<M = any> {
  /** This turn's input: the option label, the typed answer, or the confirm word. */
  readonly input: string;
  /** The user's phone number. Personal data: don't log it unmasked. */
  readonly phone: string;
  /** Id of the channel this turn came in on. */
  readonly channel: string;
  readonly channelKind: "ussd" | "sms";
  /** The agent's state for this phone number. Must stay JSON-safe. */
  readonly session: { [key: string]: Json };
  /** The user's locale. Setting it persists; unknown locales are ignored with a warning. */
  locale: string;
  readonly t: Translate;
  /**
   * Whatever the developer passed as `model` to `createAgent`, or with `models`,
   * the entry for the user's current language (falling back to `default`).
   */
  readonly model: M;
  readonly logger: Logger;
}

/**
 * What a handler may return:
 * - a string or `say` turn: shown as a final message
 * - a step: shown next (it must be part of the agent; see `createAgent({ steps })`)
 * - nothing: go back up to the menu above
 */
export type Reply = string | SayTurn | Step | void | undefined;

export type Handler<M = any> = (input: string, ctx: TurnContext<M>) => Awaitable<Reply>;

export type Target<M = any> = Step | Handler<M>;

export interface SayStep {
  readonly type: "say";
  readonly text: Text;
}

export interface MenuEntry<M = any> {
  readonly label: Text;
  readonly to: Target<M>;
}

export interface MenuStep<M = any> {
  readonly type: "menu";
  readonly title?: Text;
  readonly entries: readonly MenuEntry<M>[];
}

export interface AskStep<M = any> {
  readonly type: "ask";
  readonly question: Text;
  readonly input: "text" | "number";
  readonly handler: Handler<M>;
}

export interface ConfirmStep<M = any> {
  readonly type: "confirm";
  readonly question: Text;
  readonly yes?: Text;
  readonly no?: Text;
  readonly onYes: Target<M>;
  readonly onNo: Target<M>;
}

/** What a pay step asks for. The amount is a decimal string, never a float. */
export interface PaySpec {
  readonly amount: string;
  /** ISO 4217 code, e.g. "KES". */
  readonly currency: string;
  /** What the payment is for; shown on the confirm screen and the receipt. */
  readonly reason?: Text;
}

/** The payment as `onPaid` and `onFailed` see it. Never carries a raw provider code. */
export interface PaymentOutcome {
  /** Absent when the payment was refused before one was created. */
  readonly id?: string;
  readonly amount: string;
  readonly currency: string;
  /** What the payment was for. */
  readonly reason: string;
  /** `REFUSED` means the policy or operator said no before the user saw a confirm screen. */
  readonly status: "COMPLETED" | "FAILED" | "REJECTED" | "UNRESOLVED" | "REFUSED";
  /** A localized reason the user can read. Set unless the payment completed. */
  readonly failureMessage?: string;
}

export type PayHandler<M = any> = (payment: PaymentOutcome, ctx: TurnContext<M>) => Awaitable<Reply>;
export type PayTarget<M = any> = Step | PayHandler<M>;

export interface PayStep<M = any> {
  readonly type: "pay";
  readonly spec: (ctx: TurnContext<M>) => Awaitable<PaySpec>;
  readonly onPaid: PayTarget<M>;
  readonly onFailed: PayTarget<M>;
  readonly onDeclined: Target<M>;
}

/**
 * Lets the user choose a language (docs/languages-design.md §4). Shown as a
 * menu of language names, each in its own language, with the likely ones for
 * the user's country first. Choosing one sets `ctx.locale` for good, then goes
 * to `then`, or back up if there is none.
 */
export interface LanguageStep<M = any> {
  readonly type: "language";
  /** Defaults to `createAgent({ languages: { supported } })`. */
  readonly languages?: readonly Language[];
  /** Defaults to the agent's priors, or the built-in ones. */
  readonly priors?: LanguagePriors;
  /** Defaults to "Language / Langue" in the supported languages. */
  readonly title?: Text;
  readonly then?: Target<M>;
}

export type Step = SayStep | MenuStep | AskStep | ConfirmStep | PayStep | LanguageStep;

/**
 * A language menu. Place it in the tree (for a "Language" entry), or let
 * `createAgent({ languages })` show it on first contact.
 */
export function languageMenu<M = any>(options: {
  languages?: readonly Language[];
  priors?: LanguagePriors;
  title?: Text;
  then?: Target<M>;
} = {}): LanguageStep<M> {
  const step: { -readonly [K in keyof LanguageStep<M>]: LanguageStep<M>[K] } = { type: "language" };
  if (options.languages !== undefined) step.languages = options.languages;
  if (options.priors !== undefined) step.priors = options.priors;
  if (options.title !== undefined) step.title = options.title;
  if (options.then !== undefined) step.then = options.then;
  return step;
}

/**
 * Takes a payment from the user (docs/payments-design.md §4.2). Shown as a
 * confirm screen; `onPaid` and `onFailed` run when the final status arrives,
 * after the USSD session has ended, so their output goes out by SMS.
 * Requires `payments` in `createAgent`.
 */
export function pay<M = any>(
  spec: PaySpec | ((ctx: TurnContext<M>) => Awaitable<PaySpec>),
  options: { onPaid: PayTarget<M>; onFailed: PayTarget<M>; onDeclined: Target<M> },
): PayStep<M> {
  return {
    type: "pay",
    spec: typeof spec === "function" ? spec : () => spec,
    onPaid: options.onPaid,
    onFailed: options.onFailed,
    onDeclined: options.onDeclined,
  };
}

/** A final screen or message. */
export function say(text: Text): SayStep {
  return { type: "say", text };
}

/**
 * A numbered menu. Entries are `{ label: target }`, or an array of
 * `{ label, to }` when labels need translations.
 */
export function menu<M = any>(
  title: Text | undefined,
  entries: Readonly<Record<string, Target<M>>> | readonly MenuEntry<M>[],
): MenuStep<M> {
  const list: MenuEntry<M>[] = Array.isArray(entries)
    ? [...(entries as readonly MenuEntry<M>[])]
    : Object.entries(entries as Readonly<Record<string, Target<M>>>).map(([label, to]) => ({ label, to }));
  if (list.length === 0) throw new TypeError("A menu needs at least one entry");
  return title === undefined ? { type: "menu", entries: list } : { type: "menu", title, entries: list };
}

/** Same as `menu`, named for when the list is a question. */
export const choose = menu;

/** A free-text or number question; the answer goes to `handler`. */
export function ask<M = any>(
  question: Text,
  handler: Handler<M>,
  options: { input?: "text" | "number" } = {},
): AskStep<M> {
  return { type: "ask", question, input: options.input ?? "text", handler };
}

/** A yes/no question. */
export function confirm<M = any>(
  question: Text,
  options: { onYes: Target<M>; onNo: Target<M>; yes?: Text; no?: Text },
): ConfirmStep<M> {
  const step: { -readonly [K in keyof ConfirmStep<M>]: ConfirmStep<M>[K] } = {
    type: "confirm",
    question,
    onYes: options.onYes,
    onNo: options.onNo,
  };
  if (options.yes !== undefined) step.yes = options.yes;
  if (options.no !== undefined) step.no = options.no;
  return step;
}

export function isStep(value: unknown): value is Step {
  if (typeof value !== "object" || value === null) return false;
  const type = (value as { type?: unknown }).type;
  return (
    type === "say" || type === "menu" || type === "ask" || type === "confirm" || type === "pay" || type === "language"
  );
}

export interface StepIndex {
  readonly start: Step;
  id(step: Step): string | undefined;
  get(id: string): Step | undefined;
  /** The step to return to when a handler under `id` returns nothing. */
  parent(id: string): Step | undefined;
  /** Every indexed step. */
  all(): readonly Step[];
}

/**
 * Gives every reachable step a stable id from its position in the tree
 * (`start`, `start.2`, `start.2.yes`). Ids are stored in sessions, so they
 * stay valid across restarts as long as the tree's shape doesn't change.
 */
export function indexSteps(start: Step, extra: readonly Step[] = []): StepIndex {
  const ids = new Map<Step, string>();
  const byId = new Map<string, Step>();
  const parents = new Map<string, Step>();

  const visit = (step: Step, id: string, parent: Step | undefined) => {
    if (ids.has(step)) return;
    ids.set(step, id);
    byId.set(id, step);
    if (parent) parents.set(id, parent);

    const child = (target: Target, suffix: string) => {
      if (isStep(target)) visit(target, `${id}.${suffix}`, step);
    };
    switch (step.type) {
      case "menu":
        step.entries.forEach((entry, i) => child(entry.to, String(i + 1)));
        break;
      case "confirm":
        child(step.onYes, "yes");
        child(step.onNo, "no");
        break;
      case "pay":
        if (isStep(step.onPaid)) visit(step.onPaid, `${id}.paid`, step);
        if (isStep(step.onFailed)) visit(step.onFailed, `${id}.failed`, step);
        child(step.onDeclined, "declined");
        break;
      case "language":
        if (step.then !== undefined) child(step.then, "then");
        break;
      case "say":
      case "ask":
        break;
    }
  };

  visit(start, "start", undefined);
  extra.forEach((step, i) => visit(step, `steps.${i}`, undefined));

  return {
    start,
    id: (step) => ids.get(step),
    get: (id) => byId.get(id),
    parent: (id) => parents.get(id),
    all: () => [...ids.keys()],
  };
}
