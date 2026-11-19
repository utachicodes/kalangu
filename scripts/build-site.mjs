#!/usr/bin/env node
/**
 * Builds the documentation pages of the website (kalangu.utachi.website) from
 * the repository's markdown, so the docs have one source and cannot drift.
 *
 *   pnpm site:build    writes site/docs/** and site/contributing/
 *   pnpm site:check    fails if the committed pages are out of date, or if a
 *                      page links to a page or heading that does not exist
 *
 * The site is served as static files from site/ with no build step on the
 * host, so the generated pages are committed.
 */

import { existsSync, realpathSync, statSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, normalize, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Marked } from "marked";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SITE = join(ROOT, "site");
const REPO = "https://github.com/utachicodes/kalangu";
export const SITE_URL = "https://kalangu.utachi.website";

/** The brand's dot, as the browser tab icon. */
export const FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="11" fill="#0D0D0C"/></svg>
`;

export const ROBOTS = `User-agent: *
Allow: /

Sitemap: ${SITE_URL}/sitemap.xml
`;

/** Served by the host for any path that does not exist. Same header as the docs pages. */
export function notFoundHtml() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Page not found · Kalangu</title>
<meta name="robots" content="noindex">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preload" href="/assets/inter-tight-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/docs/docs.css">
</head>
<body>
<header class="top">
  <a class="brand" href="/"><i></i>kalangu</a>
  <nav class="top-r" aria-label="Site">
    <a href="/docs/agents/">Agents</a>
    <a href="/docs/providers/">Providers</a>
    <a href="/contributing/">Contributing</a>
    <a href="${REPO}">GitHub</a>
  </nav>
</header>
<main id="content" class="notfound">
  <article class="doc">
    <p class="code-404">404</p>
    <h1>This page does not exist</h1>
    <p>The address may be mistyped, or the page may have moved. These are a good place to start:</p>
    <ul>
      <li><a href="/docs/">Documentation</a>: everything, from the quick start to the design</li>
      <li><a href="/docs/quick-start/">Quick start</a>: an agent on a simulated phone in a few minutes</li>
      <li><a href="/docs/roadmap/">Roadmap</a>: what is built and what is next</li>
      <li><a href="/">Home</a></li>
    </ul>
    <p>If a link on this site brought you here, please <a href="${REPO}/issues/new?template=bug.yml">report it</a>.</p>
  </article>
</main>
</body>
</html>
`;
}

/** Every page of the site, the landing page first. */
export function sitemap(pages) {
  const urls = ["/", ...pages.map((p) => p.url)];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${SITE_URL}${u}</loc></url>`).join("\n")}
</urlset>
`;
}

/** Every page, in sidebar order. `src` is relative to the repository root. */
export const PAGES = [
  { group: "Start here", label: "Overview", src: "docs/index.md", url: "/docs/" },
  { group: "Start here", label: "Quick start", src: "docs/quick-start.md", url: "/docs/quick-start/" },
  { group: "Start here", label: "Agents", src: "docs/agents.md", url: "/docs/agents/" },
  { group: "Start here", label: "Providers", src: "docs/providers.md", url: "/docs/providers/" },
  { group: "Guides", label: "Africa's Talking sandbox", src: "docs/sandbox-guide.md", url: "/docs/guides/sandbox/" },
  { group: "Guides", label: "Translating", src: "docs/translating.md", url: "/docs/guides/translating/" },
  { group: "Guides", label: "Measuring a detector", src: "docs/measuring-a-detector.md", url: "/docs/guides/detector/" },
  { group: "Guides", label: "Releasing", src: "RELEASING.md", url: "/docs/guides/releasing/" },
  { group: "Design", label: "Core design", src: "docs/design.md", url: "/docs/design/" },
  { group: "Design", label: "Payments", src: "docs/payments-design.md", url: "/docs/design/payments/" },
  { group: "Design", label: "Languages", src: "docs/languages-design.md", url: "/docs/design/languages/" },
  { group: "Design", label: "WhatsApp", src: "docs/whatsapp-design.md", url: "/docs/design/whatsapp/" },
  { group: "Design", label: "Text normalization", src: "docs/normalization-design.md", url: "/docs/design/normalization/" },
  { group: "Design", label: "Prior art", src: "docs/prior-art.md", url: "/docs/design/prior-art/" },
  { group: "Project", label: "Contributing", src: "CONTRIBUTING.md", url: "/contributing/" },
  { group: "Project", label: "Security", src: "SECURITY.md", url: "/security/" },
  { group: "Project", label: "Roadmap and to-do", src: "TODO.md", url: "/docs/roadmap/" },
  { group: "Project", label: "Changelog", src: "CHANGELOG.md", url: "/docs/changelog/" },
];

