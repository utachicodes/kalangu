import { mkdtemp, writeFile, rm, symlink, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isEntryPoint, loadMessagesFile, main, type CliIo } from "../src/cli.js";
import { en } from "../src/index.js";

function stubIo(files: Record<string, Record<string, unknown>> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIo = {
    stdout: (t) => void out.push(t),
    stderr: (t) => void err.push(t),
    async load(path) {
      const file = files[path];
      if (!file) throw new Error("no such file");
      return file;
    },
  };
  return { io, out: () => out.join("\n"), err: () => err.join("\n") };
}

const goodWo = { "common.yes": "yes-wo", "common.no": "no-wo" };

describe("kalangu locale check", () => {
  it("passes a clean partial translation, and says it is partial", async () => {
    const t = stubIo({ "wo.json": goodWo });
    expect(await main(["locale", "check", "wo.json"], t.io)).toBe(0);
    expect(t.out()).toContain("wo: 2 of ");
    expect(t.out()).toContain("0 errors");
  });

  it("takes the language from the file name, or from --locale", async () => {
    const t = stubIo({ "x/anything.json": goodWo });
    await main(["locale", "check", "x/anything.json", "--locale", "ha"], t.io);
    expect(t.out()).toMatch(/^ha: /);
    const u = stubIo({ "x/sw.json": goodWo });
    await main(["locale", "check", "x/sw.json"], u.io);
    expect(u.out()).toMatch(/^sw: /);
    const d = stubIo({ "locales/wo.draft.json": goodWo });
    await main(["locale", "check", "locales/wo.draft.json"], d.io);
    expect(d.out()).toMatch(/^wo: /);
  });

  it("fails on an error, such as a lost placeholder", async () => {
    const t = stubIo({ "wo.json": { "common.replyYesNo": "Reply {yes}" } });
    expect(await main(["locale", "check", "wo.json"], t.io)).toBe(1);
    expect(t.out()).toContain("lost the placeholder {no}");
  });

  it("--complete turns missing keys into errors", async () => {
    const t = stubIo({ "wo.json": goodWo });
    expect(await main(["locale", "check", "wo.json", "--complete"], t.io)).toBe(1);
    expect(t.out()).toContain("missing");
  });

  it("--strict fails on warnings; without it they pass", async () => {
    const files = { "wo.json": { "common.yes": "abc ë" } }; // one letter makes the SMS UCS-2: a warning
    expect(await main(["locale", "check", "wo.json"], stubIo(files).io)).toBe(0);
    expect(await main(["locale", "check", "wo.json", "--strict"], stubIo(files).io)).toBe(1);
  });

  it("--verbose shows notes", async () => {
    const files = { "ha.json": { "common.yes": "Ɗa" } };
    const quiet = stubIo(files);
    await main(["locale", "check", "ha.json"], quiet.io);
    expect(quiet.out()).not.toContain("Ɗ → D");
    const loud = stubIo(files);
    await main(["locale", "check", "ha.json", "--verbose"], loud.io);
    expect(loud.out()).toContain("Ɗ → D");
  });

  it("is a usage error with no command, an unknown command, an unknown option, or no file", async () => {
    const none = stubIo();
    expect(await main([], none.io)).toBe(2);
    expect(none.out()).toContain("Usage:");
    expect(await main(["translate"], stubIo().io)).toBe(2);
    expect(await main(["locale", "check", "wo.json", "--nope"], stubIo({ "wo.json": goodWo }).io)).toBe(2);
    expect(await main(["locale", "check"], stubIo().io)).toBe(2);
    expect(await main(["locale", "check", "a.json", "b.json"], stubIo().io)).toBe(2);
    expect(await main(["locale", "check", "wo.json", "--locale"], stubIo().io)).toBe(2);
  });

  it("--help prints the usage and succeeds", async () => {
    const t = stubIo();
    expect(await main(["--help"], t.io)).toBe(0);
    expect(t.out()).toContain("kalangu locale check");
  });

  it("reports a file it cannot read, without a stack trace", async () => {
    const t = stubIo();
    expect(await main(["locale", "check", "missing.json"], t.io)).toBe(2);
    expect(t.err()).toContain("Could not read missing.json: no such file");
  });
});

describe("loading real files", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "kalangu-locale-"));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const write = async (name: string, content: string) => {
    const path = join(dir, name);
    await writeFile(path, content);
    return path;
  };

  it("reads a .json file of messages", async () => {
    expect(await loadMessagesFile(await write("a.json", JSON.stringify(goodWo)))).toEqual(goodWo);
  });

  it("reads messages wrapped in a \"messages\" key", async () => {
    expect(await loadMessagesFile(await write("b.json", JSON.stringify({ messages: goodWo })))).toEqual(goodWo);
  });

  it("reads a module's default export, or its named messages export", async () => {
    expect(await loadMessagesFile(await write("c.mjs", `export default ${JSON.stringify(goodWo)};`))).toEqual(goodWo);
    expect(await loadMessagesFile(await write("d.mjs", `export const messages = ${JSON.stringify(goodWo)};`))).toEqual(goodWo);
  });

  it("refuses a file that is not an object of messages", async () => {
    await expect(loadMessagesFile(await write("e.json", "[1,2]"))).rejects.toThrow(/object of messages/);
    await expect(loadMessagesFile(await write("f.json", "\"text\""))).rejects.toThrow(/object of messages/);
  });

  it("refuses invalid JSON and a missing file", async () => {
    await expect(loadMessagesFile(await write("g.json", "{ nope"))).rejects.toThrow();
    await expect(loadMessagesFile(join(dir, "does-not-exist.json"))).rejects.toThrow();
  });

  it("checks a real file end to end", async () => {
    const path = await write("wo.json", JSON.stringify({ "common.yes": "yes-wo", "common.replyYesNo": "Reply {yes}" }));
    const out: string[] = [];
    const code = await main(["locale", "check", path], { stdout: (t) => void out.push(t), stderr: () => {}, load: loadMessagesFile });
    expect(code).toBe(1);
    expect(out.join("\n")).toContain("lost the placeholder {no}");
  });

  it("the English messages pass the checker against themselves", async () => {
    const path = await write("en.json", JSON.stringify(en));
    const out: string[] = [];
    const code = await main(["locale", "check", path, "--complete", "--strict"], { stdout: (t) => void out.push(t), stderr: () => {}, load: loadMessagesFile });
    expect(code).toBe(0);
  });
});

describe("isEntryPoint: running as an installed command", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "kalangu-entry-"));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("is true for the file itself", async () => {
    const file = join(dir, "cli.js");
    await writeFile(file, "");
    expect(isEntryPoint(file, pathToFileURL(file).href)).toBe(true);
  });

  it("is true through a symlink, which is how npm installs a package's command", async () => {
    const file = join(dir, "real-cli.js");
    await writeFile(file, "");
    await mkdir(join(dir, ".bin"), { recursive: true });
    const link = join(dir, ".bin", "kalangu");
    await symlink(file, link);
    expect(isEntryPoint(link, pathToFileURL(file).href)).toBe(true);
  });

  it("is false for another file, a missing file, or nothing", async () => {
    const file = join(dir, "a.js");
    const other = join(dir, "b.js");
    await writeFile(file, "");
    await writeFile(other, "");
    expect(isEntryPoint(other, pathToFileURL(file).href)).toBe(false);
    expect(isEntryPoint(join(dir, "missing.js"), pathToFileURL(file).href)).toBe(false);
    expect(isEntryPoint(undefined, pathToFileURL(file).href)).toBe(false);
  });
});
