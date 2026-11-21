import { describe, expect, it } from "vitest";
import { geminiHandler } from "../src/geminiFunction.js";
import { remoteGemini } from "../src/gemini.js";

const SITE = "https://kalangu.utachi.website";

function fakeGoogle(answer: unknown, status = 200) {
  const calls: Array<{ url: string; key: string | null; body: any }> = [];
  const fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, key: new Headers(init.headers).get("x-goog-api-key"), body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify(status === 200 ? { candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] } }] } : { error: { message: "secret detail" } }), { status });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}
const post = (body: unknown, origin = SITE, ip = "1.2.3.4") =>
  new Request("https://kalangu.utachi.website/api/ndiedieng/gemini", {
    method: "POST",
    headers: { origin, "x-forwarded-for": ip, "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

describe("the website's Gemini function", () => {
  it("says whether Gemini is available, without the key", async () => {
    const on = await (await geminiHandler({ apiKey: "secret-key", model: "m" })(new Request("https://x/api", { method: "GET" }))).json();
    expect(on).toEqual({ available: true, model: "m", speech: true });
    expect(JSON.stringify(on)).not.toContain("secret-key");
    expect(await (await geminiHandler({ apiKey: undefined })(new Request("https://x/api"))).json()).toEqual({ available: false, model: null, speech: false });
  });

  it("runs a known task with the key held on the server", async () => {
    const g = fakeGoogle({ sql: "SELECT 1", reponse: "" });
    const res = await geminiHandler({ apiKey: "secret-key", fetch: g.fetch })(post({ task: "plan", question: "Combien de villages ?" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ result: { sql: "SELECT 1", reponse: "" } });
    expect(g.calls[0]!.key).toBe("secret-key");
    expect(g.calls[0]!.body.contents[0].parts[0].text).toBe("Combien de villages ?");
  });

  it("is not an open proxy: other origins, other tasks and big bodies are refused", async () => {
    const g = fakeGoogle({});
    const handle = geminiHandler({ apiKey: "k", fetch: g.fetch });
    expect((await handle(post({ task: "plan", question: "q" }, "https://evil.example"))).status).toBe(403);
    expect((await handle(post({ task: "anything", prompt: "write a poem" }))).status).toBe(400);
    expect((await handle(post("x".repeat(1_600_000)))).status).toBe(413);
    expect((await handle(post("{not json"))).status).toBe(400);
    expect(g.calls).toHaveLength(0);
  });

  it("limits each visitor, not everyone", async () => {
    const g = fakeGoogle({ reponse: "ok" });
    const handle = geminiHandler({ apiKey: "k", fetch: g.fetch, perMinute: 2 });
    const task = { task: "plan", question: "q" };
    expect((await handle(post(task))).status).toBe(200);
    expect((await handle(post(task))).status).toBe(200);
    expect((await handle(post(task))).status).toBe(429);
    expect((await handle(post(task, SITE, "5.6.7.8"))).status).toBe(200);
  });

  it("reads an answer aloud with the speech model and voice", async () => {
    const calls: any[] = [];
    const fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "audio/wav", data: "UklGRg==" } }] } }] }));
    }) as unknown as typeof globalThis.fetch;
    const res = await geminiHandler({ apiKey: "k", fetch, speechModel: "tts-model", voice: "Kore" })(post({ task: "speak", text: "7 forages sont en panne." }));
    expect(await res.json()).toEqual({ result: { mimeType: "audio/wav", data: "UklGRg==" } });
    expect(calls[0].url).toContain("/models/tts-model:generateContent");
    expect(calls[0].body.generationConfig).toMatchObject({ responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } } });
    expect(calls[0].body.contents[0].parts[0].text).toBe("7 forages sont en panne."); // only the words to say
    expect((await geminiHandler({ apiKey: "k", fetch })(post({ task: "speak", text: "x".repeat(800) }))).status).toBe(400);
  });

  it("transcribes a recorded question, and only WAV within limits", async () => {
    const calls: any[] = [];
    const fetch = (async (_url: string, init: RequestInit) => {
      calls.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ texte: "Quels forages sont en panne ?" }) }] } }] }));
    }) as unknown as typeof globalThis.fetch;
    const handle = geminiHandler({ apiKey: "k", fetch });
    const res = await handle(post({ task: "transcribe", audio: "UklGRiQAAABXQVZF", mimeType: "audio/wav" }));
    expect(await res.json()).toEqual({ result: { texte: "Quels forages sont en panne ?" } });
    expect(calls[0].contents[0].parts[0]).toEqual({ inlineData: { mimeType: "audio/wav", data: "UklGRiQAAABXQVZF" } });
    expect((await handle(post({ task: "transcribe", audio: "abc", mimeType: "video/mp4" }))).status).toBe(400);
    expect((await handle(post({ task: "transcribe", audio: "<script>", mimeType: "audio/wav" }))).status).toBe(400);
    expect(calls).toHaveLength(1);
  });

  it("reports a Gemini failure without Google's details", async () => {
    const res = await geminiHandler({ apiKey: "k", fetch: fakeGoogle(null, 500).fetch })(post({ task: "classify", text: "forage en panne" }));
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain("secret detail");
  });

  it("is what the browser's remoteGemini talks to", async () => {
    const handle = geminiHandler({ apiKey: "k", fetch: fakeGoogle({ reponse: "58 villages." }).fetch });
    const viaFunction = (async (url: string, init: RequestInit) =>
      handle(new Request(url, { ...init, headers: { ...(init.headers as Record<string, string>), origin: SITE } }))) as unknown as typeof globalThis.fetch;
    const call = remoteGemini("https://kalangu.utachi.website/api/ndiedieng/gemini", viaFunction);
    expect(await call({ task: "answer", question: "q", sql: "SELECT 1", rows: [{ n: 1 }] })).toEqual({ reponse: "58 villages." });
    await expect(call({ task: "plan", question: "" })).rejects.toThrow(/question is missing/);
  });
});
