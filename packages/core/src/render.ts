/**
 * Renderers (docs/design.md §6) and the matching input interpreter. They
 * live together because a user's "3" only means something relative to how
 * the menu was numbered.
 */

import { budgetSms, type SmsBudget } from "./budget/sms.js";
import {
  DEFAULT_USSD_BUDGET,
  optionNumbers,
  paginateMenu,
  paginateText,
  toUssdSafe,
  type UssdBudget,
} from "./budget/ussd.js";
import type { Translate } from "./locales.js";
import { assertNever, type ConfirmTurn, type Turn } from "./turns.js";

export class NotSupportedError extends Error {
  override readonly name = "NotSupportedError";
}

export interface RenderContext {
  t: Translate;
  /** Zero-based page to show; clamped to the pages that exist. */
  page: number;
  /** A line shown above the turn, e.g. "Invalid choice. Try again." */
  notice?: string;
}

export interface Rendered {
  text: string;
  /** True when the conversation is over after this output. */
  end: boolean;
  page: number;
  pages: number;
  /** Things the developer should know, e.g. characters removed for USSD. */
  warnings: string[];
}

export type ChannelKind = "ussd" | "sms";

/** Turns on USSD: numbered menus, screens within the limit, safe characters only. */
export function renderUssd(turn: Turn, ctx: RenderContext, budget: UssdBudget = DEFAULT_USSD_BUDGET): Rendered {
  const warnings: string[] = [];
  const safe = (text: string) => {
    const out = toUssdSafe(text, budget.unsafeChars);
    if (out.removed.length > 0) {
      warnings.push(`Removed characters USSD cannot show: ${out.removed.map((c) => JSON.stringify(c)).join(", ")}`);
    }
    return out.text;
  };
  const moreLine = safe(`${budget.more}. ${ctx.t("common.more")}`);
  const notice = ctx.notice ? [safe(ctx.notice)] : [];

  let pages: string[];
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
    text: pages[page] as string,
    end: final && page === pages.length - 1,
    page,
    pages: pages.length,
    warnings,
  };
}

/** Turns over SMS: one message per turn, within the segment cap. */
export function renderSms(turn: Turn, ctx: RenderContext, budget: SmsBudget = {}): Rendered {
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
      if (turn.question) lines.push(turn.question);
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

export type Interpretation =
  | { type: "more" }
  | { type: "option"; index: number }
  | { type: "answer"; value: string }
  | { type: "yes" }
  | { type: "no" }
  | { type: "invalid"; reason: "common.invalidChoice" | "common.invalidNumber" | "common.typeAnswer" };

export interface InterpretContext {
  kind: ChannelKind;
  t: Translate;
  page: number;
  pages: number;
  /** USSD navigation settings; option numbering must match the renderer's. */
  budget?: Pick<UssdBudget, "more" | "reserved">;
}

/** Reads a user's reply to `turn` the way the renderer laid it out. */
export function interpret(turn: Turn, input: string, ctx: InterpretContext): Interpretation {
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
        index = turn.options.findIndex((o) => o.label.trim().toLowerCase() === lower);
      }
      return index >= 0 ? { type: "option", index } : { type: "invalid", reason: "common.invalidChoice" };
    }

    case "ask":
      if (value === "") return { type: "invalid", reason: "common.typeAnswer" };
      if (turn.input === "number" && !/^\d+(?:[.,]\d+)?$/.test(value)) {
        return { type: "invalid", reason: "common.invalidNumber" };
      }
      return { type: "answer", value };

    case "confirm": {
      const [yes, no] = confirmLabels(turn, ctx.t);
      const lower = value.toLowerCase();
      if (value === "1" || lower === yes.toLowerCase() || lower === ctx.t("common.yes").toLowerCase()) {
        return { type: "yes" };
      }
      if (value === "2" || lower === no.toLowerCase() || lower === ctx.t("common.no").toLowerCase()) {
        return { type: "no" };
      }
      return { type: "invalid", reason: "common.invalidChoice" };
    }

    case "pay":
      throw new NotSupportedError("The pay turn arrives in 0.2 and cannot take input yet");

    default:
      return assertNever(turn);
  }
}

function confirmLabels(turn: ConfirmTurn, t: Translate): [string, string] {
  return [turn.yes ?? t("common.yes"), turn.no ?? t("common.no")];
}

function clamp(page: number, pages: number): number {
  return Math.min(Math.max(Math.trunc(page) || 0, 0), pages - 1);
}