/** GitHub's heading anchors: lower case, punctuation dropped, spaces to hyphens. */
export function slugify(text) {
  return text
    .toLowerCase()
    .replace(/<[^>]*>/g, "")
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .trim()
    .replace(/\s/g, "-");
}

export function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

/**
 * Where a link in `fromSrc` should point on the site: another page, the file
 * on GitHub, or unchanged. `pageBySrc` maps a source path to its page.
 */
export function rewriteLink(href, fromSrc, pageBySrc, exists = (p) => existsSync(join(ROOT, p))) {
  if (/^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(href)) return href; // absolute, or same page
  const [pathPart, hash] = href.split("#", 2);
  const target = normalize(join(dirname(fromSrc), pathPart)).replace(/\\/g, "/").replace(/\/$/, "");
  const anchor = hash === undefined ? "" : `#${hash}`;
  const page = pageBySrc.get(target);
  if (page) return `${page.url}${anchor}`;
  if (target === "" || target === ".") return `${REPO}${anchor}`;
  if (exists(target)) {
    const kind = isDirectory(target) ? "tree" : "blob";
    return `${REPO}/${kind}/main/${target}${anchor}`;
  }
  return href;
}

function isDirectory(path) {
  try {
    return statSync(join(ROOT, path)).isDirectory();
  } catch {
    return false;
  }
}

/** Renders one page's markdown. Returns its HTML, title, heading ids and outgoing links. */
export function renderMarkdown(markdown, src, pageBySrc, exists) {
  const ids = new Map();
  const headings = [];
  const links = [];
  const marked = new Marked({
    gfm: true,
    renderer: {
      heading({ tokens, depth }) {
        const html = this.parser.parseInline(tokens);
        const base = slugify(html) || "section";
        const n = ids.get(base) ?? 0;
        ids.set(base, n + 1);
        const id = n === 0 ? base : `${base}-${n}`;
        headings.push({ depth, id, html });
        const permalink = depth > 1 ? `<a class="anchor" href="#${id}" aria-label="Link to this section">#</a>` : "";
        return `<h${depth} id="${id}">${html}${permalink}</h${depth}>\n`;
      },
      link({ href, title, tokens }) {
        const to = rewriteLink(href, src, pageBySrc, exists);
        links.push(to);
        const text = this.parser.parseInline(tokens);
        const external = /^https?:/.test(to) && !to.startsWith("/");
        return `<a href="${escapeHtml(to)}"${title ? ` title="${escapeHtml(title)}"` : ""}${external ? ' rel="noopener"' : ""}>${text}</a>`;
      },
    },
  });
  let html = marked.parse(markdown);
  html = html.replace(/<table>/g, '<div class="table"><table>').replace(/<\/table>/g, "</table></div>");
  const h1 = headings.find((h) => h.depth === 1);
  const title = h1 ? h1.html.replace(/<[^>]*>/g, "") : src;
  const firstParagraph = (html.match(/<p>([\s\S]*?)<\/p>/) ?? [])[1] ?? "";
  const description = firstParagraph.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim().slice(0, 160);
  return { html, title, description, headings, links, ids: new Set(headings.map((h) => h.id)) };
}

function sidebar(current) {
  const groups = [];
  for (const page of PAGES) {
    let group = groups.find((g) => g.name === page.group);
    if (!group) groups.push((group = { name: page.group, pages: [] }));
    group.pages.push(page);
  }
  return groups
    .map(
      (g) =>
        `<div class="group"><p class="group-name">${escapeHtml(g.name)}</p><ul>${g.pages
          .map(
            (p) =>
              `<li><a href="${p.url}"${p === current ? ' aria-current="page"' : ""}>${escapeHtml(p.label)}</a></li>`,
          )
          .join("")}</ul></div>`,
    )
    .join("");
}

