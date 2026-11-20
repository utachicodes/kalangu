#!/usr/bin/env node
/**
 * Builds the website's Ndiédieng demo into site/ndiedieng, served at
 * kalangu.utachi.website/ndiedieng with no build step on the host:
 *
 *   index.html, styles.css, ui.js     the page (web/)
 *   app/                              the prototype, compiled for the browser
 *   vendor/core, vendor/sim/phone.js  Kalangu, as built in this repository
 *
 *   pnpm build && node scripts/build-web.mjs           write it
 *   pnpm build && node scripts/build-web.mjs --check   fail if it is out of date
 *
 * The same page is served by server.ts, which talks to it over HTTP instead.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(HERE, "../..");
const OUT = join(ROOT, "site", "ndiedieng");

/** Every file under `dir`, as paths relative to it. */
function walk(dir, base = dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full, base) : [relative(base, full)];
  });
}

export function build() {
  const files = new Map();
  const tmp = mkdtempSync(join(tmpdir(), "ndiedieng-web-"));
  try {
    execFileSync(join(ROOT, "node_modules", ".bin", "tsc"), ["-p", "tsconfig.web.json", "--outDir", tmp], { cwd: HERE, stdio: "pipe" });
    for (const file of walk(tmp)) files.set(join("app", file), readFileSync(join(tmp, file), "utf8"));
  } catch (err) {
    throw new Error(`tsc failed:\n${err.stdout ?? ""}${err.stderr ?? ""}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  const core = join(ROOT, "packages", "core", "dist");
  if (!existsSync(join(core, "index.js"))) throw new Error("Build the packages first: pnpm build");
  for (const file of walk(core)) {
    // The command-line tool uses Node's file system; the browser never loads it.
    if (file.endsWith(".js") && file !== "cli.js") files.set(join("vendor", "core", file), readFileSync(join(core, file), "utf8"));
  }
  files.set(join("vendor", "sim", "phone.js"), readFileSync(join(ROOT, "packages", "sim", "dist", "phone.js"), "utf8"));

  for (const file of ["index.html", "styles.css", "ui.js"]) files.set(file, readFileSync(join(HERE, "web", file), "utf8"));
  // Source maps point at files outside the site; drop the comment.
  for (const [k, v] of files) if (k.endsWith(".js")) files.set(k, v.replace(/\n\/\/# sourceMappingURL=.*$/m, ""));
  return files;
}

async function main(argv) {
  const files = build();
  if (argv.includes("--check")) {
    const stale = [];
    for (const [file, content] of files) {
      const path = join(OUT, file);
      if (!existsSync(path) || readFileSync(path, "utf8") !== content) stale.push(file);
    }
    const extra = existsSync(OUT) ? walk(OUT).filter((f) => !files.has(f)) : [];
    for (const f of stale) console.error(`out of date: site/ndiedieng/${f}`);
    for (const f of extra) console.error(`not built from source: site/ndiedieng/${f}`);
    if (stale.length || extra.length) {
      console.error("Run: pnpm build && pnpm --filter @kalangu/example-ndiedieng build:web");
      return 1;
    }
    console.log(`The Ndiédieng demo is up to date (${files.size} files).`);
    return 0;
  }
  rmSync(OUT, { recursive: true, force: true });
  for (const [file, content] of files) {
    await mkdir(dirname(join(OUT, file)), { recursive: true });
    await writeFile(join(OUT, file), content);
  }
  console.log(`Wrote ${files.size} files under site/ndiedieng`);
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    console.error(err.message ?? err);
    process.exitCode = 1;
  },
);
