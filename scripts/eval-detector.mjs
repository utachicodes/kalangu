#!/usr/bin/env node
/**
 * Measures a language detector on a labelled file, the way Kalangu would use
 * it (docs/languages-design.md §12 items 2 to 4, §13 item 6).
 *
 * Kalangu ships no detector and no default threshold, because nothing has
 * been measured. This script is how to measure one: per-language accuracy and
 * a confusion matrix, accuracy by length (short keypad text is the question),
 * a threshold sweep under Kalangu's own rule with the false-offer rate for
 * each, latency against the timeout, and any answer outside the candidates.
 *
 *   node scripts/eval-detector.mjs --detector ./my-detector.mjs --data samples.tsv
 *
 * Nothing is sent anywhere by this script; what the detector does is up to it.
 * No dependencies; Node 20 or later. `--ascii` needs `pnpm build` first.
 */

import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const DEFAULT_THRESHOLDS = [0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 0.99];
export const DEFAULT_MIN_CHARS = [1, 10, 20];
/** Below this many samples in a language, the report says its numbers are rough. */
export const FEW_SAMPLES = 100;
/** Words per sample, the buckets the report breaks accuracy into. */
export const WORD_BUCKETS = [
  { label: "1 word", min: 1, max: 1 },
  { label: "2 words", min: 2, max: 2 },
  { label: "3-5 words", min: 3, max: 5 },
  { label: "6-10 words", min: 6, max: 10 },
  { label: "11+ words", min: 11, max: Infinity },
];

const USAGE = `Usage: node scripts/eval-detector.mjs --detector <module> --data <file> [options]

Runs a language detector over labelled samples and reports how it would behave
inside Kalangu: accuracy per language and by length, a confusion matrix, the
false-offer rate at each threshold, and latency.

  --detector <module>   an ES module exporting the detector: a default export or
                        \`detector\` with detect(text, { candidates }), or a
                        function returning one (it may be async)
  --data <file>         labelled samples: TSV lines \`<code><TAB><text>\`, or a
                        .jsonl file of {"code", "text"}; # starts a comment.
                        A code outside the candidates marks text in none of the
                        agent's languages: any confident answer is a false offer
  --candidates <codes>  the agent's languages, comma-separated
                        (default: every code in the data)
  --thresholds <list>   thresholds to sweep (default ${DEFAULT_THRESHOLDS.join(",")})
  --min-chars <list>    minChars values to sweep (default ${DEFAULT_MIN_CHARS.join(",")})
  --max-false <rate>    the false-offer rate you can accept, for the suggestion
                        (default 0.02, that is 2%)
  --timeout-ms <ms>     the detection timeout to measure against (default 1000)
  --ascii               fold the text to plain ASCII first, as a keypad user
                        types it and USSD shows it (needs \`pnpm build\`)
  --json                print the report as JSON
  --help                show this message`;

/** Reads labelled samples from TSV (`code<TAB>text`) or JSONL. */
export function parseSamples(content, { jsonl = false } = {}) {
  const samples = [];
  const problems = [];
  content.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) return;
    const where = `line ${index + 1}`;
    let code;
    let text;
    if (jsonl) {
      try {
        ({ code, text } = JSON.parse(line));
      } catch {
        problems.push(`${where}: not valid JSON`);
        return;
      }
    } else {
      const tab = raw.indexOf("\t");
      if (tab < 0) {
        problems.push(`${where}: expected <code><TAB><text>`);
        return;
      }
      code = raw.slice(0, tab).trim();
      text = raw.slice(tab + 1).trim();
    }
    if (typeof code !== "string" || !/^[A-Za-z][\w-]*$/.test(code)) {
      problems.push(`${where}: missing or invalid language code`);
      return;
    }
    if (typeof text !== "string" || text === "") {
      problems.push(`${where}: no text`);
      return;
    }
    samples.push({ code, text });
  });
  return { samples, problems };
}

export function wordCount(text) {
  return text.split(/\s+/).filter(Boolean).length;
}

/** Calls the detector on each sample in turn, timing each call. */
export async function runDetector(samples, detector, { candidates, timeoutMs, now = () => performance.now() }) {
  const results = [];
  for (const sample of samples) {
    const started = now();
    let result = null;
    let error;
    let timedOut = false;
    let timer;
    try {
      const call = Promise.resolve().then(() => detector.detect(sample.text, { candidates }));
      const late = new Promise((resolve) => {
        // Measured, not enforced on the work: a call past the timeout still finishes,
        // so its answer is known, but Kalangu would have ignored it.
        timer = setTimeout(() => resolve("late"), timeoutMs);
      });
      const first = await Promise.race([call.then(() => "done"), late]);
      result = await call;
      timedOut = first === "late";
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      clearTimeout(timer);
    }
    const ms = now() - started;
    results.push({ ...sample, chars: sample.text.trim().length, words: wordCount(sample.text), result, ms, timedOut, error });
  }
  return results;
}

