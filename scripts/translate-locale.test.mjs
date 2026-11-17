// Run with: node --test scripts/   (needs `pnpm build` first, for the real core)
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, it } from "node:test";
import { DEFAULT_MODEL, buildRequest, draftFile, main, parseResponse, placeholdersOf } from "./translate-locale.mjs";

const core = await import(pathToFileURL(resolve("packages/core/dist/index.js")).href);
const KEYS = Object.keys(core.en);
const SECRET = "test-key-do-not-print-123";

/** Every English string with a marker, placeholders kept: a "translation" that passes the checker. */
function goodTranslation() {
  return Object.fromEntries(KEYS.map((k) => [k, `xx ${core.en[k]}`]));
}

function geminiResponse(messages, extra = {}) {
  return { candidates: [{ content: { parts: [{ text: JSON.stringify(messages) }] }, finishReason: "STOP" }], ...extra };
}

function stubIo({ response = geminiResponse(goodTranslation()), status = 200, env = { GEMINI_API_KEY: SECRET }, files = {} } = {}) {
  const out = [];
  const err = [];
  const written = {};
  const fetches = [];
  return {
    out,
    err,
    written,
    fetches,
    io: {
      stdout: (t) => void out.push(t),
      stderr: (t) => void err.push(t),
      env,
      fetch: async (url, init) => {
        fetches.push({ url, init });
        return { ok: status < 300, status, statusText: "", json: async () => response };
      },
      exists: (p) => p in files || p in written,
      readFile: async (p) => files[p],
      writeFile: async (p, text) => void (written[p] = text),
      today: () => "2026-11-17",
      loadCore: async () => core,
    },
  };
}

describe("placeholdersOf", () => {
  it("finds each placeholder once, sorted", () => {
    assert.deepEqual(placeholdersOf("Pay {amount} {currency} to {payee}, {amount}"), ["amount", "currency", "payee"]);
  });
});

describe("buildRequest", () => {
  const request = buildRequest({ code: "wo", name: "Wolof", english: core.en });

  it("asks for JSON with exactly Kalangu's keys", () => {
    const schema = request.generationConfig.responseJsonSchema;
    assert.equal(request.generationConfig.responseMimeType, "application/json");
    assert.deepEqual(Object.keys(schema.properties), KEYS);
    assert.deepEqual(schema.required, KEYS);
    assert.equal(schema.additionalProperties, false);
  });

  it("tells the model to keep placeholders and names the language", () => {
    const system = request.systemInstruction.parts[0].text;
    assert.match(system, /Keep every placeholder/);
    assert.match(system, /Wolof \(language code "wo"\)/);
  });

  it("sends the English strings, and a reference translation when asked", () => {
    const sent = JSON.parse(request.contents[0].parts[0].text);
    assert.equal(sent["common.yes"], "Yes");
    const withFr = buildRequest({ code: "wo", name: "Wolof", english: core.en, reference: { code: "fr", name: "French", messages: core.fr } });
    assert.deepEqual(JSON.parse(withFr.contents[0].parts[0].text)["common.yes"], { en: "Yes", fr: "Oui" });
  });
});

describe("parseResponse", () => {
  it("returns the messages in Kalangu's key order", () => {
    const got = parseResponse(geminiResponse(goodTranslation()), KEYS);
    assert.deepEqual(Object.keys(got), KEYS);
  });

  it("refuses a blocked, cut-off, non-JSON or incomplete answer", () => {
    assert.throws(() => parseResponse({ promptFeedback: { blockReason: "SAFETY" } }, KEYS), /blocked/);
    assert.throws(() => parseResponse({ candidates: [] }, KEYS), /no answer/);
    assert.throws(() => parseResponse({ candidates: [{ content: { parts: [{ text: "{}" }] }, finishReason: "MAX_TOKENS" }] }, KEYS), /stopped early/);
    assert.throws(() => parseResponse({ candidates: [{ content: { parts: [{ text: "not json" }] }, finishReason: "STOP" }] }, KEYS), /not valid JSON/);
    const missing = goodTranslation();
    delete missing["common.yes"];
    assert.throws(() => parseResponse(geminiResponse(missing), KEYS), /missing: common.yes/);
    assert.throws(() => parseResponse(geminiResponse({ ...goodTranslation(), extra: "x" }), KEYS), /keys Kalangu does not use: extra/);
  });
});

