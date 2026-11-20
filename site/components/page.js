// Renders the catalog: one card per component, each demo in its own shadow
// root built from the very code shown beneath it. Plus Marble, the mascot.

import { COMPONENTS } from "./catalog.js";

const $ = (id) => document.getElementById(id);
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? "" : v);
  }
  node.append(...children.flat().filter((c) => c != null && c !== false));
  return node;
}

/** A function's source, without the indentation it had inside the catalog. */
function source(fn) {
  const [first, ...rest] = fn.toString().split("\n");
  const indent = Math.min(...rest.filter((l) => l.trim()).map((l) => l.match(/^ */)[0].length));
  return [first, ...rest.map((l) => l.slice(indent))].join("\n");
}

const BASE = `:host { font-family: "Inter Tight", system-ui, sans-serif; color: #15201a; }
*, *::before, *::after { box-sizing: border-box; }
button:focus-visible, a:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid #b5501b; outline-offset: 2px; }`;

function card(c, i) {
  const demo = el("div", { class: "demo", role: "region", "aria-label": `${c.name}: live demo` });
  const shadow = demo.attachShadow({ mode: "open" });
  // Constant markup from catalog.js, written by us, never from a visitor.
  shadow.innerHTML = `<style>${BASE}\n${c.css}</style>${c.html}`;
  try {
    c.js?.(shadow);
  } catch (err) {
    console.error(`[components] ${c.id}:`, err);
  }

  const files = [["HTML", c.html], ["CSS", c.css], ["JS", c.js ? source(c.js) : "// No JavaScript needed: this one is pure CSS."]];
  const pre = el("pre", { tabindex: "0", id: `code-${c.id}`, role: "tabpanel" }, el("code", { text: files[0][1] }));
  let current = 0;
  const tabs = files.map(([label], t) =>
    el("button", {
      type: "button", role: "tab", id: `tab-${c.id}-${t}`, "aria-controls": `code-${c.id}`, "aria-selected": String(t === 0), tabindex: t === 0 ? "0" : "-1",
      onclick: () => select(t),
    }, label));
  const select = (t) => {
    current = t;
    tabs.forEach((b, j) => { b.setAttribute("aria-selected", String(j === t)); b.tabIndex = j === t ? 0 : -1; });
    pre.setAttribute("aria-labelledby", tabs[t].id);
    pre.firstChild.textContent = files[t][1];
  };
  const tablist = el("div", {
    role: "tablist", "aria-label": `${c.name} code`, style: "display:contents",
    onkeydown: (e) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      select((current + (e.key === "ArrowRight" ? 1 : files.length - 1)) % files.length);
      tabs[current].focus();
    },
  }, tabs);
  const copy = el("button", {
    type: "button", class: "copy",
    onclick: async () => {
      try {
        await navigator.clipboard.writeText(files[current][1]);
        copy.textContent = "Copied!";
        copy.classList.add("done");
      } catch {
        copy.textContent = "Select and copy";
      }
      setTimeout(() => { copy.textContent = "Copy"; copy.classList.remove("done"); }, 1600);
    },
  }, "Copy");
  select(0);

  return el("article", { class: "card reveal", id: c.id, "aria-labelledby": `h-${c.id}` },
    el("div", { class: "info" },
      el("span", { class: "num", text: String(i + 1).padStart(2, "0") }),
      el("h2", { id: `h-${c.id}`, text: c.nickname }),
      el("p", { class: "real", text: c.name }),
      el("p", { class: "why", text: c.why }),
      el("div", { class: "tags" }, c.tags.map((t) => el("span", { text: t }))),
      el("p", { class: "used" }, "Used in: ", el("a", { href: c.usedIn.href, text: c.usedIn.label }))),
    el("div", { class: "side-r" },
      demo,
      el("div", { class: "code" }, el("div", { class: "code-bar" }, tablist, copy), pre)));
}

$("chips").replaceChildren(...COMPONENTS.map((c) => el("a", { href: `#${c.id}`, text: c.nickname })));
$("cards").replaceChildren(...COMPONENTS.map(card));

// Cards slide in as they come into view.
const reveal = new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting) { e.target.classList.add("in"); reveal.unobserve(e.target); }
}, { rootMargin: "0px 0px -8% 0px" });
document.querySelectorAll(".card.reveal").forEach((c) => reveal.observe(c));

// ---------- Marble, the mascot ----------
const marble = $("marble");
const bubble = $("bubble");
const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
const LINES = [
  "I used to be a pie chart. We don't talk about it.",
  "I'm made of four blobs and a dream.",
  "Talk to my big sibling on /ndiedieng/assistant.",
  "Zero frameworks were harmed in the making of me.",
  "I work offline. Mostly by not working at all.",
  "Ndiédieng, 58 villages, one very round assistant.",
  "Stop poking. Actually, keep going.",
  "My eyes are 30 pixels each. I've counted.",
  "If I spin, I'm thinking. If I wobble, I'm flattered.",
];
let said = -1;
let pokes = 0;

// The pupils follow the pointer, within the whites of the eyes.
const pupils = marble.querySelectorAll(".eye b");
addEventListener("pointermove", (e) => {
  if (calm) return;
  for (const p of pupils) {
    const r = p.parentElement.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    const d = Math.hypot(dx, dy) || 1;
    const k = Math.min(1, d / 220);
    p.style.translate = `${(dx / d) * 7 * k}px ${(dy / d) * 8 * k}px`;
  }
}, { passive: true });

// A blink now and then.
const blink = () => {
  marble.classList.add("blink");
  setTimeout(() => marble.classList.remove("blink"), 200);
  setTimeout(blink, 2500 + Math.random() * 3500);
};
if (!calm) setTimeout(blink, 2000);

// A poke: a squish, a line, and a little wiggle of colour as it "talks".
marble.addEventListener("click", () => {
  pokes++;
  said = (said + 1 + Math.floor(Math.random() * (LINES.length - 1))) % LINES.length;
  bubble.textContent = pokes === 7 ? "Okay, okay, I'm dizzy." : LINES[said];
  bubble.classList.remove("pop");
  void bubble.offsetWidth;
  bubble.classList.add("pop");
  if (calm) return;
  marble.classList.remove("boop", "dizzy");
  void marble.offsetWidth;
  marble.classList.add(pokes === 7 ? "dizzy" : "boop");
  const t0 = performance.now();
  const talk = (t) => {
    const p = (t - t0) / 1200;
    marble.style.setProperty("--level", p < 1 ? (Math.abs(Math.sin(t / 90)) * (1 - p)).toFixed(3) : "0");
    if (p < 1) requestAnimationFrame(talk);
  };
  requestAnimationFrame(talk);
  if (pokes === 7) pokes = 0;
});
