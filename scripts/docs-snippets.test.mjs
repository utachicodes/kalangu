// Run with: node --test "scripts/**/*.test.mjs"   (needs `pnpm build` first)
//
// The quick start promises that its files, copied as they are, print exactly
// the output it shows. This runs them: every block introduced by
// "Create `<file>`" is written out, the block after "Run it with `node <file>`"
// is the expected output, and the two are compared. A change to the API or to
// the docs that breaks the promise fails here.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";

const ROOT = resolve(".");

/** The fenced blocks of a markdown file, each with the prose line just before it. */
export function blocks(markdown) {
  const out = [];
  const lines = markdown.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const open = /^```(\w*)\s*$/.exec(lines[i]);
    if (!open) continue;
    let end = i + 1;
    while (end < lines.length && !/^```\s*$/.test(lines[end])) end++;
    let before = i - 1;
    while (before >= 0 && lines[before].trim() === "") before--;
    out.push({ lang: open[1], intro: before >= 0 ? lines[before] : "", code: lines.slice(i + 1, end).join("\n") });
    i = end;
  }
  return out;
}

/** The files a page asks to create, and the runs it shows with their output. */
export function walkthrough(markdown) {
  const files = {};
  const runs = [];
  for (const b of blocks(markdown)) {
    const create = /^Create `([^`]+)`/.exec(b.intro);
    if (create) files[create[1]] = `${b.code}\n`;
    const run = /^Run it with `node ([^`]+)`/.exec(b.intro);
    if (run) runs.push({ file: run[1], expected: b.code });
  }
  return { files, runs };
}

describe("blocks", () => {
  it("pairs each block with the line before it", () => {
    const md = "Intro\n\nCreate `a.mjs`:\n\n```js\nconsole.log(1)\n```\n\nRun it with `node a.mjs`:\n\n```text\n1\n```\n";
    assert.deepEqual(walkthrough(md), { files: { "a.mjs": "console.log(1)\n" }, runs: [{ file: "a.mjs", expected: "1" }] });
  });
});

describe("docs/quick-start.md", () => {
  it("prints exactly the output it shows", () => {
    const { files, runs } = walkthrough(readFileSync("docs/quick-start.md", "utf8"));
    assert.ok(Object.keys(files).length >= 2, "expected the agent and the script to create");
    assert.ok(runs.length >= 1, "expected a run with its output");

    const dir = mkdtempSync(join(tmpdir(), "kalangu-quickstart-"));
    try {
      // The page installs @kalangu/core and @kalangu/sim from npm; here they are this repository's builds.
      mkdirSync(join(dir, "node_modules", "@kalangu"), { recursive: true });
      for (const pkg of ["core", "sim"]) symlinkSync(join(ROOT, "packages", pkg), join(dir, "node_modules", "@kalangu", pkg), "dir");
      writeFileSync(join(dir, "package.json"), JSON.stringify({ type: "module" }));
      for (const [name, code] of Object.entries(files)) writeFileSync(join(dir, name), code);

      for (const run of runs) {
        const out = execFileSync(process.execPath, [run.file], { cwd: dir, encoding: "utf8" });
        assert.equal(out.trimEnd(), run.expected.trimEnd(), `node ${run.file} printed something other than the page shows`);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
