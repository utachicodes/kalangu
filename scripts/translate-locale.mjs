#!/usr/bin/env node
/**
 * Drafts a translation of Kalangu's fixed strings with Gemini, then runs the
 * locale checker on the result (docs/languages-design.md §9).
 *
 * A draft, never a finished translation: models are weaker in Wolof, Hausa
 * and other African languages than they look, and nobody who cannot read the
 * language can tell. The output is marked as an unreviewed machine draft, and
 * a native speaker must review it before it ships.
 *
 *   pnpm build
 *   export GEMINI_API_KEY=...        # yours; never paste it into a chat, issue or commit
 *   node scripts/translate-locale.mjs wo --name Wolof --reference fr
 *
 * Only the English (and optional reference) fixed strings are sent to Google:
 * no user data. No dependencies; Node 20 or later.
 */

import { existsSync, realpathSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const DEFAULT_MODEL = "gemini-3.5-flash-lite";
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

const USAGE = `Usage: node scripts/translate-locale.mjs <code> --name <Language> [options]

Drafts Kalangu's fixed strings in another language with Gemini, writes them to
locales/<code>.draft.json, and runs the locale checker on the draft.

  <code>               the language code, e.g. wo, ha, sw
  --name <Language>    the language's name in English, e.g. Wolof (required)
  --reference <code>   also send this built-in translation as a second source,
                       e.g. fr for languages mostly spoken alongside French
  --model <id>         Gemini model (default ${DEFAULT_MODEL})
  --out <file>         where to write (default locales/<code>.draft.json)
  --force              overwrite an existing file
  --dry-run            print the request that would be sent, without the key; send nothing
  --from-response <f>  use a saved Gemini response instead of calling the API (for tests)
  --help               this text

Reads the API key from GEMINI_API_KEY. Run \`pnpm build\` first.`;

/** `{name}` placeholders in a string, sorted and unique. */
export function placeholdersOf(text) {
  return [...new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort();
}

/** The generateContent request body. Never contains the API key. */
export function buildRequest({ code, name, english, reference }) {
  const keys = Object.keys(english);
  const source = Object.fromEntries(
    keys.map((key) => [key, reference ? { en: english[key], [reference.code]: reference.messages[key] } : english[key]]),
  );
  const system = [
    `You translate the fixed interface strings of Kalangu, a toolkit for SMS and USSD services that people use on basic keypad phones in Africa.`,
    `Translate each string into ${name} (language code "${code}") as everyday speakers write it: plain, short and polite. Use the language's standard spelling.`,
    `Rules:`,
    `- Keep every placeholder in curly braces exactly as written, including the word inside, e.g. {amount}, {yes}, {currency}. You may move it within the sentence. Never translate, remove or add one.`,
    `- Keep each string as short as the English or shorter: it appears on a 160-character phone screen.`,
    `- The keys describe where each string appears (common.yes is a "Yes" choice, payments.receipt is an SMS receipt). Do not translate the keys.`,
    reference
      ? `- Each source string is given in English and in ${reference.name}. Use both to get the meaning right.`
      : `- Translate from the English.`,
    `- Answer with one JSON object with exactly the same keys and the translated strings as values. Nothing else.`,
  ].join("\n");
  return {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: [{ text: JSON.stringify(source, null, 2) }] }],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: "application/json",
      responseJsonSchema: {
        type: "object",
        properties: Object.fromEntries(keys.map((key) => [key, { type: "string" }])),
        required: keys,
        additionalProperties: false,
      },
    },
  };
}

/**
 * The translated messages from a generateContent response, checked to have
 * exactly the expected keys. Throws a readable error for a blocked or cut-off
 * answer, or one that is not the JSON asked for.
 */
export function parseResponse(response, keys) {
  if (response?.promptFeedback?.blockReason) {
    throw new Error(`Gemini blocked the request (${response.promptFeedback.blockReason})`);
  }
  const candidate = response?.candidates?.[0];
  if (!candidate) throw new Error("Gemini returned no answer");
  if (candidate.finishReason && candidate.finishReason !== "STOP") {
    throw new Error(`Gemini stopped early (${candidate.finishReason}); the draft would be incomplete`);
  }
  const text = (candidate.content?.parts ?? []).map((p) => p.text ?? "").join("");
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Gemini's answer was not valid JSON");
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error("Gemini's answer was not an object of messages");
  }
  const missing = keys.filter((k) => typeof data[k] !== "string");
  const extra = Object.keys(data).filter((k) => !keys.includes(k));
  if (missing.length > 0) throw new Error(`Gemini's answer is missing: ${missing.join(", ")}`);
  if (extra.length > 0) throw new Error(`Gemini's answer has keys Kalangu does not use: ${extra.join(", ")}`);
  return Object.fromEntries(keys.map((k) => [k, data[k]]));
}

/** What gets written: the messages, wrapped with a note that says what they are. */
export function draftFile({ code, name, model, messages, date }) {
  return {
    _draft: {
      language: `${name} (${code})`,
      by: `Machine draft by ${model}`,
      date,
      reviewed: false,
      note: "Not reviewed. A native speaker must check every string before this ships; until then it is experimental.",
    },
    messages,
  };
}

