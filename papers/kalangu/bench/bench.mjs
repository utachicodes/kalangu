// Measurements for the Kalangu paper, run on the built packages:
//   pnpm build && node papers/kalangu/bench/bench.mjs > papers/kalangu/bench/results.json
// A: fixed-menu USSD latency through the full Ndiédieng agent (SQLite on disk)
// B: deferral of a slow model past the USSD deadline, and an in-time answer
// C: SMS encoding of every message in the built-in and draft locales
// D: every USSD screen reachable in the Ndiédieng menu tree, against 160 chars
import { readFileSync } from "node:fs";
import os from "node:os";
import { performance } from "node:perf_hooks";
import { ask, createAgent, en, fr, menu, say, silentLogger, smsLength } from "../../../packages/core/dist/index.js";
import { createPhone } from "../../../packages/sim/dist/phone.js";
import { createNdiediengAgent } from "../../../examples/ndiedieng/dist/agent.js";
import { keywordClassifier } from "../../../examples/ndiedieng/dist/classify.js";
import { chefPhone } from "../../../examples/ndiedieng/dist/data.js";
import { openCommune } from "../../../examples/ndiedieng/dist/nodeSql.js";

const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const stats = (xs) => ({ n: xs.length, p50: +q(xs, 0.5).toFixed(3), p95: +q(xs, 0.95).toFixed(3), p99: +q(xs, 0.99).toFixed(3), max: +Math.max(...xs).toFixed(3) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- A: fixed-menu latency ----------
const commune = openCommune({ history: true });
const agent = createNdiediengAgent({ commune, classifier: keywordClassifier(), channels: [], logger: silentLogger });
const SESSIONS = 500;
const perRequest = [], perSession = [];
for (let i = 0; i < SESSIONS; i++) {
  const phone = createPhone(agent, { phone: chefPhone((i % 58) + 1), code: "*123#" });
  const t0 = performance.now();
  let t = performance.now(); await phone.dial("*123#"); perRequest.push(performance.now() - t);
  for (const k of ["1", "1", "1", "1"]) { t = performance.now(); await phone.press(k); perRequest.push(performance.now() - t); }
  perSession.push(performance.now() - t0);
}
const A = { sessions: SESSIONS, requestsPerSession: 5, perRequestMs: stats(perRequest), perSessionMs: stats(perSession), reportsCreated: commune.counts() };

// ---------- B: deferral ----------
const slowAgent = (delayMs) => createAgent({
  channels: [], logger: silentLogger,
  model: { answer: async (qq) => { await sleep(delayMs); return `Answer to "${qq}".`; } },
  start: menu("Clinic line", { "Ask a nurse": ask("Type your question", (qq, ctx) => ctx.model.answer(qq)) }),
});
async function deferralRun(delayMs) {
  const phone = createPhone(slowAgent(delayMs), { phone: "+221770000099", code: "*384*1#" });
  await phone.dial("*384*1#"); await phone.press("1");
  const t0 = performance.now();
  const screen = await phone.press("When is the clinic open?");
  const toScreen = performance.now() - t0;
  let toSms = null;
  while (performance.now() - t0 < delayMs + 3000) {
    if (phone.inbox.length) { toSms = performance.now() - t0; break; }
    await sleep(10);
  }
  return { toScreenMs: Math.round(toScreen), screenEnded: screen.end, screenText: screen.text, toSmsMs: toSms && Math.round(toSms), sms: phone.inbox[0]?.text ?? null };
}
const B = { deadlineMs: 4000, slow6000: [], fast1500: [] };
for (let i = 0; i < 3; i++) B.slow6000.push(await deferralRun(6000));
for (let i = 0; i < 3; i++) B.fast1500.push(await deferralRun(1500));

// ---------- C: SMS encoding per locale ----------
function strings(obj, out = []) { for (const v of Object.values(obj)) typeof v === "string" ? out.push(v) : v && typeof v === "object" && strings(v, out); return out; }
function encodingReport(name, msgs) {
  const lens = msgs.map((m) => smsLength(m.replace(/\{[^}]+\}/g, "x")));
  const ucs2 = lens.filter((l) => l.encoding === "ucs2");
  const culprits = {};
  for (const l of ucs2) for (const ch of l.nonGsmChars) culprits[ch] = (culprits[ch] ?? 0) + 1;
  return { locale: name, messages: msgs.length, ucs2: ucs2.length, ucs2Share: +(ucs2.length / msgs.length).toFixed(3),
    multiSegment: lens.filter((l) => l.segments > 1).length, culprits: Object.entries(culprits).sort((a, b) => b[1] - a[1]).slice(0, 6) };
}
const C = [encodingReport("en (built in)", strings(en)), encodingReport("fr (built in)", strings(fr))];
for (const code of ["wo", "ha", "sw"]) {
  const j = JSON.parse(readFileSync(new URL(`../../../locales/${code}.draft.json`, import.meta.url)));
  C.push(encodingReport(`${code} (draft)`, strings(j.messages)));
}

// ---------- D: every USSD screen in the Ndiédieng menu tree ----------
const fresh = openCommune({ history: false });
const screens = []; let visited = 0;
async function walk(path) {
  // A fresh agent per path: Kalangu resumes a dropped session on redial, by design.
  const treeAgent = createNdiediengAgent({ commune: fresh, classifier: keywordClassifier(), channels: [], logger: silentLogger });
  const phone = createPhone(treeAgent, { phone: chefPhone(7), code: "*123#" });
  let s = await phone.dial("*123#");
  for (const k of path) { if (s.end) break; s = await phone.press(k); }
  visited++;
  screens.push({ path: path.join(">") || "(root)", chars: s.text.length, end: s.end });
  phone.hangUp();
  if (s.end || path.length >= 4) return;
  const options = [...s.text.matchAll(/^(\d+)\./gm)].map((m) => m[1]).filter((o) => o !== "98" && o !== "0");
  for (const o of options) await walk([...path, o]);
}
await walk([]);
const D = { screens: visited, over160: screens.filter((s) => s.chars > 160).length, maxChars: Math.max(...screens.map((s) => s.chars)),
  meanChars: +(screens.reduce((a, s) => a + s.chars, 0) / screens.length).toFixed(1) };

console.log(JSON.stringify({
  machine: { cpu: os.cpus()[0]?.model, cores: os.cpus().length, memGB: Math.round(os.totalmem() / 2 ** 30), node: process.version, platform: `${os.platform()} ${os.release()}` },
  date: new Date().toISOString(), A, B, C, D,
}, null, 2));
commune.close(); fresh.close();
