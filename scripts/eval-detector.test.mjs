// Run with: node --test "scripts/**/*.test.mjs"   (the --ascii test needs `pnpm build` first)
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, it } from "node:test";
import { main, parseSamples, resolveDetector, runDetector, summarize, wordCount } from "./eval-detector.mjs";

/** A detector that answers from a table: text -> { code, confidence } or null. */
function tableDetector(answers) {
  const calls = [];
  return {
    calls,
    async detect(text, { candidates }) {
      calls.push({ text, candidates });
      return answers[text] ?? null;
    },
  };
}

const run = (samples, detector, candidates = ["en", "fr"]) => runDetector(samples, detector, { candidates, timeoutMs: 1000 });

describe("parseSamples", () => {
  it("reads TSV, skipping blanks and comments, and reports bad lines", () => {
    const { samples, problems } = parseSamples("# comment\nen\tHello there\n\nfr\tBonjour\nno tab here\nen\t\n");
    assert.deepEqual(samples, [
      { code: "en", text: "Hello there" },
      { code: "fr", text: "Bonjour" },
    ]);
    assert.deepEqual(problems, ["line 5: expected <code><TAB><text>", "line 6: no text"]);
  });

  it("reads JSONL", () => {
    const { samples, problems } = parseSamples('{"code":"wo","text":"x y"}\nnot json\n', { jsonl: true });
    assert.deepEqual(samples, [{ code: "wo", text: "x y" }]);
    assert.deepEqual(problems, ["line 2: not valid JSON"]);
  });

  it("counts words", () => {
    assert.equal(wordCount("  one  two\tthree "), 3);
  });
});

describe("summarize", () => {
  const samples = [
    { code: "en", text: "is it open today" }, // right, confident
    { code: "en", text: "ok" }, // wrong, confident: a false offer only if minChars allows 2 chars
    { code: "en", text: "see you tomorrow" }, // wrong, unsure
    { code: "fr", text: "est-ce ouvert" }, // right, unsure
    { code: "fr", text: "bof" }, // no answer
    { code: "xx", text: "lorem ipsum dolor" }, // in no candidate language, answered confidently
  ];
  const detector = tableDetector({
    "is it open today": { code: "en", confidence: 0.95 },
    ok: { code: "fr", confidence: 0.9 },
    "see you tomorrow": { code: "fr", confidence: 0.6 },
    "est-ce ouvert": { code: "fr", confidence: 0.7 },
    "lorem ipsum dolor": { code: "en", confidence: 0.85 },
  });

  it("scores each language, the confusion matrix and length", async () => {
    const report = summarize(await run(samples, detector), { candidates: ["en", "fr"], thresholds: [0.8], minChars: [1] });
    const byCode = Object.fromEntries(report.perLanguage.map((l) => [l.code, l]));
    assert.deepEqual([byCode.en.correct, byCode.en.samples], [1, 3]);
    assert.deepEqual([byCode.fr.correct, byCode.fr.noAnswer], [1, 1]);
    assert.equal(byCode.xx.accuracy, null);
    assert.deepEqual(report.confusion.columns, ["en", "fr", "xx", "(none)"]);
    assert.deepEqual(report.confusion.rows.find((r) => r.code === "en").counts, [1, 2, 0, 0]);
    assert.deepEqual(report.confusion.rows.find((r) => r.code === "xx").counts, [1, 0, 0, 0]);
    assert.deepEqual(
      report.byLength.map((b) => [b.bucket, b.samples]),
      [["1 word", 2], ["2 words", 1], ["3-5 words", 2]],
    );
  });

  it("counts false offers under Kalangu's rule, including text in no candidate language", async () => {
    const report = summarize(await run(samples, detector), { candidates: ["en", "fr"], thresholds: [0.5, 0.8], minChars: [1, 5] });
    const at = (t, m) => report.sweep.find((s) => s.threshold === t && s.minChars === m);
    // threshold 0.8, minChars 1: "ok" -> fr and "lorem" -> en are false; "is it open today" caught.
    assert.deepEqual([at(0.8, 1).falseOffers, at(0.8, 1).caught], [2, 1]);
    // minChars 5 drops "ok".
    assert.deepEqual([at(0.8, 5).falseOffers, at(0.8, 5).caught], [1, 1]);
    // threshold 0.5 also lets the unsure ones through.
    assert.deepEqual([at(0.5, 5).falseOffers, at(0.5, 5).caught], [2, 2]);
    assert.equal(at(0.8, 1).falseOfferRate, 2 / 6);
    assert.equal(at(0.8, 1).catchRate, 1 / 5);
  });

  it("suggests the setting that catches most within the false-offer limit, cautious on ties", async () => {
    const results = await run(samples, detector);
    const loose = summarize(results, { candidates: ["en", "fr"], thresholds: [0.5, 0.8], minChars: [1, 5], maxFalse: 0.4 });
    assert.deepEqual([loose.suggestion.threshold, loose.suggestion.minChars], [0.5, 5]);
    const strict = summarize(results, { candidates: ["en", "fr"], thresholds: [0.5, 0.8], minChars: [1, 5], maxFalse: 0 });
    assert.equal(strict.suggestion, null);
  });

  it("flags answers outside the candidates, bad scores, errors and slow calls", async () => {
    const bad = {
      async detect(text) {
        if (text === "boom") throw new Error("model down");
        if (text === "slow") return new Promise((r) => setTimeout(() => r({ code: "en", confidence: 0.9 }), 30));
        if (text === "odd") return { code: "de", confidence: 0.9 };
        return { code: "en", confidence: 7 };
      },
    };
    const results = await runDetector(
      [
        { code: "en", text: "boom" },
        { code: "en", text: "slow" },
        { code: "en", text: "odd" },
        { code: "en", text: "score" },
      ],
      bad,
      { candidates: ["en", "fr"], timeoutMs: 10 },
    );
    const report = summarize(results, { candidates: ["en", "fr"], timeoutMs: 10 });
    assert.deepEqual(report.contract, { outsideCandidates: 1, badScores: 1, errors: 1 });
    assert.equal(report.latency.overTimeout, 1);
    // A late answer is known, but Kalangu would have ignored it: of "slow" and "score"
    // (both en, confident), only "score" counts. Its score of 7 passes Kalangu's
    // `confidence >= threshold` too, which is why the contract flags it.
    assert.ok(report.sweep.filter((s) => s.minChars === 1).every((s) => s.caught === 1));
  });
});