/** Whether Kalangu would make an offer for this answer, under its own rule (agent.ts, detectLanguage). */
function wouldOffer(r, threshold, minChars, candidates) {
  if (r.error || r.timedOut || !r.result) return null;
  if (r.chars < minChars || !/\p{L}/u.test(r.text)) return null;
  if (!candidates.includes(r.result.code)) return null;
  if (!(r.result.confidence >= threshold)) return null;
  return r.result.code;
}

const pct = (n, d) => (d === 0 ? null : n / d);

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i];
}

/** Turns per-sample results into the report. Pure: no I/O. */
export function summarize(results, { candidates, thresholds = DEFAULT_THRESHOLDS, minChars = DEFAULT_MIN_CHARS, maxFalse = 0.02, timeoutMs = 1000 }) {
  const NONE = "(none)";
  const labels = [...new Set(results.map((r) => r.code))].sort();
  const predicted = (r) => (r.error || r.timedOut || !r.result ? NONE : r.result.code);

  const perLanguage = labels.map((code) => {
    const rows = results.filter((r) => r.code === code);
    const inCandidates = candidates.includes(code);
    const correct = inCandidates ? rows.filter((r) => predicted(r) === code).length : 0;
    return {
      code,
      inCandidates,
      samples: rows.length,
      correct,
      accuracy: inCandidates ? pct(correct, rows.length) : null,
      noAnswer: rows.filter((r) => predicted(r) === NONE).length,
    };
  });

  const columns = [...new Set([...labels, ...results.map(predicted)])].sort((a, b) =>
    a === NONE ? 1 : b === NONE ? -1 : a.localeCompare(b),
  );
  const confusion = {
    columns,
    rows: labels.map((code) => ({
      code,
      counts: columns.map((col) => results.filter((r) => r.code === code && predicted(r) === col).length),
    })),
  };

  const labelled = results.filter((r) => candidates.includes(r.code));
  const byLength = WORD_BUCKETS.map((b) => {
    const rows = labelled.filter((r) => r.words >= b.min && r.words <= b.max);
    return { bucket: b.label, samples: rows.length, accuracy: pct(rows.filter((r) => predicted(r) === r.code).length, rows.length) };
  }).filter((b) => b.samples > 0);

  // Each sample read as typed by a user whose language is its label. An offer of
  // any other language is a false offer: it would interrupt them. An offer of the
  // label is the detector catching their language, which is what helps a user who
  // is in the wrong one.
  const sweep = [];
  for (const m of minChars) {
    for (const t of thresholds) {
      let falseOffers = 0;
      let caught = 0;
      for (const r of results) {
        const offer = wouldOffer(r, t, m, candidates);
        if (offer === null) continue;
        if (offer === r.code) caught++;
        else falseOffers++;
      }
      sweep.push({
        threshold: t,
        minChars: m,
        falseOfferRate: pct(falseOffers, results.length),
        falseOffers,
        catchRate: pct(caught, labelled.length),
        caught,
      });
    }
  }
  const acceptable = sweep
    .filter((s) => s.falseOfferRate !== null && s.falseOfferRate <= maxFalse && s.caught > 0)
    // Most caught; on a tie, fewest false offers, then the more cautious setting,
    // which holds up better on text the samples did not cover.
    .sort(
      (a, b) =>
        b.catchRate - a.catchRate ||
        a.falseOfferRate - b.falseOfferRate ||
        b.threshold - a.threshold ||
        b.minChars - a.minChars,
    );
  const suggestion = acceptable[0] ?? null;

  const times = results.map((r) => r.ms).sort((a, b) => a - b);
  const latency = {
    p50: percentile(times, 50),
    p95: percentile(times, 95),
    max: times.at(-1) ?? null,
    overTimeout: results.filter((r) => r.timedOut).length,
    timeoutMs,
  };

  const outsideCandidates = results.filter((r) => r.result && !candidates.includes(r.result.code)).length;
  const badScores = results.filter(
    (r) => r.result && !(typeof r.result.confidence === "number" && r.result.confidence >= 0 && r.result.confidence <= 1),
  ).length;
  const errors = results.filter((r) => r.error).length;

  return {
    samples: results.length,
    candidates,
    perLanguage,
    confusion,
    byLength,
    sweep,
    maxFalse,
    suggestion,
    latency,
    contract: { outsideCandidates, badScores, errors },
  };
}

