/**
 * Channels (docs/design.md §4.3). A channel renders turns for one kind of
 * transport and, for SMS, sends messages. Adapters wrap these helpers with
 * gateway-specific HTTP routes.
 */
import { DEFAULT_USSD_BUDGET } from "./budget/ussd.js";
import { renderSms, renderUssd } from "./render.js";
export function ussdChannel(options = {}) {
    const budget = { ...DEFAULT_USSD_BUDGET, ...options.budget };
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
export function smsChannel(options = {}) {
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