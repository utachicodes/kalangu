/**
 * A nurse model that asks a local Ollama server (https://ollama.com).
 *
 *   ollama pull llama3.2
 *   OLLAMA_MODEL=llama3.2 pnpm demo
 *
 * Kalangu itself knows nothing about Ollama: this is the whole integration,
 * an object whose `answer` the handler calls. A local model is often slower
 * than the 4 s USSD deadline, so expect most answers to arrive by SMS.
 */

import { budgetSms, BudgetError } from "@kalangu/core";
import { fakeNurse, type NurseModel } from "./nurse.js";

export interface OllamaNurseOptions {
  /** The model's name in Ollama, e.g. "llama3.2". */
  model: string;
  /** Default http://localhost:11434, Ollama's own default. */
  host?: string;
  /** Give up on a reply after this long. Default 120 s. */
  timeoutMs?: number;
  /** Segments an answer may take as an SMS. Default 4, Kalangu's own cap. */
  maxSegments?: number;
  /** For tests. */
  fetch?: typeof fetch;
  /** Where failures are reported. Default console.warn. */
  warn?: (message: string) => void;
}

const SYSTEM = {
  en: "You are a nurse answering questions sent to a clinic from basic phones. Reply in English, in plain text with no formatting, in at most 2 short sentences. For anything urgent, say to come to the clinic or go to the district hospital.",
  fr: "Vous êtes une infirmière qui répond aux questions envoyées à une clinique depuis des téléphones simples. Répondez en français, en texte simple sans mise en forme, en 2 phrases courtes au plus. Pour toute urgence, dites de venir à la clinique ou d'aller à l'hôpital de district.",
};

const UNAVAILABLE = {
  en: "Sorry, the nurse cannot answer right now. Please call the clinic.",
  fr: "Désolé, l'infirmière ne peut pas répondre pour le moment. Appelez la clinique.",
};

export function ollamaNurse(options: OllamaNurseOptions): NurseModel {
  const host = (options.host ?? "http://localhost:11434").replace(/\/+$/, "");
  const doFetch = options.fetch ?? fetch;
  const warn = options.warn ?? ((m: string) => console.warn(m));
  const maxSegments = options.maxSegments ?? 4;

  return {
    async answer(question, locale) {
      const lang = locale === "fr" ? "fr" : "en";
      try {
        const res = await doFetch(`${host}/api/chat`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: options.model,
            stream: false,
            options: { num_predict: 150 },
            messages: [
              { role: "system", content: SYSTEM[lang] },
              { role: "user", content: question },
            ],
          }),
          signal: AbortSignal.timeout(options.timeoutMs ?? 120_000),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(`Ollama answered ${res.status}${body?.error ? `: ${body.error}` : ""}`);
        }
        const data = (await res.json()) as { message?: { content?: string } };
        const text = clean(data.message?.content ?? "");
        if (!text) throw new Error("Ollama returned an empty answer");
        return fitSms(text, maxSegments);
      } catch (err) {
        warn(`[clinic] Ollama at ${host} failed (${describe(err)}). Is it running (ollama serve) with ${options.model} pulled?`);
        return UNAVAILABLE[lang];
      }
    },
  };
}

/** The Ollama nurse when OLLAMA_MODEL is set, otherwise the fake one. */
export function nurseFromEnv(env: NodeJS.ProcessEnv = process.env): { model: NurseModel; description: string } {
  const name = env["OLLAMA_MODEL"];
  if (!name) return { model: fakeNurse(), description: "the fake nurse (6 s, canned answers)" };
  const host = env["OLLAMA_HOST"] ? normalizeHost(env["OLLAMA_HOST"]) : undefined;
  return {
    model: ollamaNurse({ model: name, ...(host ? { host } : {}) }),
    description: `Ollama model ${name} at ${host ?? "http://localhost:11434"}`,
  };
}

/** OLLAMA_HOST may be "127.0.0.1:11434", as Ollama itself accepts. */
function normalizeHost(value: string): string {
  return /^https?:\/\//.test(value) ? value : `http://${value}`;
}

/** Plain text: no reasoning block, no markdown emphasis, single spaces. */
export function clean(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/[*_`#]+/g, "")
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

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