const fmtPct = (x) => (x === null ? "-" : `${(x * 100).toFixed(1)}%`);
const fmtMs = (x) => (x === null ? "-" : `${x.toFixed(1)} ms`);

function table(header, rows) {
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
  const line = (cells) => cells.map((c, i) => String(c).padEnd(widths[i])).join("  ").trimEnd();
  return [line(header), line(widths.map((w) => "-".repeat(w))), ...rows.map(line)].join("\n");
}

export function formatReport(report, { ascii = false } = {}) {
  const out = [];
  out.push(`${report.samples} samples; candidates: ${report.candidates.join(", ")}${ascii ? "; text folded to ASCII" : ""}`);
  const few = report.perLanguage.filter((l) => l.samples < FEW_SAMPLES).map((l) => l.code);
  if (few.length > 0) out.push(`Fewer than ${FEW_SAMPLES} samples for ${few.join(", ")}: treat these numbers as rough.`);

  out.push("\nPer language (top answer, ignoring the threshold)");
  out.push(
    table(
      ["lang", "samples", "correct", "accuracy", "no answer"],
      report.perLanguage.map((l) => [
        l.inCandidates ? l.code : `${l.code} (not a candidate)`,
        l.samples,
        l.inCandidates ? l.correct : "-",
        fmtPct(l.accuracy),
        l.noAnswer,
      ]),
    ),
  );

  out.push("\nConfusion (rows: label, columns: answer)");
  out.push(table(["", ...report.confusion.columns], report.confusion.rows.map((r) => [r.code, ...r.counts])));

  if (report.byLength.length > 0) {
    out.push("\nAccuracy by length");
    out.push(table(["length", "samples", "accuracy"], report.byLength.map((b) => [b.bucket, b.samples, fmtPct(b.accuracy)])));
  }

  out.push("\nKalangu's rule: an offer needs the answer at or above the threshold, and at least minChars");
  out.push("False offer: a language other than the one the user wrote in. Caught: the right one.");
  out.push(
    table(
      ["minChars", "threshold", "false offers", "caught"],
      report.sweep.map((s) => [s.minChars, s.threshold, `${fmtPct(s.falseOfferRate)} (${s.falseOffers})`, `${fmtPct(s.catchRate)} (${s.caught})`]),
    ),
  );
  if (report.suggestion) {
    const s = report.suggestion;
    out.push(
      `\nWith false offers at most ${fmtPct(report.maxFalse)}: threshold ${s.threshold}, minChars ${s.minChars}` +
        ` (false offers ${fmtPct(s.falseOfferRate)}, caught ${fmtPct(s.catchRate)}).` +
        "\nOnly as good as the samples: measure on real, keypad-typed messages before relying on it.",
    );
  } else {
    out.push(`\nNo setting keeps false offers at or under ${fmtPct(report.maxFalse)} while catching anything: do not turn detection on with this detector.`);
  }

  const l = report.latency;
  out.push(`\nLatency: p50 ${fmtMs(l.p50)}, p95 ${fmtMs(l.p95)}, max ${fmtMs(l.max)}; ${l.overTimeout} over the ${l.timeoutMs} ms timeout`);

  const c = report.contract;
  const issues = [];
  if (c.outsideCandidates) issues.push(`${c.outsideCandidates} answers outside the candidates (Kalangu ignores them; the detector should not give them)`);
  if (c.badScores) issues.push(`${c.badScores} answers with a confidence that is not a number from 0 to 1`);
  if (c.errors) issues.push(`${c.errors} calls threw (Kalangu carries on without detection)`);
  out.push(issues.length ? `\nContract: ${issues.join("; ")}` : "\nContract: every answer was a candidate with a score from 0 to 1");
  return out.join("\n");
}

