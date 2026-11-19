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

import { clean, describe, fitSms, langOf, SYSTEM, UNAVAILABLE } from "./answer.js";
import type { NurseModel } from "./nurse.js";

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

export function ollamaNurse(options: OllamaNurseOptions): NurseModel {
  const host = (options.host ?? "http://localhost:11434").replace(/\/+$/, "");
  const doFetch = options.fetch ?? fetch;
  const warn = options.warn ?? ((m: string) => console.warn(m));
  const maxSegments = options.maxSegments ?? 4;

  return {
    async answer(question, locale) {
      const lang = langOf(locale);
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

/**
 * OLLAMA_HOST as Ollama itself reads it: "localhost" or "0.0.0.0:11434"
 * without a scheme means http on Ollama's port 11434 unless one is given; a
 * full URL such as https://ollama.example.com keeps its scheme's own port.
 */
export function normalizeHost(value: string): string {
  const trimmed = value.trim();
  const hasScheme = /^https?:\/\//i.test(trimmed);
  const url = new URL(hasScheme ? trimmed : `http://${trimmed}`);
  if (!hasScheme && url.port === "") url.port = "11434";
  return url.origin + url.pathname.replace(/\/+$/, "");
}
