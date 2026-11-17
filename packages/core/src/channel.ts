/**
 * Channels (docs/design.md §4.3). A channel renders turns for one kind of
 * transport and, for SMS, sends messages. Adapters wrap these helpers with
 * gateway-specific HTTP routes.
 */

import type { SmsBudget } from "./budget/sms.js";
import { DEFAULT_USSD_BUDGET, type UssdBudget } from "./budget/ussd.js";
import { renderSms, renderUssd, type ChannelKind, type RenderContext, type Rendered } from "./render.js";
import type { Turn } from "./turns.js";

export interface RenderedOutbound {
  /** Phone number. */
  to: string;
  /** Already budgeted. */
  text: string;
  meta?: Readonly<Record<string, string>>;
}

export interface Route {
  /** URL pathname, e.g. "/ussd". */
  readonly path: string;
  handle(req: Request, agent: RouteAgent): Promise<Response>;
}

/** What an adapter's route can ask of the agent. Kept narrow so adapters depend on little. */
export interface RouteAgent {
  handle(event: InboundEvent): Promise<Outcome>;
  /** The localized error message, for when a request can't reach the engine at all. */
  errorText(locale?: string): string;
  readonly logger: import("./logger.js").Logger;
  /** Masks a phone number unless the agent was configured to log them. */
  mask(phone: string): string;
  /** Runs work after the response has been sent. */
  background(task: () => Promise<void>): void;
}

export interface Channel {
  readonly id: string;
  readonly kind: ChannelKind;
  /** True when the user is waiting on a live session (USSD), so replies must be fast. */
  readonly live: boolean;
  /** USSD navigation settings, used to read input the way it was rendered. */
  readonly ussd?: Pick<UssdBudget, "more" | "reserved">;
  render(turn: Turn, ctx: RenderContext): Rendered;
  send?(out: RenderedOutbound): Promise<void>;
  readonly routes?: readonly Route[];
}

export interface InboundEvent {
  /** Id of the channel the input arrived on. */
  channel: string;
  phone: string;
  /** This turn's new input (on USSD, the last `*` segment). */
  input: string;
  /** True on the first request of a live session (a fresh dial). */
  newSession?: boolean;
  /**
   * The gateway's id for this live session. When it changes, the engine
   * treats the request as a new session even if input is present.
   */
  gatewaySessionId?: string;
  /**
   * Every input of this live session so far, oldest first (USSD `text`
   * split on `*`). Used to replay a dial string such as `*384*1*2#`, whose
   * first request already carries `1*2`.
   */
  inputs?: readonly string[];
  /**
   * For a tap on a button or list row from a channel with tappable history:
   * the `turnSeq` carried in that button's id, which `RenderContext.turnSeq`
   * gave the renderer. If it is not the session's current `turnSeq` the
   * choice has expired: the current turn is shown again and nothing runs.
   * Leave it unset for typed input, which always answers what is on screen.
   */
  turnSeq?: number;
}

export interface Outcome {
  text: string;
  /** True when the session or conversation is over. */
  end: boolean;
  /** The step shown, if any; adapters may expose it as journey metadata. */
  stepId: string | null;
  /** True when the answer will follow by SMS. */
  deferred: boolean;
}

export interface UssdChannelOptions {
  id?: string;
  budget?: Partial<UssdBudget>;
  routes?: readonly Route[];
}

export function ussdChannel(options: UssdChannelOptions = {}): Channel {
  const budget: UssdBudget = { ...DEFAULT_USSD_BUDGET, ...options.budget };
  if (!Number.isInteger(budget.maxChars) || budget.maxChars < 20) {
    throw new RangeError(`USSD maxChars must be an integer of at least 20, got ${budget.maxChars}`);
  }
  return {
    id: options.id ?? "ussd",
    kind: "ussd",
    live: true,
    ussd: { more: budget.more, reserved: budget.reserved },
    render: (turn, ctx) => renderUssd(turn, ctx, budget),
    ...(options.routes ? { routes: options.routes } : {}),
  };
}

export interface SmsChannelOptions {
  id?: string;
  budget?: SmsBudget;
  send?: (out: RenderedOutbound) => Promise<void>;
  routes?: readonly Route[];
}

export function smsChannel(options: SmsChannelOptions = {}): Channel {
  const budget = options.budget ?? {};
  return {
    id: options.id ?? "sms",
    kind: "sms",
    live: false,
    render: (turn, ctx) => renderSms(turn, ctx, budget),
    ...(options.send ? { send: options.send } : {}),
    ...(options.routes ? { routes: options.routes } : {}),
  };
}
