import { describe, expect, it } from "vitest";
import { smsLength } from "@kalangu/core";
import { geminiNurse } from "../src/gemini.js";
import { nurseFromEnv } from "../src/nurses.js";

const KEY = "test-key-not-real";

function fakeGemini(reply: { status?: number; body: unknown }) {
  const calls: Array<{ url: string; headers: Record<string, string>; body: any }> = [];
  const fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200 });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

const answer = (text: string, extra: object = {}) => ({ candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP", ...extra }] });
const quiet = () => {};

describe("the Gemini nurse", () => {
  it("asks generateContent with the key in a header, in the user's language", async () => {
    const g = fakeGemini({ body: answer("Closed on Sundays.") });
    const nurse = geminiNurse({ model: "gemini-3.5-flash-lite", apiKey: KEY, fetch: g.fetch, warn: quiet });
    expect(await nurse.answer("Ouvert dimanche ?", "fr")).toBe("Closed on Sundays.");
    const call = g.calls[0]!;
    expect(call.url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent");
    expect(call.url).not.toContain(KEY);
    expect(call.headers["x-goog-api-key"]).toBe(KEY);
    expect(call.body.systemInstruction.parts[0].text).toContain("français");
    expect(call.body.contents).toEqual([{ role: "user", parts: [{ text: "Ouvert dimanche ?" }] }]);
  });

  it("never sends the model's thinking, and cleans and fits the answer", async () => {
    const long = Array.from({ length: 40 }, (_, i) => `Sentence ${i} is here.`).join(" ");
    const g = fakeGemini({
      body: { candidates: [{ content: { parts: [{ text: "secret reasoning", thought: true }, { text: `**Rest.** ${long}` }] } }] },
    });
    const text = await geminiNurse({ model: "m", apiKey: KEY, fetch: g.fetch, warn: quiet }).answer("q", "en");
    expect(text).not.toContain("secret reasoning");
    expect(text.startsWith("Rest.")).toBe(true);
    expect(smsLength(text).segments).toBeLessThanOrEqual(4);
  });

  it("apologises, and says why in the log, on an error, a block or an empty answer", async () => {
    for (const [reply, why] of [
      [{ status: 400, body: { error: { message: "API key not valid." } } }, /400: API key not valid/],
      [{ body: { promptFeedback: { blockReason: "SAFETY" } } }, /blocked the question \(SAFETY\)/],
      [{ body: { candidates: [{ content: { parts: [] }, finishReason: "MAX_TOKENS" }] } }, /no answer \(MAX_TOKENS\)/],
    ] as const) {
      const warnings: string[] = [];
      const g = fakeGemini(reply);
      const nurse = geminiNurse({ model: "m", apiKey: KEY, fetch: g.fetch, warn: (m) => void warnings.push(m) });
      expect(await nurse.answer("q", "en")).toMatch(/^Sorry, the nurse cannot answer/);
      expect(warnings[0]).toMatch(why);
      expect(warnings[0]).not.toContain(KEY);
    }
  });

  it("is picked by GEMINI_MODEL, and refuses to start without a key", () => {
    expect(nurseFromEnv({ GEMINI_MODEL: "gemini-3.5-flash-lite", GEMINI_API_KEY: KEY }).description).toBe(
      "Gemini model gemini-3.5-flash-lite",
    );
    expect(() => nurseFromEnv({ GEMINI_MODEL: "gemini-3.5-flash-lite" })).toThrow(/GEMINI_API_KEY is not/);
    expect(nurseFromEnv({ GEMINI_MODEL: "g", GEMINI_API_KEY: KEY, OLLAMA_MODEL: "llama3.2" }).description).toMatch(/^Gemini/);
  });
});
