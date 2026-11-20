/**
 * Renderers (docs/design.md §6) and the matching input interpreter. They
 * live together because a user's "3" only means something relative to how
 * the menu was numbered.
 */
import { budgetSms } from "./budget/sms.js";
import { DEFAULT_USSD_BUDGET, optionNumbers, paginateMenu, paginateText, toUssdSafe, } from "./budget/ussd.js";
import { assertNever } from "./turns.js";
export class NotSupportedError extends Error {
    name = "NotSupportedError";
}
/** Turns on USSD: numbered menus, screens within the limit, safe characters only. */
export function renderUssd(turn, ctx, budget = DEFAULT_USSD_BUDGET) {
    const warnings = [];
    const safe = (text) => {
        const out = toUssdSafe(text, budget.unsafeChars);
        if (out.removed.length > 0) {
            warnings.push(`Removed characters USSD cannot show: ${out.removed.map((c) => JSON.stringify(c)).join(", ")}`);
        }
        return out.text;
    };
    const moreLine = safe(`${budget.more}. ${ctx.t("common.more")}`);
    const notice = ctx.notice ? [safe(ctx.notice)] : [];
    let pages;
    let final = false;
    switch (turn.kind) {
        case "say":
            pages = paginateText([...notice, safe(turn.text)].join("\n"), budget.maxChars, moreLine);
            final = true;
            break;
        case "ask":
            pages = paginateText([...notice, safe(turn.question)].join("\n"), budget.maxChars, moreLine);
            break;
        case "choose": {
            const numbers = optionNumbers(turn.options.length, budget.reserved);
            pages = paginateMenu({
                head: [...notice, ...(turn.question ? [safe(turn.question)] : [])],
                items: turn.options.map((o, i) => `${numbers[i]}. ${safe(o.label)}`),
                maxChars: budget.maxChars,
                moreLine,
            });
            break;
        }
        case "confirm": {
            const [yes, no] = confirmLabels(turn, ctx.t);
            pages = paginateMenu({
                head: [...notice, safe(turn.question)],
                items: [`1. ${safe(yes)}`, `2. ${safe(no)}`],
                maxChars: budget.maxChars,
                moreLine,
            });
            break;
        }
        case "pay":
            throw new NotSupportedError("The pay turn arrives in 0.2 and cannot be rendered yet");
        default:
            return assertNever(turn);
    }
    const page = clamp(ctx.page, pages.length);
    return {
        text: pages[page],
        end: final && page === pages.length - 1,
        page,
        pages: pages.length,
        warnings,
    };
}
/** Turns over SMS: one message per turn, within the segment cap. */
export function renderSms(turn, ctx, budget = {}) {
    const lines = ctx.notice ? [ctx.notice] : [];
    let final = false;
    switch (turn.kind) {
        case "say":
            lines.push(turn.text);
            final = true;
            break;
        case "ask":
            lines.push(turn.question);
            break;
        case "choose": {
            const numbers = optionNumbers(turn.options.length);
            if (turn.question)
                lines.push(turn.question);
            turn.options.forEach((o, i) => lines.push(`${numbers[i]}. ${o.label}`));
            break;
        }
        case "confirm": {
            const [yes, no] = confirmLabels(turn, ctx.t);
            lines.push(turn.question, ctx.t("common.replyYesNo", { yes: yes.toUpperCase(), no: no.toUpperCase() }));
            break;
        }
        case "pay":
            throw new NotSupportedError("The pay turn arrives in 0.2 and cannot be rendered yet");
        default:
            return assertNever(turn);
    }
    const text = lines.join("\n");
    budgetSms(text, budget);
    return { text, end: final, page: 0, pages: 1, warnings: [] };
}
/** Reads a user's reply to `turn` the way the renderer laid it out. */
export function interpret(turn, input, ctx) {
    const value = input.trim();
    const budget = ctx.budget ?? DEFAULT_USSD_BUDGET;
    if (ctx.kind === "ussd" && ctx.page < ctx.pages - 1 && value === budget.more) {
        return { type: "more" };
    }
    switch (turn.kind) {
        case "say":
            return { type: "invalid", reason: "common.invalidChoice" };
        case "choose": {
            const numbers = optionNumbers(turn.options.length, ctx.kind === "ussd" ? budget.reserved : undefined);
            let index = numbers.indexOf(value);
            if (index < 0) {
                const lower = value.toLowerCase();
                // An exact (case-insensitive) match wins; otherwise a folded one, but only if it is unique.
                index = turn.options.findIndex((o) => o.label.trim().toLowerCase() === lower);
                if (index < 0) {
                    const matches = turn.options.flatMap((o, i) => (typedMatches(value, o.label) ? [i] : []));
                    index = matches.length === 1 ? matches[0] : -1;
                }
            }
            return index >= 0 ? { type: "option", index } : { type: "invalid", reason: "common.invalidChoice" };
        }
        case "ask":
            if (value === "")
                return { type: "invalid", reason: "common.typeAnswer" };
            if (turn.input === "number" && !/^\d+(?:[.,]\d+)?$/.test(value)) {
                return { type: "invalid", reason: "common.invalidNumber" };
            }
            return { type: "answer", value };
        case "confirm": {
            const [yes, no] = confirmLabels(turn, ctx.t);
            if (value === "1")
                return { type: "yes" };
            if (value === "2")
                return { type: "no" };
            const yesWords = [yes, ctx.t("common.yes")];
            const noWords = [no, ctx.t("common.no")];
            // An exact (case-insensitive) word wins; otherwise a folded match, but only if it fits one side.
            const exact = (w) => w.trim().toLowerCase() === value.toLowerCase();
            for (const match of [exact, (w) => typedMatches(value, w)]) {
                const isYes = yesWords.some(match);
                const isNo = noWords.some(match);
                if (isYes !== isNo)
                    return { type: isYes ? "yes" : "no" };
                if (isYes && isNo)
                    break;
            }
            return { type: "invalid", reason: "common.invalidChoice" };
        }
        case "pay":
            throw new NotSupportedError("The pay turn arrives in 0.2 and cannot take input yet");
        default:
            return assertNever(turn);
    }
}
/**
 * A comparison key for typed text (docs/normalization-design.md §5.1, generic
 * steps): accents dropped, case, spacing and apostrophe style ignored. For
 * comparing only; never shown to anyone.
 */
export function foldForMatch(text) {
    return text
        .normalize("NFKD")
        .replace(/\p{M}/gu, "")
        .replace(/[\u2018\u2019\u02BC\u02BB`´]/g, "'")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
}
/**
 * Whether typed text names `label`: as written, or as a USSD screen showed it.
 * USSD allows plain ASCII only, so "Français" is shown as "Francais" and Hausa
 * "Ɗan" as "Dan"; whatever a screen showed must be typeable back.
 */
function typedMatches(typed, label) {
    const key = foldForMatch(typed);
    if (key === "")
        return false;
    return key === foldForMatch(label) || key === foldForMatch(toUssdSafe(label).text);
}
function confirmLabels(turn, t) {
    return [turn.yes ?? t("common.yes"), turn.no ?? t("common.no")];
}
function clamp(page, pages) {
    return Math.min(Math.max(Math.trunc(page) || 0, 0), pages - 1);
}