describe("draftFile", () => {
  it("marks the file as an unreviewed machine draft", () => {
    const file = draftFile({ code: "wo", name: "Wolof", model: "m", messages: { a: "b" }, date: "2026-11-17" });
    assert.equal(file._draft.reviewed, false);
    assert.match(file._draft.by, /Machine draft by m/);
    assert.deepEqual(file.messages, { a: "b" });
  });
});

describe("main", () => {
  it("drafts, writes locales/<code>.draft.json, runs the checker, and passes a clean draft", async () => {
    const t = stubIo();
    assert.equal(await main(["wo", "--name", "Wolof"], t.io), 0);
    const file = JSON.parse(t.written["locales/wo.draft.json"]);
    assert.equal(file._draft.reviewed, false);
    assert.equal(file.messages["common.yes"], "xx Yes");
    assert.match(t.out.join("\n"), /0 errors/);
    assert.match(t.out.join("\n"), /native Wolof speaker must read every string/);
  });

  it("calls the documented endpoint with the key in a header, never in the body or URL", async () => {
    const t = stubIo();
    await main(["wo", "--name", "Wolof"], t.io);
    const [call] = t.fetches;
    assert.equal(call.url, `https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_MODEL}:generateContent`);
    assert.equal(call.init.headers["x-goog-api-key"], SECRET);
    assert.ok(!call.init.body.includes(SECRET));
    assert.ok(!call.url.includes(SECRET));
  });

  it("never prints the key", async () => {
    for (const argv of [["wo", "--name", "Wolof"], ["wo", "--name", "Wolof", "--dry-run"]]) {
      const t = stubIo();
      await main(argv, t.io);
      assert.ok(![...t.out, ...t.err].join("\n").includes(SECRET), `key printed for ${argv.join(" ")}`);
    }
  });

  it("--dry-run shows the request and sends nothing", async () => {
    const t = stubIo();
    assert.equal(await main(["wo", "--name", "Wolof", "--dry-run"], t.io), 0);
    assert.equal(t.fetches.length, 0);
    assert.match(t.out.join("\n"), /generateContent/);
    assert.deepEqual(t.written, {});
  });

  it("saves a draft with a lost placeholder but fails, naming it", async () => {
    const bad = goodTranslation();
    bad["common.replyYesNo"] = "xx {yes}";
    const t = stubIo({ response: geminiResponse(bad) });
    assert.equal(await main(["wo", "--name", "Wolof"], t.io), 1);
    assert.ok(t.written["locales/wo.draft.json"]);
    assert.match(t.out.join("\n"), /lost the placeholder \{no\}/);
  });

  it("stops without a key, without calling anything", async () => {
    const t = stubIo({ env: {} });
    assert.equal(await main(["wo", "--name", "Wolof"], t.io), 2);
    assert.equal(t.fetches.length, 0);
    assert.match(t.err.join("\n"), /GEMINI_API_KEY/);
  });

  it("reports an API error with Google's message", async () => {
    const t = stubIo({ status: 400, response: { error: { message: "API key not valid." } } });
    assert.equal(await main(["wo", "--name", "Wolof"], t.io), 1);
    assert.match(t.err.join("\n"), /400: API key not valid/);
    assert.deepEqual(t.written, {});
  });

  it("will not overwrite a draft, or redraft a shipped language, without --force", async () => {
    const t = stubIo({ files: { "locales/wo.draft.json": "{}" } });
    assert.equal(await main(["wo", "--name", "Wolof"], t.io), 2);
    assert.equal(await main(["fr", "--name", "French"], stubIo().io), 2);
  });

  it("checks its arguments", async () => {
    assert.equal(await main(["wo"], stubIo().io), 2); // no --name
    assert.equal(await main(["Wolof!", "--name", "Wolof"], stubIo().io), 2);
    assert.equal(await main(["wo", "--name", "Wolof", "--reference", "en"], stubIo().io), 2);
    assert.equal(await main(["wo", "--name", "Wolof", "--bogus"], stubIo().io), 2);
    assert.equal(await main(["--help"], stubIo().io), 0);
  });

  it("can run from a saved response, with no key and no network", async () => {
    const t = stubIo({ env: {}, files: { "saved.json": JSON.stringify(geminiResponse(goodTranslation())) } });
    assert.equal(await main(["ha", "--name", "Hausa", "--from-response", "saved.json"], t.io), 0);
    assert.equal(t.fetches.length, 0);
    assert.ok(t.written["locales/ha.draft.json"]);
  });
});