function onThisPage(headings) {
  const h2 = headings.filter((h) => h.depth === 2);
  if (h2.length < 3) return "";
  return `<nav class="toc" aria-label="On this page"><p class="group-name">On this page</p><ul>${h2
    .map((h) => `<li><a href="#${h.id}">${h.html.replace(/<a [^>]*>.*?<\/a>/g, "").replace(/<[^>]*>/g, "")}</a></li>`)
    .join("")}</ul></nav>`;
}

/** The full HTML of one page. */
export function pageHtml(page, rendered) {
  const title = rendered.title === "Kalangu documentation" ? "Documentation" : rendered.title;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · Kalangu</title>
<meta name="description" content="${escapeHtml(rendered.description)}">
<link rel="canonical" href="${SITE_URL}${page.url}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<meta property="og:type" content="article">
<meta property="og:site_name" content="Kalangu">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(rendered.description)}">
<meta property="og:url" content="${SITE_URL}${page.url}">
<meta name="twitter:card" content="summary">
<link rel="preload" href="/assets/inter-tight-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/docs/docs.css">
</head>
<body>
<a class="skip" href="#content">Skip to content</a>
<header class="top">
  <a class="brand" href="/"><i></i>kalangu</a>
  <nav class="top-r" aria-label="Site">
    <a href="/docs/agents/"${page.url === "/docs/agents/" ? ' aria-current="true"' : ""}>Agents</a>
    <a href="/docs/providers/"${page.url === "/docs/providers/" ? ' aria-current="true"' : ""}>Providers</a>
    <a href="/contributing/"${page.url === "/contributing/" ? ' aria-current="true"' : ""}>Contributing</a>
    <a href="${REPO}">GitHub</a>
  </nav>
</header>
<div class="layout">
  <details class="side" open>
    <summary>Menu</summary>
    <nav aria-label="Documentation">${sidebar(page)}</nav>
  </details>
  <main id="content">
    <article class="doc">
${rendered.html}
    </article>
    <footer class="foot">
      <a href="${REPO}/blob/main/${page.src}">Edit this page on GitHub</a>
      <span>Generated from <code>${escapeHtml(page.src)}</code></span>
    </footer>
  </main>
  ${onThisPage(rendered.headings)}
</div>
<script>
// On a phone the menu starts closed, so the page's content comes first. Without
// JavaScript it simply stays open.
if (matchMedia("(max-width: 760px)").matches) document.querySelector(".side").open = false;
</script>
</body>
</html>
`;
}

export const CSS = `@font-face {
  font-family: 'Inter Tight';
  font-style: normal;
  font-weight: 400 600;
  font-display: swap;
  src: url(/assets/inter-tight-latin.woff2) format('woff2');
}
:root {
  --ink: #0D0D0C;
  --ink-70: rgba(13, 13, 12, .70);
  --ink-56: rgba(13, 13, 12, .56);
  --cream: #FBF6EF;
  --paper: #FFFDF9;
  --hair: rgba(13, 13, 12, .12);
  --code: #F3ECE1;
  --accent: #B5501B;
}
* { box-sizing: border-box; }
html { scroll-padding-top: 80px; }
body {
  margin: 0;
  font-family: 'Inter Tight', system-ui, -apple-system, 'Segoe UI', sans-serif;
  color: var(--ink);
  background: var(--cream);
  -webkit-font-smoothing: antialiased;
  line-height: 1.6;
}
a { color: inherit; }
.skip { position: absolute; left: -9999px; }
.skip:focus { left: 16px; top: 12px; background: var(--ink); color: var(--cream); padding: 8px 12px; border-radius: 6px; z-index: 10; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

.top {
  position: sticky; top: 0; z-index: 5;
  height: 64px; display: flex; align-items: center; justify-content: space-between;
  padding: 0 32px; background: var(--cream); border-bottom: 1px solid var(--hair);
}
.brand { display: flex; align-items: center; gap: 8px; font-weight: 600; font-size: 21px; letter-spacing: -.02em; text-decoration: none; }
.brand i { width: 11px; height: 11px; border-radius: 50%; background: var(--ink); display: block; }
.top-r { display: flex; gap: 28px; font-weight: 500; font-size: 15px; }
.top-r a { text-decoration: none; }
.top-r a:hover, .top-r a[aria-current] { text-decoration: underline; text-underline-offset: 4px; }

.layout {
  display: grid; grid-template-columns: 240px minmax(0, 1fr) 220px; gap: 48px;
  max-width: 1320px; margin: 0 auto; padding: 32px 32px 64px;
}
.side { position: sticky; top: 96px; align-self: start; max-height: calc(100vh - 120px); overflow: auto; }
.side summary { display: none; }
.group { margin-bottom: 22px; }
.group-name { margin: 0 0 6px; font-size: 12px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--ink-56); }
.side ul, .toc ul { list-style: none; margin: 0; padding: 0; }
.side li a, .toc li a { display: block; padding: 4px 0; text-decoration: none; color: var(--ink-70); font-size: 15px; }
.side li a:hover, .toc li a:hover { color: var(--ink); }
.side li a[aria-current] { color: var(--ink); font-weight: 600; }
.toc { position: sticky; top: 96px; align-self: start; font-size: 14px; }
.toc li a { font-size: 14px; }

