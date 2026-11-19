#!/usr/bin/env node
/**
 * Checks the packages as npm users get them, before they are published:
 * packs the four packages with `pnpm pack` (which rewrites `workspace:*` to
 * real versions), installs the tarballs in an empty folder, and there runs
 * the installed `kalangu` command, imports every package, typechecks a
 * TypeScript file against the published types, and runs an agent on the
 * simulator. Catches what the workspace hides: a file missing from `files`,
 * a broken `bin`, `exports` or types path, a dependency left as `workspace:*`.
 *
 *   pnpm build && node scripts/pack-check.mjs
 *
 * No network beyond what `npm install` of local tarballs needs (none, as the
 * packages have no other dependencies). Node 20 or later.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGES = ["core", "ussd", "sms", "sim"];

const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

function step(name, fn) {
  process.stdout.write(`- ${name} ... `);
  const note = fn();
  process.stdout.write(`ok${note ? ` (${note})` : ""}\n`);
}

const work = mkdtempSync(join(tmpdir(), "kalangu-pack-"));
const tarballs = join(work, "tarballs");
const app = join(work, "app");
let failed = false;

try {
  step("pack the four packages", () => {
    for (const name of PACKAGES) {
      run("pnpm", ["pack", "--pack-destination", tarballs], join(ROOT, "packages", name));
    }
    const files = readdirSync(tarballs);
    if (files.length !== PACKAGES.length) throw new Error(`expected ${PACKAGES.length} tarballs, got ${files.join(", ")}`);
    return files.join(", ");
  });

  step("no dependency left as workspace:*", () => {
    for (const file of readdirSync(tarballs)) {
      const manifest = run("tar", ["-xzOf", join(tarballs, file), "package/package.json"]);
      if (manifest.includes("workspace:")) throw new Error(`${file} still has a workspace: dependency`);
    }
  });

  step("install the tarballs in an empty project", () => {
    run("mkdir", ["-p", app]);
    writeFileSync(join(app, "package.json"), JSON.stringify({ name: "pack-check", private: true, type: "module" }));
    const files = readdirSync(tarballs).map((f) => join(tarballs, f));
    run("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error", ...files], app);
  });

  step("the installed kalangu command runs", () => {
    writeFileSync(join(app, "wo.json"), JSON.stringify({ "common.yes": "Waaw", "payments.confirm": "Fey {amount} {currency}?" }));
    let out = "";
    try {
      out = run(join(app, "node_modules", ".bin", "kalangu"), ["locale", "check", "wo.json"], app);
    } catch (err) {
      // Exit 1 is expected: the sample loses placeholders. What matters is that it ran and checked.
      out = `${err.stdout ?? ""}`;
    }
    if (!/lost the placeholder \{payee\}/.test(out)) throw new Error(`unexpected output:\n${out}`);
  });

  step("every package imports from plain Node", () => {
    const code = PACKAGES.map((p) => `import * as ${p} from "@kalangu/${p}";`).join("\n") +
      `\nconst names = { ${PACKAGES.map((p) => `${p}: Object.keys(${p}).length`).join(", ")} };` +
      "\nfor (const [k, n] of Object.entries(names)) if (n === 0) throw new Error(k + ' exports nothing');" +
      "\nconsole.log(JSON.stringify(names));";
    writeFileSync(join(app, "imports.mjs"), code);
    return run("node", ["imports.mjs"], app).trim();
  });

  step("the published types typecheck", () => {
    writeFileSync(
      join(app, "types.ts"),
      `import { ask, createAgent, menu, say, type TurnContext } from "@kalangu/core";
import { africasTalkingUssd } from "@kalangu/ussd";
import { africasTalkingSms } from "@kalangu/sms";
import { createPhone } from "@kalangu/sim";
const model = { answer: async (q: string): Promise<string> => q };
export const agent = createAgent({
  model,
  channels: [africasTalkingUssd({ code: "*384*1#" }), africasTalkingSms({ username: "sandbox", apiKey: "x", sandbox: true })],
  start: menu("Clinic", { Ask: ask("Question?", (q: string, ctx: TurnContext<typeof model>) => ctx.model.answer(q)), Hours: say("8 to 18") }),
});
export const phone = createPhone(agent, { code: "*384*1#" });
`,
    );
    writeFileSync(
      join(app, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { strict: true, noEmit: true, module: "nodenext", moduleResolution: "nodenext", target: "es2022", skipLibCheck: false, types: [] }, files: ["types.ts"] }),
    );
    run(join(ROOT, "node_modules", ".bin", "tsc"), ["-p", "tsconfig.json"], app);
  });

  step("an agent runs on the simulator", () => {
    writeFileSync(
      join(app, "agent.mjs"),
      `import { ask, createAgent, menu, say, silentLogger } from "@kalangu/core";
import { createPhone } from "@kalangu/sim";
const agent = createAgent({
  model: { answer: async (q) => "You asked: " + q },
  channels: [],
  logger: silentLogger,
  start: menu("Clinic line", { "Opening hours": say("Open 8 to 18."), "Ask a nurse": ask("Type your question", (q, ctx) => ctx.model.answer(q)) }),
});
const phone = createPhone(agent, { code: "*384*1#" });
const screens = [await phone.dial("*384*1#"), await phone.press("2"), await phone.press("Open on Sunday?")];
const want = ["Clinic line\\n1. Opening hours\\n2. Ask a nurse", "Type your question", "You asked: Open on Sunday?"];
screens.forEach((s, i) => { if (s.text !== want[i]) throw new Error("screen " + i + ": " + JSON.stringify(s.text)); });
if (!screens[2].end) throw new Error("the last screen should end the session");
`,
    );
    run("node", ["agent.mjs"], app);
  });
} catch (err) {
  failed = true;
  process.stdout.write("FAILED\n");
  process.stderr.write(`${[err.stdout, err.stderr].filter(Boolean).join("\n") || err.message}\n`);
} finally {
  rmSync(work, { recursive: true, force: true });
}

process.stdout.write(failed ? "\nThe packed packages are not right.\n" : `\nThe packed packages work as installed (Node ${process.versions.node}).\n`);
process.exitCode = failed ? 1 : 0;
