/**
 * Which nurse model the demo and the server use, from the environment:
 *
 *   GEMINI_MODEL (with GEMINI_API_KEY)   Google's Gemini API
 *   OLLAMA_MODEL (and OLLAMA_HOST)       a local Ollama model
 *   neither                              the fake nurse: no key, no network
 */

import { geminiNurse } from "./gemini.js";
import { fakeNurse, type NurseModel } from "./nurse.js";
import { normalizeHost, ollamaNurse } from "./ollama.js";

export function nurseFromEnv(env: NodeJS.ProcessEnv = process.env): { model: NurseModel; description: string } {
  const gemini = env["GEMINI_MODEL"];
  if (gemini) {
    const apiKey = env["GEMINI_API_KEY"];
    if (!apiKey) throw new Error("GEMINI_MODEL is set but GEMINI_API_KEY is not: export your key in this shell first");
    return { model: geminiNurse({ model: gemini, apiKey }), description: `Gemini model ${gemini}` };
  }
  const ollama = env["OLLAMA_MODEL"];
  if (ollama) {
    const host = env["OLLAMA_HOST"] ? normalizeHost(env["OLLAMA_HOST"]) : undefined;
    return {
      model: ollamaNurse({ model: ollama, ...(host ? { host } : {}) }),
      description: `Ollama model ${ollama} at ${host ?? "http://localhost:11434"}`,
    };
  }
  return { model: fakeNurse(), description: "the fake nurse (6 s, canned answers)" };
}