.doc { max-width: 760px; }
.doc h1 { font-size: 44px; line-height: 1.1; letter-spacing: -.03em; font-weight: 600; margin: 8px 0 24px; }
.doc h2 { font-size: 27px; line-height: 1.2; letter-spacing: -.02em; font-weight: 600; margin: 48px 0 14px; padding-top: 8px; border-top: 1px solid var(--hair); }
.doc h3 { font-size: 20px; line-height: 1.3; font-weight: 600; margin: 32px 0 10px; }
.doc h4 { font-size: 17px; font-weight: 600; margin: 24px 0 8px; }
.doc .anchor { margin-left: 8px; color: var(--ink-56); text-decoration: none; opacity: 0; font-weight: 400; }
.doc :is(h2, h3, h4):hover .anchor, .doc .anchor:focus { opacity: 1; }
.doc p, .doc li { font-size: 17px; }
.doc a { color: var(--accent); text-underline-offset: 3px; }
.doc ul, .doc ol { padding-left: 24px; }
.doc li + li { margin-top: 4px; }
.doc blockquote { margin: 20px 0; padding: 4px 18px; border-left: 3px solid var(--accent); color: var(--ink-70); }
.doc hr { border: 0; border-top: 1px solid var(--hair); margin: 40px 0; }
.doc code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: .88em; background: var(--code); padding: 2px 5px; border-radius: 4px; }
.doc pre { background: var(--paper); border: 1px solid var(--hair); border-radius: 8px; padding: 16px 18px; overflow-x: auto; line-height: 1.5; }
.doc pre code { background: none; padding: 0; font-size: 14px; }
.table { overflow-x: auto; margin: 20px 0; border: 1px solid var(--hair); border-radius: 8px; background: var(--paper); }
.doc table { border-collapse: collapse; width: 100%; font-size: 15px; }
.doc th, .doc td { text-align: left; padding: 9px 12px; border-bottom: 1px solid var(--hair); vertical-align: top; }
.doc tr:last-child td { border-bottom: 0; }
.doc th { font-weight: 600; background: rgba(13,13,12,.03); }
.doc input[type=checkbox] { margin-right: 6px; }

.foot { max-width: 760px; margin-top: 56px; padding-top: 16px; border-top: 1px solid var(--hair); display: flex; flex-wrap: wrap; gap: 8px 24px; justify-content: space-between; font-size: 14px; color: var(--ink-56); }
.foot a { color: var(--ink-70); }