describe("runDetector", () => {
  it("moves on from a detector that never answers, as Kalangu would", async () => {
    const hung = { detect: () => new Promise(() => {}) };
    const results = await runDetector([{ code: "en", text: "is it open" }], hung, { candidates: ["en"], timeoutMs: 10 });
    assert.equal(results[0].timedOut, true);
    assert.equal(results[0].result, null);
  });
});

describe("resolveDetector", () => {
  const detect = async () => null;
  it("accepts a default export, a named export, and a factory", async () => {
    assert.equal(typeof (await resolveDetector({ default: { detect } })).detect, "function");
    assert.equal(typeof (await resolveDetector({ detector: { detect } })).detect, "function");
    assert.equal(typeof (await resolveDetector({ default: async () => ({ detect }) })).detect, "function");
    await assert.rejects(resolveDetector({ default: {} }), /must export a detector/);
  });
});

describe("main", () => {
  function io(files, mod) {
    const out = [];
    const err = [];
    return {
      out,
      err,
      io: {
        stdout: (t) => void out.push(t),
        stderr: (t) => void err.push(t),
        readFile: async (p) => {
          if (!(p in files)) throw new Error("ENOENT");
          return files[p];
        },
        importModule: async () => mod,
        loadCore: () => import(pathToFileURL(resolve("packages/core/dist/index.js")).href),
      },
    };
  }
  const data = "en\tis it open today\nfr\test-ce ouvert aujourd'hui\n";
  const detector = { default: tableDetector({ "is it open today": { code: "en", confidence: 0.9 } }) };

  it("prints a report", async () => {
    const t = io({ "s.tsv": data }, detector);
    assert.equal(await main(["--detector", "d.mjs", "--data", "s.tsv"], t.io), 0);
    const text = t.out.join("\n");
    assert.match(text, /2 samples; candidates: en, fr/);
    assert.match(text, /Confusion/);
    assert.match(text, /false offers/);
  });

  it("prints JSON with --json, and honours --candidates", async () => {
    const t = io({ "s.tsv": data }, detector);
    assert.equal(await main(["--detector", "d.mjs", "--data", "s.tsv", "--json", "--candidates", "en,fr,wo"], t.io), 0);
    assert.deepEqual(JSON.parse(t.out[0]).candidates, ["en", "fr", "wo"]);
    assert.deepEqual(detector.default.calls.at(-1).candidates, ["en", "fr", "wo"]);
  });

  it("folds text to ASCII with --ascii, as typed on a keypad", async () => {
    const seen = tableDetector({});
    const t = io({ "s.tsv": "fr\tmon enfant a de la fièvre\n" }, { default: seen });
    assert.equal(await main(["--detector", "d.mjs", "--data", "s.tsv", "--ascii"], t.io), 0);
    assert.equal(seen.calls[0].text, "mon enfant a de la fievre");
  });

  it("refuses bad arguments and reports unreadable input", async () => {
    assert.equal(await main(["--data", "s.tsv"], io({}, detector).io), 2);
    assert.equal(await main(["--detector", "d.mjs", "--data", "s.tsv", "--thresholds", "2"], io({}, detector).io), 2);
    assert.equal(await main(["--detector", "d.mjs", "--data", "s.tsv", "--bogus"], io({}, detector).io), 2);
    const missing = io({}, detector);
    assert.equal(await main(["--detector", "d.mjs", "--data", "nope.tsv"], missing.io), 1);
    assert.match(missing.err.join("\n"), /Cannot read nope.tsv/);
    const notADetector = io({ "s.tsv": data }, { default: {} });
    assert.equal(await main(["--detector", "d.mjs", "--data", "s.tsv"], notADetector.io), 1);
    assert.equal(await main(["--help"], io({}, detector).io), 0);
  });

  it("runs on the example files", async () => {
    const mod = await import(pathToFileURL(resolve("scripts/detector-eval/example-detector.mjs")).href);
    const files = { "example.tsv": await (await import("node:fs/promises")).readFile("scripts/detector-eval/example.tsv", "utf8") };
    const t = io(files, mod);
    assert.equal(await main(["--detector", "d.mjs", "--data", "example.tsv"], t.io), 0);
    assert.match(t.out.join("\n"), /16 samples; candidates: en, fr/);
  });
});
