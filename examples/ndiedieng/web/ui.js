// The Ndiédieng dashboard: a chief's phone on one side, the Mairie's reports
// on the other. Every value from the API reaches the page through
// textContent, never as HTML (see common.js). The assistant has its own page.

import {
  $, h, icon, toast, announce, ago, fullDate, connect, call, resetDemo,
  MODE, CODE, LABEL, STATUT, URGENCE, CANAL, canListen, listenUnavailable, listen,
} from "./common.js";

const time = () => new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

// ---------- State ----------
const state = {
  chefs: [],
  chef: null,
  device: "android",
  phone: { view: "dialer", dialing: "", running: false, screen: null, inSession: false, inbox: [], sent: {}, smsDraft: "", ussdDraft: "" },
  simple: { view: "home", compose: "" },
  reports: [],
  counts: { nouveau: 0, a_verifier: 0, en_cours: 0, resolu: 0, haute: 0 },
  filter: { statut: "", urgent: false, categorie: "", q: "" },
  seen: null,
};
try {
  state.device = localStorage.getItem("ndiedieng.device") || state.device;
} catch {}

async function phoneCall(action, text = "") {
  const r = await call("POST", "/api/phone", { telephone: state.chef, action, text });
  state.phone.inbox = r.inbox;
  state.phone.inSession = r.inSession;
  return r;
}
const sentFor = () => (state.phone.sent[state.chef] ??= []);

// ---------- Phone actions (shared by the three phones) ----------
async function dial(code) {
  const p = state.phone;
  if (!code) return;
  p.running = true;
  p.screen = null;
  renderPhone();
  try {
    const [r] = await Promise.all([phoneCall("dial", code), new Promise((ok) => setTimeout(ok, 650))]);
    p.screen = r.screen;
    p.dialing = "";
  } catch (err) {
    p.screen = { text: err.message, end: true };
  } finally {
    p.running = false;
    p.ussdDraft = "";
    renderPhone({ focus: "ussd" });
    refreshReports();
  }
}
async function reply(text) {
  const p = state.phone;
  if (!p.inSession) return;
  p.running = true;
  renderPhone();
  try {
    const r = await phoneCall("press", text);
    p.screen = r.screen;
  } catch (err) {
    p.screen = { text: err.message, end: true };
  } finally {
    p.running = false;
    p.ussdDraft = "";
    renderPhone({ focus: "ussd" });
    refreshReports();
  }
}
async function hangUp() {
  const p = state.phone;
  p.screen = null;
  p.running = false;
  p.ussdDraft = "";
  await phoneCall("hangup");
  renderPhone();
}
function closeEnded() {
  state.phone.screen = null;
  renderPhone();
}
async function sendSms(text, kind = "sms") {
  text = text.trim();
  if (!text) return;
  sentFor().push({ text, at: new Date().toISOString(), kind });
  state.phone.smsDraft = "";
  renderPhone({ focus: "sms" });
  try {
    await phoneCall(kind === "vocal" ? "vocal" : "sms", text);
  } catch (err) {
    toast(err.message);
  }
  renderPhone({ focus: "sms" });
  refreshReports();
}
// A voice message: the browser transcribes it while the chief speaks; it is
// sent as text, like on a real gateway where the operator transcribes it.
let recording = null; // { ctrl, startedAt, levels, cancelled, timer, text }
function startVoiceMessage() {
  if (!canListen) return toast(listenUnavailable);
  if (recording) return;
  state.phone.smsDraft = "";
  recording = { startedAt: Date.now(), levels: Array(24).fill(0), cancelled: false, text: "" };
  renderPhone();
  recording.ctrl = listen({
    onText: (t) => {
      if (!recording) return;
      recording.text = t;
      const d = document.querySelector(".draft");
      if (d) { d.textContent = t || "…"; d.closest(".chat").scrollTop = 1e6; }
    },
    onLevel: (v) => {
      if (!recording) return;
      recording.levels.push(v);
      recording.levels.shift();
      const host = document.querySelector(".device");
      host?.querySelector(".glow")?.style.setProperty("--level", v.toFixed(3));
      const bars = host?.querySelectorAll(".wave i") ?? [];
      bars.forEach((bar, i) => (bar.style.height = `${4 + recording.levels[i] * 26}px`));
    },
    onDone: (t) => {
      const r = recording;
      clearInterval(r?.timer);
      recording = null;
      if (r && !r.cancelled && t) sendSms(t, "vocal");
      else renderPhone();
    },
    onError: (m) => toast(m),
  });
  if (!recording) return;
  recording.timer = setInterval(() => {
    const el = document.querySelector(".rec .timer");
    if (el && recording) {
      const s = Math.floor((Date.now() - recording.startedAt) / 1000);
      el.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    }
  }, 250);
}
const stopVoiceMessage = () => recording?.ctrl?.stop();
function cancelVoiceMessage() {
  if (!recording) return;
  recording.cancelled = true;
  recording.ctrl?.cancel();
}

