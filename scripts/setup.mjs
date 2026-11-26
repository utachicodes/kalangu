#!/usr/bin/env node
/**
 * Sets up a fresh clone in one command: checks Node, installs every package
 * with the pnpm version the repository pins, and builds. It needs nothing but
 * Node, so it works before pnpm is installed, and it is safe to run again: when
 * nothing has changed since the last run it says so and stops.
 *
 *   node scripts/setup.mjs           set up, or confirm it is already done
 *   node scripts/setup.mjs --force   install and build again anyway
 *
 * VS Code runs it when the folder opens (.vscode/tasks.json, "Kalangu: set up").
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
/** The packages need Node 20; the Ndiédieng example needs 22.13 (node:sqlite). */
export const NODE_RECOMMENDED = [22, 13];
export const NODE_MINIMUM = [20, 0];
const STAMP = join(ROOT, "node_modules", ".kalangu-setup");
const PACKAGES = ["core", "ussd", "sms", "sim"];

/** True when `version` ("v22.13.1" or "22.13.1") is at least `[major, minor]`. */
export function atLeast(version, [major, minor]) {
  const [maj = 0, min = 0] = version.replace(/^v/, "").split(".").map(Number);
  return maj > major || (maj === major && min >= minor);
}

/** The pnpm version in a package.json's `packageManager` field ("pnpm@12.6.0+sha…" → "12.6.0"), or null. */
export function pinnedPnpm(packageJson) {
  const match = /^pnpm@(\d+\.\d+\.\d+)/.exec(packageJson.packageManager ?? "");
  return match ? match[1] : null;
}

/** What a finished setup depends on: the lockfile, the pinned pnpm and the Node major version. */
export function fingerprint(lockfile, pnpmVersion, nodeVersion) {
  return createHash("sha256")
    .update(lockfile)
    .update(`\0${pnpmVersion ?? ""}\0${nodeVersion.replace(/^v/, "").split(".")[0]}`)
    .digest("hex");
}

const say = (line = "") => process.stdout.write(`${line}\n`);
const run = (command, args) =>
  spawnSync(command, args, { cwd: ROOT, stdio: "inherit", shell: process.platform === "win32" }).status === 0;
const quiet = (command, args) =>
  spawnSync(command, args, { cwd: ROOT, stdio: "ignore", shell: process.platform === "win32" }).status === 0;

function nextSteps(pnpm) {
  say();
  say("Next:");
  say(`  ${pnpm} demo      a keypad phone in your terminal (dial *384*1#)`);
  say(`  ${pnpm} test      every test`);
  say(`  ${pnpm} --filter @kalangu/example-ndiedieng start   the Ndiédieng example on http://localhost:3000`);
  say("  Docs: https://kalangu.utachi.website/docs/");
}

function main(argv) {
  const force = argv.includes("--force");
  say("Kalangu setup");
  say();

  // 1. Node.
  const node = process.versions.node;
  if (!atLeast(node, NODE_MINIMUM)) {
    say(`Node ${node} is too old: Kalangu needs Node 20 or later, and 22.13 or later for the Ndiédieng example.`);
    say(
      process.platform === "win32"
        ? "Install the LTS from https://nodejs.org, or in PowerShell: winget install OpenJS.NodeJS.LTS. Then open a new terminal and run this again."
        : "Install the LTS from https://nodejs.org, then open a new terminal and run this again.",
    );
    return 1;
  }
  say(`Node ${node}: ok`);
  if (!atLeast(node, NODE_RECOMMENDED)) {
    say("  The packages work on it, but the Ndiédieng example needs Node 22.13 or later.");
  }

  // 2. pnpm: the one on the PATH (it switches to the pinned version itself), else the pinned one through npx.
  const pinned = pinnedPnpm(JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")));
  let pnpm = ["pnpm", []];
  if (quiet("pnpm", ["--version"])) {
    say("pnpm: ok");
  } else {
    pnpm = ["npx", ["--yes", `pnpm@${pinned ?? "latest"}`]];
    say(`pnpm is not installed: using pnpm ${pinned} through npx for this setup.`);
    say(`  To install it for good: npm install -g pnpm@${pinned}`);
  }
  const pnpmCommand = pnpm[0] === "pnpm" ? "pnpm" : `npx pnpm@${pinned}`;
  const withPnpm = (args) => run(pnpm[0], [...pnpm[1], ...args]);

  // 3. Already done?
  const print = fingerprint(readFileSync(join(ROOT, "pnpm-lock.yaml")), pinned, node);
  const built = PACKAGES.every((name) => existsSync(join(ROOT, "packages", name, "dist")));
  if (!force && built && existsSync(STAMP) && readFileSync(STAMP, "utf8").trim() === print) {
    say();
    say("Already set up: nothing changed since the last run. (node scripts/setup.mjs --force to redo it.)");
    nextSteps(pnpmCommand);
    return 0;
  }

  // 4. Install exactly what the lockfile says, then build.
  say();
  say("Installing packages…");
  if (!withPnpm(["install", "--frozen-lockfile"])) {
    say();
    say("Installing failed (the error is above). Check your connection and run this again.");
    return 1;
  }
  say();
  say("Building…");
  if (!withPnpm(["build"])) {
    say();
    say("The build failed (the error is above). If you changed code, fix it and run this again.");
    return 1;
  }
  writeFileSync(STAMP, `${print}\n`);
  say();
  say("Kalangu is set up.");
  nextSteps(pnpmCommand);
  return 0;
}

const invoked = process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (invoked) process.exit(main(process.argv.slice(2)));