function parseArgs(argv) {
  const opts = { ascii: false, json: false, help: false, maxFalse: 0.02, timeoutMs: 1000 };
  const list = (v, name) => {
    const items = String(v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    if (items.length === 0) throw new Error(`${name} needs a value`);
    return items;
  };
  const numbers = (v, name) =>
    list(v, name).map((s) => {
      const n = Number(s);
      if (!Number.isFinite(n)) throw new Error(`${name}: ${JSON.stringify(s)} is not a number`);
      return n;
    });
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${arg} needs a value`);
      return v;
    };
    if (arg === "--help" || arg === "-h") opts.help = true;
    else if (arg === "--detector") opts.detector = value();
    else if (arg === "--data") opts.data = value();
    else if (arg === "--candidates") opts.candidates = list(value(), arg);
    else if (arg === "--thresholds") opts.thresholds = numbers(value(), arg);
    else if (arg === "--min-chars") opts.minChars = numbers(value(), arg);
    else if (arg === "--max-false") [opts.maxFalse] = numbers(value(), arg);
    else if (arg === "--timeout-ms") [opts.timeoutMs] = numbers(value(), arg);
    else if (arg === "--ascii") opts.ascii = true;
    else if (arg === "--json") opts.json = true;
    else throw new Error(`Unknown option ${arg}`);
  }
  if (opts.thresholds?.some((t) => !(t > 0 && t <= 1))) throw new Error("--thresholds must be above 0 and at most 1");
  if (opts.minChars?.some((m) => !(Number.isInteger(m) && m >= 1))) throw new Error("--min-chars must be whole numbers of at least 1");
  if (!(opts.maxFalse >= 0 && opts.maxFalse <= 1)) throw new Error("--max-false must be from 0 to 1");
  if (!(opts.timeoutMs > 0)) throw new Error("--timeout-ms must be positive");
  return opts;
}

/** Accepts `export default detector`, `export const detector`, or a (possibly async) factory of either. */
export async function resolveDetector(mod) {
  let found = mod?.default ?? mod?.detector ?? mod?.createDetector;
  if (typeof found === "function" && typeof found.detect !== "function") found = await found();
  if (!found || typeof found.detect !== "function") {
    throw new Error("The module must export a detector with detect(text, { candidates }), or a function that returns one");
  }
  return found;
}

export async function main(argv, io = defaultIo()) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    io.stderr(`${err.message}\n\n${USAGE}`);
    return 2;
  }
  if (opts.help) {
    io.stdout(USAGE);
    return 0;
  }
  if (!opts.detector || !opts.data) {
    io.stderr(`--detector and --data are both required.\n\n${USAGE}`);
    return 2;
  }

  let content;
  try {
    content = await io.readFile(opts.data);
  } catch (err) {
    io.stderr(`Cannot read ${opts.data}: ${err.message}`);
    return 1;
  }
  const { samples, problems } = parseSamples(content, { jsonl: opts.data.endsWith(".jsonl") });
  for (const p of problems) io.stderr(`${opts.data}, ${p}`);
  if (samples.length === 0) {
    io.stderr(`No samples in ${opts.data}.`);
    return 1;
  }

  let detector;
  try {
    detector = await resolveDetector(await io.importModule(opts.detector));
  } catch (err) {
    io.stderr(`Cannot load the detector ${opts.detector}: ${err.message}`);
    return 1;
  }

  let prepared = samples;
  if (opts.ascii) {
    let core;
    try {
      core = await io.loadCore();
    } catch {
      io.stderr("--ascii needs the built core: run `pnpm build` first.");
      return 1;
    }
    prepared = samples.map((s) => ({ ...s, text: core.toUssdSafe(s.text).text }));
  }

  const candidates = opts.candidates ?? [...new Set(samples.map((s) => s.code))].sort();
  const results = await runDetector(prepared, detector, { candidates, timeoutMs: opts.timeoutMs, ...(io.now ? { now: io.now } : {}) });
  const report = summarize(results, {
    candidates,
    ...(opts.thresholds ? { thresholds: opts.thresholds } : {}),
    ...(opts.minChars ? { minChars: opts.minChars } : {}),
    maxFalse: opts.maxFalse,
    timeoutMs: opts.timeoutMs,
  });
  io.stdout(opts.json ? JSON.stringify(report, null, 2) : formatReport(report, { ascii: opts.ascii }));
  return problems.length > 0 ? 1 : 0;
}

function defaultIo() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  return {
    stdout: (t) => process.stdout.write(`${t}\n`),
    stderr: (t) => process.stderr.write(`${t}\n`),
    readFile: (p) => readFile(resolve(p), "utf8"),
    importModule: (p) => import(pathToFileURL(resolve(p)).href),
    loadCore: () => import(pathToFileURL(resolve(root, "packages/core/dist/index.js")).href),
  };
}

function startedDirectly() {
  try {
    return Boolean(process.argv[1]) && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (startedDirectly()) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      process.stderr.write(`${err?.stack ?? err}\n`);
      process.exitCode = 1;
    },
  );
}