@media (max-width: 1100px) {
  .layout { grid-template-columns: 220px minmax(0, 1fr); }
  .toc { display: none; }
}
@media (max-width: 760px) {
  .top { padding: 0 16px; gap: 16px; }
  .brand { flex-shrink: 0; }
  .top-r { gap: 14px; font-size: 14px; }
  .layout { display: block; padding: 16px 16px 48px; }
  .side { position: static; max-height: none; margin-bottom: 16px; border: 1px solid var(--hair); border-radius: 8px; background: var(--paper); }
  .side summary { display: block; padding: 12px 14px; font-weight: 600; cursor: pointer; }
  .side nav { padding: 0 14px 6px; }
  .side:not([open]) nav { display: none; }
  .doc h1 { font-size: 34px; }
  .doc h2 { font-size: 23px; }
  .doc p, .doc li { font-size: 16px; }
}

/* 404 */
.notfound { max-width: 760px; margin: 0 auto; padding: 72px 32px 96px; }
.notfound .code-404 { font-size: 15px; font-weight: 600; letter-spacing: .08em; color: var(--accent); margin: 0; }
@media (max-width: 760px) { .notfound { padding: 40px 16px 64px; } }

/* Narrow phones: four links do not fit beside the logo. GitHub is also in every page's footer. */
@media (max-width: 440px) {
  .top-r a[href^="https://github.com"] { display: none; }
}
/* The smallest phones: Contributing is also in every page's sidebar, under Project. */
@media (max-width: 360px) {
  .top-r a[href="/contributing/"] { display: none; }
}
`;

/** Builds every page in memory. Returns the files and any broken internal links. */
export async function build() {
  const pageBySrc = new Map(PAGES.map((p) => [p.src, p]));
  const rendered = new Map();
  for (const page of PAGES) {
    const markdown = await readFile(join(ROOT, page.src), "utf8");
    rendered.set(page, renderMarkdown(markdown, page.src, pageBySrc));
  }
  const problems = checkLinks(rendered);
  const files = new Map([[join(SITE, "docs", "docs.css"), CSS]]);
  for (const [page, r] of rendered) files.set(join(SITE, page.url, "index.html"), pageHtml(page, r));
  files.set(join(SITE, "sitemap.xml"), sitemap(PAGES));
  files.set(join(SITE, "robots.txt"), ROBOTS);
  files.set(join(SITE, "favicon.svg"), FAVICON);
  files.set(join(SITE, "404.html"), notFoundHtml());
  return { files, problems };
}

/**
 * Every internal link must reach a page, and its #anchor a heading on that
 * page; a link to a .md file that did not become a page is reported too.
 */
export function checkLinks(rendered) {
  const pageByUrl = new Map([...rendered.keys()].map((p) => [p.url, p]));
  const problems = [];
  for (const [page, r] of rendered) {
    for (const link of r.links) {
      if (!link.startsWith("/")) {
        if (/\.md(#|$)/.test(link) && !/^https?:/.test(link)) problems.push(`${page.src}: link to ${link} does not resolve`);
        continue;
      }
      const [path, anchor] = link.split("#", 2);
      const target = pageByUrl.get(path);
      if (!target) problems.push(`${page.src}: link to ${link}, which is not a page`);
      else if (anchor && !rendered.get(target).ids.has(anchor)) problems.push(`${page.src}: link to ${link}, but ${target.src} has no heading "${anchor}"`);
    }
  }
  return problems;
}

async function main(argv) {
  const check = argv.includes("--check");
  const { files, problems } = await build();
  let stale = [];
  if (check) {
    for (const [path, content] of files) {
      const current = existsSync(path) ? await readFile(path, "utf8") : null;
      if (current !== content) stale.push(relative(ROOT, path));
    }
  } else {
    for (const [path, content] of files) {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content);
    }
    console.log(`Wrote ${files.size} files under site/`);
  }
  for (const p of problems) console.error(`broken link: ${p}`);
  for (const s of stale) console.error(`out of date: ${s} (run pnpm site:build)`);
  if (check && stale.length === 0 && problems.length === 0) console.log(`Site docs are up to date (${files.size} files).`);
  return problems.length > 0 || stale.length > 0 ? 1 : 0;
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
      process.stderr.write(`build-site: ${err?.stack ?? String(err)}\n`);
      process.exitCode = 2;
    },
  );
}