// ---------- Phone rendering ----------
function statusBar(dark = false) {
  return h("div", { class: "statusbar", style: dark ? "color:#fff" : null },
    h("span", { text: time() }),
    h("span", { class: "sys" }, icon("signal"), h("span", { text: "SN", style: "font-size:11px" }), icon("battery")));
}
function keypad(onKey) {
  const letters = { 2: "ABC", 3: "DEF", 4: "GHI", 5: "JKL", 6: "MNO", 7: "PQRS", 8: "TUV", 9: "WXYZ", 0: "+" };
  return h("div", { class: "pad", role: "group", "aria-label": "Clavier" },
    ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"].map((k) =>
      h("button", { type: "button", "aria-label": k, onclick: () => onKey(k) }, k, h("small", { text: letters[k] ?? " " }))));
}
function dialer() {
  const p = state.phone;
  const display = h("div", { class: "dial-number", "aria-live": "polite", text: p.dialing || "" });
  return h("div", { class: "app" },
    display,
    h("div", { class: "dial-hint", text: p.dialing ? "" : `Composez ${CODE} pour joindre la Mairie` }),
    keypad((k) => {
      p.dialing += k;
      display.textContent = p.dialing;
      document.querySelector(".dial-hint").textContent = "";
    }),
    h("div", { class: "call-row" },
      h("span"),
      h("button", { type: "button", class: "call", "aria-label": `Appeler ${p.dialing || CODE}`, onclick: () => dial(p.dialing || CODE) }, icon("phone")),
      h("button", {
        type: "button", class: "erase", "aria-label": "Effacer",
        onclick: () => { p.dialing = p.dialing.slice(0, -1); display.textContent = p.dialing; },
      }, p.dialing ? icon("erase") : "")));
}
function chatView() {
  const p = state.phone;
  const items = [
    ...p.inbox.map((m) => ({ dir: "in", text: m.text, at: m.at, kind: "sms" })),
    ...sentFor().map((m) => ({ dir: "out", text: m.text, at: m.at, kind: m.kind })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  const chat = h("div", { class: "chat", "aria-live": "polite", "aria-label": "Conversation avec la Mairie" },
    items.length ? null : h("p", { class: "chat-empty", text: "Écrivez à la Mairie, ou dictez un message vocal. Un SMS sans menu ouvert reçoit le menu." }),
    items.map((m, i) => [
      i === 0 || new Date(m.at) - new Date(items[i - 1].at) > 10 * 60 * 1000 ? h("span", { class: "chat-time", text: new Date(m.at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) }) : null,
      h("div", { class: `bubble ${m.dir}` },
        m.kind === "vocal" ? h("span", { class: "voice-tag" }, icon("vocal"), "Message vocal, transcrit") : null,
        m.text),
    ]));
  const input = h("input", {
    id: "sms-input", type: "text", value: p.smsDraft, placeholder: "Message", "aria-label": "Message à la Mairie", autocomplete: "off",
    oninput: (e) => (p.smsDraft = e.target.value),
    onkeydown: (e) => { if (e.key === "Enter") sendSms(e.target.value); },
  });
  const micBtn = h("button", {
    type: "button", class: "round mic", "aria-label": "Enregistrer un message vocal",
    title: canListen ? "Message vocal, transcrit par le navigateur" : listenUnavailable,
    onclick: startVoiceMessage,
  }, icon("mic"));
  if (recording) chat.append(h("div", { class: "draft", text: recording.text || "Parlez…" }));
  setTimeout(() => (chat.scrollTop = chat.scrollHeight));
  return h("div", { class: "app" },
    h("div", { class: "chat-head" }, h("span", { class: "avatar", text: "M" }), h("strong", { text: "MAIRIE" }), h("span", { text: "Ndiédieng", style: "opacity:.6" })),
    chat,
    recording
      ? [
          h("div", { class: "glow", "aria-hidden": "true" }),
          h("div", { class: "mic-note", role: "status", text: "Je vous écoute. Touchez ↑ pour envoyer." }),
          h("div", { class: "rec" },
            h("button", { type: "button", class: "round cancel", "aria-label": "Annuler le message vocal", onclick: cancelVoiceMessage }, icon("erase")),
            h("div", { class: "wave", "aria-hidden": "true" }, h("span", { class: "timer", text: "0:00" }), recording.levels.map(() => h("i"))),
            h("button", { type: "button", class: "round send", "aria-label": "Envoyer le message vocal", onclick: stopVoiceMessage }, icon("send"))),
        ]
      : h("div", { class: "compose" }, micBtn, input,
          h("button", { type: "button", class: "round send", "aria-label": "Envoyer", onclick: () => sendSms(input.value) }, icon("send"))));
}
function ussdLayer(kind) {
  const p = state.phone;
  if (p.running) {
    return h("div", { class: "scrim" },
      kind === "iphone"
        ? h("div", { class: "ios-run", role: "status" }, h("span", { class: "ring", style: "color:#8e8e93" }), "Exécution du code USSD…")
        : h("div", { class: "md-run", role: "status" }, h("span", { class: "ring", style: "color:#6750a4" }), "Exécution du code USSD…"));
  }
  if (!p.screen) return null;
  const open = !p.screen.end;
  const input = open
    ? h("input", {
        id: "ussd-input", type: "text", inputmode: "numeric", autocomplete: "off", value: p.ussdDraft, "aria-label": "Réponse",
        oninput: (e) => (p.ussdDraft = e.target.value),
        onkeydown: (e) => { if (e.key === "Enter") reply(e.target.value); if (e.key === "Escape") hangUp(); },
      })
    : null;
  const send = () => reply(input.value);
  if (kind === "iphone") {
    return h("div", { class: "scrim" },
      h("div", { class: "ios-alert", role: "alertdialog", "aria-modal": "true", "aria-label": "Message USSD" },
        h("div", { class: "body", text: p.screen.text }),
        input,
        h("div", { class: "buttons" },
          open ? [h("button", { type: "button", onclick: hangUp, text: "Annuler" }), h("button", { type: "button", onclick: send, text: "Envoyer" })]
            : h("button", { type: "button", onclick: closeEnded, text: "OK" }))));
  }
  return h("div", { class: "scrim" },
    h("div", { class: "md-dialog", role: "alertdialog", "aria-modal": "true", "aria-label": "Message USSD" },
      h("div", { class: "body", text: p.screen.text }),
      input,
      h("div", { class: "buttons" },
        open ? [h("button", { type: "button", onclick: hangUp, text: "Annuler" }), h("button", { type: "button", onclick: send, text: "Envoyer" })]
          : h("button", { type: "button", onclick: closeEnded, text: "OK" }))));
}
function smartphone(kind) {
  const p = state.phone;
  const tab = (view, label, ic) => h("button", {
    type: "button", "aria-current": p.view === view ? "page" : null,
    onclick: () => { p.view = view; renderPhone({ focus: view === "messages" ? "sms" : null }); },
  }, icon(ic), label);
  return h("div", { class: `device smart ${kind}`, role: "group", "aria-label": kind === "iphone" ? "iPhone" : "Téléphone Android" },
    h("div", { class: kind === "iphone" ? "island" : "camera", "aria-hidden": "true" }),
    h("div", { class: "screen" },
      statusBar(),
      p.view === "dialer" ? dialer() : chatView(),
      ussdLayer(kind),
      h("nav", { class: "tabs", "aria-label": "Applications" }, tab("dialer", "Clavier", "keypad"), tab("messages", "Messages", "chat")),
      h("div", { class: "homebar", "aria-hidden": "true" })));
}

// The simple keypad phone: a small screen, soft keys, real keys.
function simplePhone() {
  const p = state.phone;
  const s = state.simple;
  const inUssd = p.running || p.screen;
  let body;
  let left = "";
  let right = "";
  if (p.running) {
    body = h("div", { class: "center", style: "margin-top:58px", text: "Requête USSD\nen cours..." });
  } else if (p.screen) {
    body = [h("div", { text: p.screen.text }), !p.screen.end ? h("div", { class: "entry" }, `> ${p.ussdDraft}`, h("span", { class: "caret", text: "_" })) : null];
    left = p.screen.end ? "OK" : "Envoyer";
    right = p.screen.end ? "" : "Annuler";
  } else if (s.view === "messages") {
    const msgs = [...p.inbox].reverse();
    body = msgs.length ? msgs.map((m) => h("div", { style: "margin-bottom:6px" }, h("b", { text: `${m.from}: ` }), m.text)) : h("div", { class: "center", style: "margin-top:58px", text: "Aucun message" });
    left = "Écrire";
    right = "Retour";
  } else if (s.view === "compose") {
    body = [h("div", { text: "À: MAIRIE" }), h("div", { class: "entry" }, s.compose, h("span", { class: "caret", text: "_" }))];
    left = "Envoyer";
    right = s.compose ? "Effacer" : "Retour";
  } else if (p.dialing) {
    body = h("div", { class: "big", text: p.dialing });
    left = "Appeler";
    right = "Effacer";
  } else {
    body = [h("div", { class: "center", style: "font-size:28px;margin-top:22px", text: time() }), h("div", { class: "center", text: new Date().toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" }) }), h("div", { class: "center", style: "margin-top:14px", text: `Composez ${CODE}` })];
    left = "Messages";
    right = "";
  }

  const leftAction = async () => {
    if (p.screen) return p.screen.end ? closeEnded() : reply(p.ussdDraft);
    if (s.view === "messages") { s.view = "compose"; return renderPhone({ focus: "simple" }); }
    if (s.view === "compose") { const t = s.compose; s.compose = ""; s.view = "messages"; await sendSms(t); return renderPhone({ focus: "simple" }); }
    if (p.dialing) return dial(p.dialing);
    s.view = "messages";
    renderPhone({ focus: "simple" });
  };
  const rightAction = () => {
    if (p.screen) return p.screen.end ? closeEnded() : hangUp();
    if (s.view === "compose") { if (s.compose) s.compose = s.compose.slice(0, -1); else s.view = "messages"; return renderPhone({ focus: "simple" }); }
    if (s.view === "messages") { s.view = "home"; return renderPhone({ focus: "simple" }); }
    p.dialing = p.dialing.slice(0, -1);
    renderPhone({ focus: "simple" });
  };
  const type = (k) => {
    if (p.running) return;
    if (p.screen && !p.screen.end) p.ussdDraft += k;
    else if (s.view === "compose") s.compose += k;
    else if (!p.screen && s.view === "home") p.dialing += k;
    renderPhone({ focus: "simple" });
  };
  const green = () => (p.screen ? (p.screen.end ? closeEnded() : reply(p.ussdDraft)) : s.view === "compose" ? leftAction() : dial(p.dialing || CODE));
  const red = () => { if (inUssd) return hangUp(); s.view = "home"; s.compose = ""; p.dialing = ""; renderPhone({ focus: "simple" }); };

  const letters = { 2: "abc", 3: "def", 4: "ghi", 5: "jkl", 6: "mno", 7: "pqrs", 8: "tuv", 9: "wxyz", 0: "␣" };
  const device = h("div", {
    class: "device simple", tabindex: "0", role: "group", "aria-label": "Téléphone simple. Tapez au clavier de l'ordinateur : chiffres et lettres, Entrée pour appeler ou envoyer, Échap pour raccrocher.",
    onkeydown: (e) => {
      if (e.target !== device) return;
      if (e.key === "Enter") { e.preventDefault(); green(); }
      else if (e.key === "Escape") { e.preventDefault(); red(); }
      else if (e.key === "Backspace") { e.preventDefault(); if (p.screen && !p.screen.end) { p.ussdDraft = p.ussdDraft.slice(0, -1); renderPhone({ focus: "simple" }); } else rightAction(); }
      else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) { e.preventDefault(); type(s.view === "compose" || (p.screen && !p.screen.end) ? e.key : /[0-9*#]/.test(e.key) ? e.key : ""); }
    },
  },
    h("div", { class: "speaker", "aria-hidden": "true" }),
    h("div", { class: "brandline", "aria-hidden": "true", text: "MOBILE" }),
    h("div", { class: "lcd", role: "status", "aria-live": "polite" },
      h("div", { class: "lcd-status" }, h("span", { text: "▂▄▆ SN" }), h("span", { text: inUssd ? "USSD" : s.view === "home" ? "" : "SMS" }), h("span", { text: time() })),
      h("div", { class: "lcd-body" }, body),
      h("div", { class: "lcd-soft" }, h("span", { text: left }), h("span", { text: right }))),
    h("div", { class: "softkeys" },
      h("button", { type: "button", onclick: leftAction, "aria-label": left || "Touche gauche", text: "—" }),
      h("button", { type: "button", class: "navkey", "aria-label": "Valider", onclick: leftAction, text: "OK" }),
      h("button", { type: "button", onclick: rightAction, "aria-label": right || "Touche droite", text: "—" })),
    h("div", { class: "callkeys" },
      h("button", { type: "button", class: "green", "aria-label": p.screen ? "Envoyer" : `Appeler ${p.dialing || CODE}`, onclick: green }, icon("phone")),
      h("button", { type: "button", class: "red", "aria-label": "Raccrocher", onclick: red }, icon("phone"))),
    h("div", { class: "keys", role: "group", "aria-label": "Clavier" },
      ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"].map((k) =>
        h("button", { type: "button", "aria-label": k, onclick: () => type(k) }, k, h("small", { text: letters[k] ?? " " })))));
  return device;
}

function renderPhone(opts = {}) {
  const host = $("device");
  const active = document.activeElement;
  const wasInPhone = Boolean(active?.closest?.(".device"));
  host.replaceChildren(state.device === "simple" ? simplePhone() : smartphone(state.device));
  if (state.device === "simple") {
    // The simple phone takes the keyboard as a whole: keep it focused while in use.
    if (opts.focus || wasInPhone) host.querySelector(".simple")?.focus({ preventScroll: true });
  } else {
    const id = opts.focus === "ussd" ? "ussd-input" : opts.focus === "sms" ? "sms-input" : wasInPhone ? active.id : null;
    if (id) document.getElementById(id)?.focus({ preventScroll: true });
  }
  fitPhone();
}

/** Scales the phone to the room left under the controls: the page never scrolls. */
function fitPhone() {
  const stage = $("stage");
  const device = $("device").firstElementChild;
  if (!stage || !device || !stage.clientHeight) return;
  const scale = Math.min(1, (stage.clientHeight - 8) / device.offsetHeight, (stage.clientWidth - 8) / device.offsetWidth);
  $("device").style.setProperty("--fit", String(Math.max(0.5, scale)));
}

function renderTips() {
  const smart = state.device !== "simple";
  const tips = [
    h("li", {}, "Composez ", h("code", { text: CODE }), ", puis ", h("code", { text: "1" }), " ", h("code", { text: "1" }), " ", h("code", { text: "1" }), " ", h("code", { text: "1" }), " : forage en panne, urgent."),
    h("li", {}, "Tout en une fois : ", h("code", { text: "*123*1*4*3#" }), " (lampadaire, peut attendre)."),
    h("li", {}, smart ? "Onglet Messages : envoyez « bonjour », puis 5, puis votre message." : "Touche Messages, puis Écrire : « bonjour », puis 5, puis votre message."),
    smart ? h("li", {}, "Le micro de Messages enregistre un message vocal, transcrit par le navigateur.") : h("li", {}, "Le clavier de l'ordinateur marche quand le téléphone a le focus : Entrée appelle, Échap raccroche."),
    h("li", {}, "Côté Mairie, ouvrez un signalement et passez-le « Résolu » : le chef reçoit un SMS dans ce téléphone."),
    h("li", {}, "Le bouton Assistant ouvre une page pour interroger les fiches, à l'écrit ou à la voix."),
  ];
  $("tips").replaceChildren(...tips);
}

// ---------- Mairie: the list ----------
function matches(r) {
  const f = state.filter;
  if (f.urgent && (r.urgence !== "haute" || r.statut === "resolu")) return false;
  if (!f.q) return true;
  const q = f.q.toLowerCase();
  return [r.code, r.village, r.description, r.equipement ?? "", LABEL[r.categorie]].some((v) => v.toLowerCase().includes(q));
}
let lastSignature = "";
async function refreshReports({ background = false } = {}) {
  const q = new URLSearchParams();
  if (state.filter.statut) q.set("statut", state.filter.statut);
  if (state.filter.categorie) q.set("categorie", state.filter.categorie);
  try {
    const d = await call("GET", `/api/signalements?${q}`);
    // A background refresh never redraws for nothing, nor under an open dialog.
    const signature = JSON.stringify([q.toString(), d]);
    if (background && (signature === lastSignature || $("report-dialog").open)) return;
    lastSignature = signature;
    const fresh = state.seen ? d.signalements.filter((s) => !state.seen.has(s.code)) : [];
    state.seen ??= new Set();
    for (const s of d.signalements) state.seen.add(s.code);
    state.reports = d.signalements;
    state.counts = d.counts;
    renderReports(new Set(fresh.map((s) => s.code)));
    if (fresh.length) announce(fresh.length === 1 ? `Nouveau signalement ${fresh[0].code}, ${fresh[0].village}, urgence ${fresh[0].urgence}.` : `${fresh.length} nouveaux signalements.`);
  } catch (err) {
    toast(err.message);
  }
}
function renderFilters() {
  const c = state.counts;
  const total = c.nouveau + c.a_verifier + c.en_cours + c.resolu;
  const tabs = [["", "Tous", total], ["nouveau", "Nouveaux", c.nouveau], ["a_verifier", "À vérifier", c.a_verifier], ["en_cours", "En cours", c.en_cours], ["resolu", "Résolus", c.resolu]];
  const focused = document.activeElement?.closest?.("#statuts") ? document.activeElement.dataset.value : null;
  $("statuts").replaceChildren(...tabs.map(([v, label, n]) => h("button", {
    type: "button", role: "radio", "data-value": v, "aria-checked": String(state.filter.statut === v),
    tabindex: state.filter.statut === v ? "0" : "-1",
    onclick: () => { state.filter.statut = v; refreshReports(); },
  }, label, h("span", { class: "n", text: String(n) }))));
  if (focused !== null) $("statuts").querySelector(`[data-value="${focused}"]`)?.focus();
  $("k-urgent").textContent = String(c.haute);
  $("urgent").setAttribute("aria-pressed", String(state.filter.urgent));
}
function renderReports(fresh = new Set()) {
  renderFilters();
  const rows = state.reports.filter(matches);
  const filtered = state.filter.q || state.filter.categorie || state.filter.urgent || state.filter.statut;
  $("result-line").textContent = `${rows.length} signalement${rows.length > 1 ? "s" : ""}${filtered ? " · filtrés" : ""} · cliquez une ligne pour l'ouvrir`;
  $("empty").hidden = rows.length > 0;
  $("rows").replaceChildren(...rows.map((r) => h("tr", { class: fresh.has(r.code) ? "fresh" : null, onclick: (e) => { if (!e.target.closest("button")) openReport(r.code); } },
    h("td", { class: "c-code" },
      h("button", { type: "button", class: "row-open", "aria-label": `Ouvrir ${r.code}`, onclick: () => openReport(r.code), text: r.code }),
      h("span", { class: "sub channel", title: fullDate(r.creeLe) }, icon(r.canal === "mairie" ? "mairie" : r.canal), `${CANAL[r.canal] ?? r.canal} · ${ago(r.creeLe)}`)),
    h("td", { class: "c-village" }, h("span", { class: "one-line", text: r.village })),
    h("td", { class: "c-object" },
      h("span", { class: "one-line" },
        h("span", { class: `cat cat-${r.categorie}`, text: LABEL[r.categorie] ?? r.categorie }),
        h("span", { class: "desc", text: r.equipement ? r.equipement.split(",")[0] : r.description })),
      h("span", { class: "sub", text: r.equipement ? r.description : r.confiance < 1 ? `Classé automatiquement · confiance ${Math.round(r.confiance * 100)} %` : "" })),
    h("td", { class: "c-urgence" }, h("span", { class: `badge u-${r.urgence}`, text: URGENCE[r.urgence] })),
    h("td", { class: "c-statut" }, h("span", { class: `badge s-${r.statut}`, text: STATUT[r.statut] })))));
}

// ---------- Mairie: one report, to read, change, create or delete ----------
const dlg = () => $("report-dialog");
let editing = null; // the report open in the dialog, or null when creating one
let picked = { urgence: "moyenne", statut: "nouveau" };

/** A row of radio buttons, with arrow keys, as the platform's own. */
function radios(host, options, value, onPick) {
  const draw = (current) => {
    host.replaceChildren(...options.map(([v, label]) => h("button", {
      type: "button", role: "radio", "data-value": v, "aria-checked": String(v === current), tabindex: v === current ? "0" : "-1",
      onclick: () => { onPick(v); draw(v); host.querySelector(`[data-value="${v}"]`).focus(); },
    }, label)));
  };
  host.onkeydown = (e) => {
    if (!["ArrowLeft", "ArrowRight"].includes(e.key)) return;
    e.preventDefault();
    const i = options.findIndex(([v]) => v === host.querySelector('[aria-checked="true"]')?.dataset.value);
    const [next] = options[(i + (e.key === "ArrowRight" ? 1 : options.length - 1)) % options.length];
    onPick(next);
    draw(next);
    host.querySelector(`[data-value="${next}"]`).focus();
  };
  draw(value);
}
async function fillEquipements(villageId, selected) {
  const sel = $("rd-equipement");
  sel.disabled = true;
  const list = await call("GET", `/api/equipements?village=${villageId}`);
  sel.replaceChildren(h("option", { value: "", text: "Aucun" }), ...list.map((e) => h("option", { value: String(e.id), text: e.nom.split(",")[0] })));
  sel.value = selected ? String(selected) : "";
  sel.disabled = false;
}
function formError(text) {
  $("rd-error").textContent = text ?? "";
  $("rd-error").hidden = !text;
}
function showConfirm(on) {
  $("rd-confirm").hidden = !on;
  $("rd-delete").hidden = on;
  if (on) $("rd-confirm-no").focus();
}
function prepareForm(r) {
  $("rd-categorie").replaceChildren(...Object.entries(LABEL).map(([k, v]) => h("option", { value: k, text: v })));
  $("rd-categorie").value = r?.categorie ?? "eau";
  picked = { urgence: r?.urgence ?? "moyenne", statut: r?.statut ?? "nouveau" };
  radios($("rd-urgence"), Object.entries(URGENCE), picked.urgence, (v) => (picked.urgence = v));
  radios($("rd-statut"), Object.entries(STATUT), picked.statut, (v) => (picked.statut = v));
  $("rd-description").value = r?.description ?? "";
  $("rd-notify").checked = true;
  formError(null);
  showConfirm(false);
}
async function openReport(code) {
  let r;
  try {
    r = await call("GET", `/api/signalements/${code}`);
  } catch (err) {
    return toast(err.message);
  }
  editing = r;
  $("rd-title").textContent = `${r.code} · ${LABEL[r.categorie]}`;
  $("rd-sub").textContent = `${r.village} · ${CANAL[r.canal] ?? r.canal} · ${fullDate(r.creeLe)} · ${r.telephone}`;
  const notice = r.statut === "a_verifier"
    ? `Classé automatiquement (confiance ${Math.round(r.confiance * 100)} %) : vérifiez la catégorie et l'urgence, puis passez-le « En cours ».`
    : r.statut === "resolu" && r.resoluLe ? `Résolu le ${fullDate(r.resoluLe)}.` : "";
  $("rd-notice").textContent = notice;
  $("rd-notice").hidden = !notice;
  $("rd-new-fields").hidden = true;
  $("rd-statut-field").hidden = false;
  $("rd-danger").hidden = false;
  $("rd-notify-label").textContent = "Prévenir le chef par SMS si le statut change";
  $("rd-save").textContent = "Enregistrer";
  prepareForm(r);
  await fillEquipements(r.villageId, r.equipementId);
  dlg().showModal();
}
async function openNew() {
  editing = null;
  $("rd-title").textContent = "Nouveau signalement";
  $("rd-sub").textContent = "Saisi par la Mairie, après un appel ou une visite.";
  $("rd-notice").hidden = true;
  $("rd-new-fields").hidden = false;
  $("rd-statut-field").hidden = true;
  $("rd-danger").hidden = true;
  $("rd-notify-label").textContent = "Prévenir le chef du village par SMS";
  $("rd-save").textContent = "Créer";
  const villages = await call("GET", "/api/villages");
  $("rd-village").replaceChildren(...villages.map((v) => h("option", { value: String(v.id), text: v.nom })));
  const mine = state.chefs.find((c) => c.telephone === state.chef)?.village;
  const start = villages.find((v) => v.nom === mine) ?? villages[0];
  $("rd-village").value = String(start.id);
  prepareForm(null);
  await fillEquipements(start.id, null);
  dlg().showModal();
  $("rd-village").focus();
}
async function afterChange(sms, telephone) {
  if (sms) toast(`SMS envoyé au chef : « ${sms} »`);
  if (telephone && state.chefs.some((c) => c.telephone === state.chef)) {
    await phoneCall("inbox");
    if (!document.activeElement?.closest?.(".device")) renderPhone();
  }
  await refreshReports();
}
async function saveReport(e) {
  e.preventDefault();
  const description = $("rd-description").value.trim();
  if (!description) {
    formError("Décrivez le problème en quelques mots.");
    return $("rd-description").focus();
  }
  const fields = {
    categorie: $("rd-categorie").value,
    urgence: picked.urgence,
    description,
    equipementId: $("rd-equipement").value ? Number($("rd-equipement").value) : null,
    notify: $("rd-notify").checked,
  };
  const save = $("rd-save");
  save.disabled = true;
  try {
    let res;
    if (editing) {
      const change = { notify: fields.notify };
      for (const k of ["categorie", "urgence", "description", "equipementId"]) if (fields[k] !== editing[k]) change[k] = fields[k];
      if (picked.statut !== editing.statut) change.statut = picked.statut;
      if (Object.keys(change).length === 1) return dlg().close();
      res = await call("PATCH", `/api/signalements/${editing.code}`, change);
      announce(`${editing.code} enregistré.`);
      if (!res.sms) toast(`${editing.code} enregistré.`);
    } else {
      res = await call("POST", "/api/signalements", { ...fields, villageId: Number($("rd-village").value) });
      state.seen?.add(res.signalement.code);
      if (!res.sms) toast(`${res.signalement.code} créé.`);
    }
    dlg().close();
    await afterChange(res.sms, res.signalement.telephone);
  } catch (err) {
    formError(err.message);
  } finally {
    save.disabled = false;
  }
}
async function deleteReport() {
  if (!editing) return;
  try {
    await call("DELETE", `/api/signalements/${editing.code}`);
    toast(`${editing.code} supprimé.`);
    dlg().close();
    await refreshReports();
  } catch (err) {
    formError(err.message);
  }
}

// ---------- Start ----------
async function start() {
  let restored = false;
  try {
    ({ restored } = await connect());
    const [info, chefs] = await Promise.all([call("GET", "/api/info"), call("GET", "/api/chefs")]);
    $("mode").textContent = MODE === "local" ? "Dans votre navigateur" : "Serveur";
    $("mode").title = info.mode;
    state.chefs = chefs;
    state.chef = chefs[6]?.telephone ?? chefs[0].telephone;
  } catch (err) {
    $("booting").replaceChildren(h("p", { text: `La démonstration n'a pas pu démarrer : ${err.message}. Vérifiez votre connexion (SQLite se charge depuis cdnjs) puis rechargez la page.` }));
    return;
  }

  // Village side
  $("chef").replaceChildren(...state.chefs.map((c) => h("option", { value: c.telephone, text: `${c.village} · ${c.telephone.slice(0, 4)} •• ${c.telephone.slice(-2)}` })));
  $("chef").value = state.chef;
  $("chef").onchange = async (e) => {
    state.chef = e.target.value;
    cancelVoiceMessage();
    Object.assign(state.phone, { screen: null, running: false, dialing: "", ussdDraft: "", smsDraft: "" });
    state.simple = { view: "home", compose: "" };
    await phoneCall("inbox");
    renderPhone();
  };
  const setDevice = (d) => {
    state.device = d;
    try { localStorage.setItem("ndiedieng.device", d); } catch {}
    for (const b of document.querySelectorAll("#devices button")) {
      b.setAttribute("aria-checked", String(b.dataset.device === d));
      b.tabIndex = b.dataset.device === d ? 0 : -1;
    }
    cancelVoiceMessage();
    renderPhone();
  };
  for (const b of document.querySelectorAll("#devices button")) b.onclick = () => setDevice(b.dataset.device);
  $("devices").onkeydown = (e) => {
    if (!["ArrowLeft", "ArrowRight"].includes(e.key)) return;
    const order = ["simple", "android", "iphone"];
    const next = order[(order.indexOf(state.device) + (e.key === "ArrowRight" ? 1 : 2)) % 3];
    setDevice(next);
    document.querySelector(`#devices [data-device="${next}"]`).focus();
  };
  new ResizeObserver(() => fitPhone()).observe($("stage"));

  // One side at a time on a narrow screen
  const setPane = (pane) => {
    $("app").dataset.pane = pane;
    for (const b of document.querySelectorAll("#panes button")) b.setAttribute("aria-pressed", String(b.dataset.pane === pane));
    if (pane === "village") requestAnimationFrame(fitPhone);
  };
  for (const b of document.querySelectorAll("#panes button")) b.onclick = () => setPane(b.dataset.pane);
  setPane("village");

  // Mairie side
  $("urgent").onclick = () => { state.filter.urgent = !state.filter.urgent; renderReports(); };
  $("statuts").onkeydown = (e) => {
    if (!["ArrowLeft", "ArrowRight"].includes(e.key)) return;
    e.preventDefault();
    const order = ["", "nouveau", "a_verifier", "en_cours", "resolu"];
    state.filter.statut = order[(order.indexOf(state.filter.statut) + (e.key === "ArrowRight" ? 1 : 4)) % 5];
    refreshReports();
  };
  $("q").oninput = (e) => { state.filter.q = e.target.value.trim(); renderReports(); };
  $("categorie").onchange = (e) => { state.filter.categorie = e.target.value; refreshReports(); };
  $("clear").onclick = () => { state.filter = { statut: "", urgent: false, categorie: "", q: "" }; $("q").value = ""; $("categorie").value = ""; refreshReports(); };
  $("new").onclick = () => openNew().catch((err) => toast(err.message));

  // The report dialog
  $("report-form").onsubmit = saveReport;
  $("rd-village").onchange = (e) => fillEquipements(Number(e.target.value), null).catch((err) => formError(err.message));
  $("rd-delete").onclick = () => showConfirm(true);
  $("rd-confirm-no").onclick = () => { showConfirm(false); $("rd-delete").focus(); };
  $("rd-confirm-yes").onclick = deleteReport;
  for (const d of document.querySelectorAll("dialog")) {
    for (const b of d.querySelectorAll("[data-close]")) b.onclick = () => d.close();
    // A click on the backdrop closes, as people expect.
    d.addEventListener("click", (e) => { if (e.target === d) d.close(); });
  }

  // Help
  $("help-open").onclick = () => { renderTips(); $("help-dialog").showModal(); };
  $("reset-line").hidden = MODE !== "local";
  $("reset").onclick = async () => { if (await resetDemo()) location.reload(); };

  $("booting").hidden = true;
  $("app").hidden = false;
  setDevice(state.device);
  await phoneCall("inbox");
  renderPhone();
  await refreshReports();
  if (restored) toast("Votre démonstration a repris là où vous l'aviez laissée. Aide › Recommencer pour repartir de zéro.");
  setInterval(() => refreshReports({ background: true }), MODE === "local" ? 5000 : 4000);
  setInterval(() => { if (!document.activeElement?.closest?.(".device") && !recording) renderPhone(); }, 30000);
}
start();
