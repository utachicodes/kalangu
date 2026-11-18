// Run with: node --test "scripts/**/*.test.mjs"
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PAGES, build, checkLinks, renderMarkdown, rewriteLink, slugify } from "./build-site.mjs";

const pageBySrc = new Map(PAGES.map((p) => [p.src, p]));
const exists = (p) => ["examples/clinic/src/server.ts", "packages"].includes(p);

describe("slugify", () => {
  it("makes GitHub's anchors, so existing deep links keep working", () => {
    assert.equal(slugify("12. Open questions"), "12-open-questions");
    assert.equal(slugify("6.5 Polling and reconciliation"), "65-polling-and-reconciliation");
    assert.equal(slugify("The <code>pay</code> step"), "the-pay-step");
    assert.equal(slugify("Français, Wolof"), "français-wolof");
  });
});

describe("rewriteLink", () => {
  it("turns links between docs into site pages, keeping anchors", () => {
    assert.equal(rewriteLink("docs/design.md", "CONTRIBUTING.md", pageBySrc, exists), "/docs/design/");
    assert.equal(rewriteLink("../TODO.md#v01", "docs/index.md", pageBySrc, exists), "/docs/roadmap/#v01");
    assert.equal(rewriteLink("sandbox-guide.md", "docs/quick-start.md", pageBySrc, exists), "/docs/guides/sandbox/");
  });

  it("sends links to source files and folders to GitHub", () => {
    assert.equal(
      rewriteLink("../examples/clinic/src/server.ts", "docs/quick-start.md", pageBySrc, exists),
      "https://github.com/utachicodes/kalangu/blob/main/examples/clinic/src/server.ts",
    );
  });

  it("leaves absolute links, same-page anchors and unknown paths alone", () => {
    assert.equal(rewriteLink("https://example.com/x", "docs/index.md", pageBySrc, exists), "https://example.com/x");
    assert.equal(rewriteLink("#steps", "docs/agents.md", pageBySrc, exists), "#steps");
    assert.equal(rewriteLink("nope.md", "docs/agents.md", pageBySrc, exists), "nope.md");
  });
});

describe("renderMarkdown", () => {
  it("gives repeated headings distinct ids and wraps tables for small screens", () => {
    const r = renderMarkdown("# T\n\n## A\n\n## A\n\n| a | b |\n|---|---|\n| 1 | 2 |\n", "docs/agents.md", pageBySrc, exists);
    assert.ok(r.ids.has("a") && r.ids.has("a-1"));
    assert.match(r.html, /<div class="table"><table>/);
    assert.equal(r.title, "T");
  });
});

describe("checkLinks", () => {
  it("reports a link to a heading that does not exist", () => {
    const a = { src: "docs/a.md", url: "/docs/a/" };
    const b = { src: "docs/b.md", url: "/docs/b/" };
    const rendered = new Map([
      [a, { links: ["/docs/b/#real", "/docs/b/#missing", "/docs/nowhere/"], ids: new Set() }],
      [b, { links: [], ids: new Set(["real"]) }],
    ]);
    const problems = checkLinks(rendered);
    assert.equal(problems.length, 2);
    assert.match(problems.join("\n"), /no heading "missing"/);
    assert.match(problems.join("\n"), /\/docs\/nowhere\/, which is not a page/);
  });
});

describe("the real site", () => {
  it("builds every page with no broken internal link", async () => {
    const { files, problems } = await build();
    assert.deepEqual(problems, []);
    assert.equal(files.size, PAGES.length + 1); // the pages and the stylesheet
  });
});
