/**
 * A nurse model that asks Google's Gemini API.
 *
 *   GEMINI_API_KEY=...   (from your shell, never from a file in this repository)
 *   GEMINI_MODEL=gemini-3.5-flash-lite pnpm demo
 *
 * Kalangu itself knows nothing about Gemini: this is the whole integration, an
 * object whose `answer` the handler calls. Only the question and the nurse's
 * instructions are sent to Google, never the caller's phone number.
 */

import { clean, describe, fitSms, langOf, SYSTEM, UNAVAILABLE } from "./answer.js";
import type { NurseModel } from "./nurse.js";

export const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

export interface GeminiNurseOptions {
  /** The model id, e.g. "gemini-3.5-flash-lite". */
  model: string;
  apiKey: string;
  /** Give up on a reply after this long. Default 30 s. */
  timeoutMs?: number;
  /** Segments an answer may take as an SMS. Default 4, Kalangu's own cap. */
  maxSegments?: number;
  /** For tests. */
  fetch?: typeof fetch;
  /** Where failures are reported. Default console.warn. */
  warn?: (message: string) => void;
}

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> }; finishReason?: string }>;
  promptFeedback?: { blockReason?: string };
  error?: { message?: string };
}

export function geminiNurse(options: GeminiNurseOptions): NurseModel {
  if (!options.apiKey) throw new TypeError("geminiNurse needs an API key (GEMINI_API_KEY)");
  const doFetch = options.fetch ?? fetch;
  const warn = options.warn ?? ((m: string) => console.warn(m));
  const maxSegments = options.maxSegments ?? 4;
  const url = `${GEMINI_ENDPOINT}/${encodeURIComponent(options.model)}:generateContent`;

  return {
    async answer(question, locale) {
      const lang = langOf(locale);
      try {
        const res = await doFetch(url, {
          method: "POST",
          // The key goes in a header, never in the URL, where logs and proxies would keep it.
          headers: { "content-type": "application/json", "x-goog-api-key": options.apiKey },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: SYSTEM[lang] }] },
            contents: [{ role: "user", parts: [{ text: question }] }],
          }),
          signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
        });
        const data = (await res.json().catch(() => ({}))) as GeminiResponse;
        if (!res.ok) throw new Error(`Gemini answered ${res.status}${data.error?.message ? `: ${data.error.message}` : ""}`);
        if (data.promptFeedback?.blockReason) throw new Error(`Gemini blocked the question (${data.promptFeedback.blockReason})`);
        const candidate = data.candidates?.[0];
        // Thinking models can return their reasoning as parts marked `thought`: never send those.
        const raw = (candidate?.content?.parts ?? [])
          .filter((p) => !p.thought)
          .map((p) => p.text ?? "")
          .join("");
        const text = clean(raw);
        if (!text) throw new Error(`Gemini returned no answer${candidate?.finishReason ? ` (${candidate.finishReason})` : ""}`);
        return fitSms(text, maxSegments);
      } catch (err) {
        warn(`[clinic] Gemini (${options.model}) failed: ${describe(err)}`);
        return UNAVAILABLE[lang];
      }
    },
  };
}