function parseArgs(argv) {
  const args = { code: undefined, name: undefined, reference: undefined, model: DEFAULT_MODEL, out: undefined };
  const flags = { force: false, dryRun: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      const v = argv[++i];
      if (!v || v.startsWith("--")) throw new Error(`${arg} needs a value`);
      return v;
    };
    if (arg === "--help" || arg === "-h") flags.help = true;
    else if (arg === "--name") args.name = value();
    else if (arg === "--reference") args.reference = value();
    else if (arg === "--model") args.model = value();
    else if (arg === "--out") args.out = value();
    else if (arg === "--from-response") args.fromResponse = value();
    else if (arg === "--force") flags.force = true;
    else if (arg === "--dry-run") flags.dryRun = true;
    else if (arg.startsWith("-")) throw new Error(`Unknown option ${arg}`);
    else if (args.code === undefined) args.code = arg;
    else throw new Error(`Only one language at a time, got ${args.code} and ${arg}`);
  }
  return { ...args, ...flags };
}

/** Runs the command. Returns the exit status; `io` is replaceable for tests. */
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
  if (!opts.code || !/^[a-z]{2,3}(-[A-Za-z0-9]+)?$/.test(opts.code)) {
    io.stderr(`Give a language code such as wo, ha or sw\n\n${USAGE}`);
    return 2;
  }
  if (!opts.name) {
    io.stderr(`Give the language's name with --name, e.g. --name Wolof\n\n${USAGE}`);
    return 2;
  }

  let core;
  try {
    core = await io.loadCore();
  } catch (err) {
    io.stderr(`Could not load @kalangu/core: run \`pnpm build\` first (${err.message})`);
    return 2;
  }
  const builtIn = core.BUILTIN_MESSAGES;
  if (builtIn[opts.code] && !opts.force) {
    io.stderr(`"${opts.code}" already ships with Kalangu. Use --force to draft it anyway.`);
    return 2;
  }
  let reference;
  if (opts.reference) {
    if (!builtIn[opts.reference] || opts.reference === "en") {
      io.stderr(`--reference must be a built-in translation other than English: ${Object.keys(builtIn).filter((c) => c !== "en").join(", ")}`);
      return 2;
    }
    reference = { code: opts.reference, name: opts.reference === "fr" ? "French" : opts.reference, messages: builtIn[opts.reference] };
  }

  const english = core.en;
  const request = buildRequest({ code: opts.code, name: opts.name, english, reference });
  if (opts.dryRun) {
    io.stdout(`POST ${ENDPOINT}/${opts.model}:generateContent\n(key from GEMINI_API_KEY, sent in the x-goog-api-key header, not shown)\n\n${JSON.stringify(request, null, 2)}`);
    return 0;
  }

  const out = opts.out ?? `locales/${opts.code}.draft.json`;
  if (io.exists(out) && !opts.force) {
    io.stderr(`${out} exists. Use --force to overwrite it, or --out to write elsewhere.`);
    return 2;
  }

  let response;
  if (opts.fromResponse) {
    try {
      response = JSON.parse(await io.readFile(opts.fromResponse));
    } catch (err) {
      io.stderr(`Could not read the saved response ${opts.fromResponse}: ${err.message}`);
      return 2;
    }
  } else {
    const key = io.env.GEMINI_API_KEY;
    if (!key) {
      io.stderr("Set GEMINI_API_KEY in your environment first (export GEMINI_API_KEY=...). Do not paste it anywhere else.");
      return 2;
    }
    io.stderr(`Asking ${opts.model} for a ${opts.name} draft…`);
    let res;
    try {
      res = await io.fetch(`${ENDPOINT}/${encodeURIComponent(opts.model)}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify(request),
      });
    } catch (err) {
      io.stderr(`Could not reach Gemini: ${err.message}. Check the connection and try again.`);
      return 1;
    }
    response = await res.json().catch(() => ({}));
    if (!res.ok) {
      io.stderr(`Gemini answered ${res.status}: ${response?.error?.message ?? res.statusText ?? "no details"}`);
      return 1;
    }
  }

  let messages;
  try {
    messages = parseResponse(response, Object.keys(english));
  } catch (err) {
    io.stderr(err.message);
    return 1;
  }
  const file = draftFile({ code: opts.code, name: opts.name, model: opts.model, messages, date: io.today() });
  try {
    // Checked again here, not only before the request: a file saved at this
    // path while Gemini was answering is not overwritten without --force.
    await io.writeFile(out, `${JSON.stringify(file, null, 2)}\n`, { overwrite: opts.force });
  } catch (err) {
    if (err?.code !== "EEXIST") throw err;
    io.stderr(`${out} was created while the draft was being made. Use --force to overwrite it, or --out to write elsewhere.`);
    return 1;
  }

  const report = core.checkLocale(opts.code, messages, { complete: true });
  io.stdout(`Wrote ${out}\n\n${core.formatReport(report, { verbose: true })}`);
  io.stdout(
    `\nThis is an unreviewed machine draft. Before it ships, a native ${opts.name} speaker must read every string` +
      ` (the checker cannot tell whether a translation is right, only whether it fits).`,
  );
  return report.errors > 0 ? 1 : 0;
}

function defaultIo() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  return {
    stdout: (t) => process.stdout.write(`${t}\n`),
    stderr: (t) => process.stderr.write(`${t}\n`),
    env: process.env,
    fetch: (...args) => globalThis.fetch(...args),
    exists: (p) => existsSync(resolve(p)),
    readFile: (p) => readFile(resolve(p), "utf8"),
    writeFile: async (p, text, { overwrite = false } = {}) => {
      await mkdir(dirname(resolve(p)), { recursive: true });
      await writeFile(resolve(p), text, { flag: overwrite ? "w" : "wx" });
    },
    today: () => new Date().toISOString().slice(0, 10),
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
      process.stderr.write(`translate-locale: ${err?.message ?? String(err)}\n`);
      process.exitCode = 2;
    },
  );
}
