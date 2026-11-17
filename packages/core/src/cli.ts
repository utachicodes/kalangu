#!/usr/bin/env node
/**
 * `kalangu locale check <file>`: checks a translation file
 * (docs/languages-design.md §8). Node only, and kept out of the package's
 * main export so the engine stays runtime-agnostic.
 */

import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { checkLocale, formatReport } from "./localeCheck.js";

export interface CliIo {
  stdout(text: string): void;
  stderr(text: string): void;
  /** Loads a translation file into an object of messages. Replaceable for tests. */
  load(path: string): Promise<Record<string, unknown>>;
}

const USAGE = `Usage: kalangu locale check <file> [options]

Checks a translation file against the built-in English messages: missing and
unknown keys, lost {placeholders}, and how each string fits a USSD screen and
an SMS.

<file> is a .json file (an object of messages), or a .js/.mjs module whose
default export, or "messages" export, is that object. A .ts file works on
Node 22.18 or later.

Options:
  --locale <code>  the language code (default: the file name, e.g. wo.json is wo)
  --complete       a missing key is an error (default: a warning, since a
                   partial translation falls back to the default language)
  --strict         warnings fail the check too
  --verbose        also show notes, such as letters USSD shows differently
  --help           this text

Exit status: 0 if the check passes, 1 if it does not, 2 for a usage error.`;

export async function main(argv: readonly string[], io: CliIo = nodeIo()): Promise<number> {
  const args = [...argv];
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    io.stdout(USAGE);
    return args.length === 0 ? 2 : 0;
  }
  if (args[0] !== "locale" || args[1] !== "check") {
    io.stderr(`Unknown command: ${args.slice(0, 2).join(" ")}\n\n${USAGE}`);
    return 2;
  }

  let file: string | undefined;
  let locale: string | undefined;
  const flags = { complete: false, strict: false, verbose: false };
  for (let i = 2; i < args.length; i++) {
    const arg = args[i] as string;
    if (arg === "--locale") {
      locale = args[++i];
      if (!locale) return usageError(io, "--locale needs a language code");
    } else if (arg === "--complete" || arg === "--strict" || arg === "--verbose") {
      flags[arg.slice(2) as keyof typeof flags] = true;
    } else if (arg.startsWith("-")) {
      return usageError(io, `Unknown option ${arg}`);
    } else if (file === undefined) {
      file = arg;
    } else {
      return usageError(io, `Only one file at a time, got ${file} and ${arg}`);
    }
  }
  if (file === undefined) return usageError(io, "Give the file to check");

  let messages: Record<string, unknown>;
  try {
    messages = await io.load(file);
  } catch (err) {
    io.stderr(`Could not read ${file}: ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }

  const code = locale ?? basename(file, extname(file));
  const report = checkLocale(code, messages, { complete: flags.complete });
  io.stdout(formatReport(report, { verbose: flags.verbose }));
  return report.errors > 0 || (flags.strict && report.warnings > 0) ? 1 : 0;
}

function usageError(io: CliIo, message: string): number {
  io.stderr(`${message}\n\n${USAGE}`);
  return 2;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reads a translation file into its object of messages. Throws a readable error if it cannot. */
export async function loadMessagesFile(path: string): Promise<Record<string, unknown>> {
  const full = resolve(path);
  let data: unknown;
  if (extname(full) === ".json") {
    data = JSON.parse(await readFile(full, "utf8"));
  } else {
    try {
      const loaded = (await import(pathToFileURL(full).href)) as { default?: unknown; messages?: unknown };
      data = loaded.default ?? loaded.messages;
    } catch (err) {
      if (extname(full) === ".ts") {
        throw new Error(
          `TypeScript files need Node 22.18 or later, or convert it to .json (${err instanceof Error ? err.message : String(err)})`,
        );
      }
      throw err;
    }
  }
  // A file may wrap the messages: { "messages": { … } }. "messages" is never a message key.
  if (isRecord(data) && isRecord(data["messages"])) data = data["messages"];
  if (!isRecord(data)) throw new Error("the file must hold an object of messages");
  return data;
}

function nodeIo(): CliIo {
  return {
    stdout: (text) => process.stdout.write(`${text}\n`),
    stderr: (text) => process.stderr.write(`${text}\n`),
    load: loadMessagesFile,
  };
}

/**
 * True when `entry` (what Node was told to run, `process.argv[1]`) is this
 * module. npm installs a package's command as a symlink
 * (`node_modules/.bin/kalangu` to `dist/cli.js`), so both sides are resolved
 * to their real paths before comparing; comparing the raw paths made the
 * installed command silently do nothing.
 */
export function isEntryPoint(entry: string | undefined, moduleUrl: string): boolean {
  if (!entry) return false;
  try {
    return realpathSync(resolve(entry)) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}

// Run only when started as a command, never when imported (by the tests).
if (isEntryPoint(process.argv[1], import.meta.url)) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
