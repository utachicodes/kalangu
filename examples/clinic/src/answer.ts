/**
 * What every real nurse model in this example shares: its instructions, the
 * apology when the model cannot answer, and turning the model's text into a
 * message that fits a phone (plain text, within Kalangu's SMS cap).
 */

import { budgetSms, BudgetError } from "@kalangu/core";

export type Lang = "en" | "fr";

export const langOf = (locale: string): Lang => (locale === "fr" ? "fr" : "en");

export const SYSTEM = {
  en: "You are a nurse answering questions sent to a clinic from basic phones. Reply in English, in plain text with no formatting, in at most 2 short sentences. For anything urgent, say to come to the clinic or go to the district hospital.",
  fr: "Vous êtes une infirmière qui répond aux questions envoyées à une clinique depuis des téléphones simples. Répondez en français, en texte simple sans mise en forme, en 2 phrases courtes au plus. Pour toute urgence, dites de venir à la clinique ou d'aller à l'hôpital de district.",
};

export const UNAVAILABLE = {
  en: "Sorry, the nurse cannot answer right now. Please call the clinic.",
  fr: "Désolé, l'infirmière ne peut pas répondre pour le moment. Appelez la clinique.",
};

/**
 * Plain text: no reasoning block, no markdown, single spaces. Only markdown
 * is removed, never a lone * or #, so a USSD code such as *384*1# survives.
 */
export function clean(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "") // headings
    .replace(/^\s*[-*+]\s+/gm, "") // list bullets
    .replace(/(\*\*|__)(.+?)\1/g, "$2") // bold
    .replace(/(^|[\s(])([*_])(\S(?:.*?\S)?)\2(?=[\s).,!?;:]|$)/g, "$1$3") // italics
    .replace(/`+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Kalangu refuses an SMS over the segment cap rather than cutting it, so the
 * model's answer is shortened here, where the example decides how: to the
 * last whole sentence that fits, or else whole words and "...".
 */
export function fitSms(text: string, maxSegments: number): string {
  if (fits(text, maxSegments)) return text;
  const sentences = text.match(/[^.!?]+[.!?]+/g) ?? [];
  let kept = "";
  for (const s of sentences) {
    const next = (kept + s).trim();
    if (!fits(next, maxSegments)) break;
    kept = next;
  }
  if (kept) return kept;
  const words = text.split(" ");
  while (words.length > 1 && !fits(`${words.join(" ")}...`, maxSegments)) words.pop();
  return `${words.join(" ")}...`;
}

function fits(text: string, maxSegments: number): boolean {
  try {
    budgetSms(text, { maxSegments });
    return true;
  } catch (err) {
    if (err instanceof BudgetError) return false;
    throw err;
  }
}

export function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
