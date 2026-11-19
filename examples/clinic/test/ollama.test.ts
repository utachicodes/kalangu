import { describe, expect, it } from "vitest";
import { smsLength } from "@kalangu/core";
import { clean, fitSms } from "../src/answer.js";
import { nurseFromEnv } from "../src/nurses.js";
import { normalizeHost, ollamaNurse } from "../src/ollama.js";

function fakeOllama(reply: { status?: number; body: unknown }) {
  const calls: Array<{ url: string; body: any }> = [];
  const fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200 });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

const quiet = () => {};

describe("the Ollama nurse", () => {
  it("asks Ollama's chat API for one non-streamed answer in the user's language", async () => {
    const o = fakeOllama({ body: { message: { content: "Closed on Sundays." } } });
    const nurse = ollamaNurse({ model: "llama3.2", host: "http://box:11434/", fetch: o.fetch, warn: quiet });
    expect(await nurse.answer("Open on Sunday?", "fr")).toBe("Closed on Sundays.");
    expect(o.calls[0]!.url).toBe("http://box:11434/api/chat");
    expect(o.calls[0]!.body).toMatchObject({ model: "llama3.2", stream: false });
    expect(o.calls[0]!.body.messages[0].content).toContain("français");
    expect(o.calls[0]!.body.messages[1]).toEqual({ role: "user", content: "Open on Sunday?" });
  });

  it("answers with an apology, and says why in the log, when Ollama fails", async () => {
    const warnings: string[] = [];
    const o = fakeOllama({ status: 404, body: { error: 'model "nope" not found' } });
    const nurse = ollamaNurse({ model: "nope", fetch: o.fetch, warn: (m) => void warnings.push(m) });
    expect(await nurse.answer("hi", "en")).toMatch(/^Sorry, the nurse cannot answer/);
    expect(warnings[0]).toMatch(/404: model "nope" not found/);
  });

  it("drops a reasoning block and formatting", () => {
    expect(clean("<think>long\nthoughts</think>\n**Rest** and   drink water.")).toBe("Rest and drink water.");
  });

  it("keeps a USSD code while removing markdown", () => {
    expect(clean("Dial *384*1# to book.")).toBe("Dial *384*1# to book.");
    expect(clean("# Answer\n- Rest\n- Drink *plenty* of water")).toBe("Answer Rest Drink plenty of water");
    expect(clean("Use `code` _here_ please")).toBe("Use code here please");
  });

  it("reads OLLAMA_HOST as Ollama does: port 11434 unless a scheme or port is given", () => {
    expect(normalizeHost("localhost")).toBe("http://localhost:11434");
    expect(normalizeHost("0.0.0.0")).toBe("http://0.0.0.0:11434");
    expect(normalizeHost("10.0.0.5:9999")).toBe("http://10.0.0.5:9999");
    expect(normalizeHost("https://ollama.example.com/")).toBe("https://ollama.example.com");
  });

  it("keeps a long answer within the SMS cap, at a sentence end where it can", async () => {
    const long = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} is here.`).join(" ");
    const o = fakeOllama({ body: { message: { content: long } } });
    const answer = await ollamaNurse({ model: "m", fetch: o.fetch, warn: quiet }).answer("q", "en");
    expect(smsLength(answer).segments).toBeLessThanOrEqual(4);
    expect(answer.endsWith("is here.")).toBe(true);
    expect(fitSms("Short.", 4)).toBe("Short.");
    const words = fitSms("word ".repeat(400).trim(), 1);
    expect(words.endsWith("...")).toBe(true);
    expect(smsLength(words).segments).toBe(1);
  });

  it("is used only when OLLAMA_MODEL is set", () => {
    expect(nurseFromEnv({}).description).toMatch(/fake nurse/);
    expect(nurseFromEnv({ OLLAMA_MODEL: "llama3.2", OLLAMA_HOST: "127.0.0.1:9999" }).description).toBe(
      "Ollama model llama3.2 at http://127.0.0.1:9999",
    );
  });
});
