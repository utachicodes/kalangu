// The Ndiédieng demo page. Talks to the prototype's API: in the visitor's
// browser on the website (app/web/local.js), or over HTTP to server.ts.
// Every value from the API reaches the page through textContent, never as
// HTML; only the constant icons below are parsed as markup.

const MODE = document.querySelector('meta[name="ndiedieng-mode"]')?.getAttribute("content") ?? "server";
const CODE = "*123#";

// ---------- Small helpers ----------
const $ = (id) => document.getElementById(id);
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat(Infinity)) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}
const ICONS = {
  phone: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.6a1 1 0 0 1-.25 1z"/></svg>',
  keypad: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="5" r="1.6"/><circle cx="12" cy="5" r="1.6"/><circle cx="18" cy="5" r="1.6"/><circle cx="6" cy="11" r="1.6"/><circle cx="12" cy="11" r="1.6"/><circle cx="18" cy="11" r="1.6"/><circle cx="6" cy="17" r="1.6"/><circle cx="12" cy="17" r="1.6"/><circle cx="18" cy="17" r="1.6"/><circle cx="12" cy="22" r="1.2"/></svg>',
  chat: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z" stroke-linejoin="round"/></svg>',
  mic: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
  send: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
  erase: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5h11v14H9l-6-7z"/><path d="m12 9 5 6m0-6-5 6"/></svg>',
  ussd: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h10"/></svg>',
  sms: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z"/></svg>',
  vocal: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
  signal: '<svg viewBox="0 0 18 12" aria-hidden="true"><rect x="0" y="8" width="3" height="4" rx="1" fill="currentColor"/><rect x="5" y="5" width="3" height="7" rx="1" fill="currentColor"/><rect x="10" y="2.5" width="3" height="9.5" rx="1" fill="currentColor"/><rect x="15" y="0" width="3" height="12" rx="1" fill="currentColor" opacity=".35"/></svg>',
  battery: '<svg viewBox="0 0 26 12" aria-hidden="true"><rect x=".5" y=".5" width="22" height="11" rx="3" fill="none" stroke="currentColor" opacity=".5"/><rect x="2" y="2" width="15" height="8" rx="1.6" fill="currentColor"/><rect x="23.5" y="4" width="2" height="4" rx="1" fill="currentColor" opacity=".5"/></svg>',
};
function icon(name, cls = "") {
  const span = h("span", { class: `icon-wrap ${cls}` });
  span.innerHTML = ICONS[name]; // constant markup, never data
  return span.firstElementChild;
}
const time = () => new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
const rtf = new Intl.RelativeTimeFormat("fr", { numeric: "auto" });
function ago(iso) {
  const s = (new Date(iso).getTime() - Date.now()) / 1000;
  const steps = [[60, "second"], [60, "minute"], [24, "hour"], [7, "day"], [4.35, "week"], [12, "month"], [Infinity, "year"]];
  let v = s;
  for (const [n, unit] of steps) {
    if (Math.abs(v) < n) return rtf.format(Math.round(v), unit);
    v /= n;
  }
  return "";
}
const fullDate = (iso) => new Date(iso).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" });
const LABEL = { eau: "Eau", sante: "Santé", ecole: "École", energie: "Énergie", piste: "Piste", naissance: "Naissance", deces: "Décès", autre: "Autre" };
const STATUT = { nouveau: "Nouveau", a_verifier: "À vérifier", en_cours: "En cours", resolu: "Résolu" };
const CANAL = { ussd: "USSD", sms: "SMS", vocal: "Vocal" };

function toast(text) {
  const t = $("toast");
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 4200);
}
const announce = (text) => {
  $("announce").textContent = "";
  setTimeout(() => ($("announce").textContent = text), 50);
};

// ---------- Voice: dictation and reading aloud, from the browser ----------
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const canListen = Boolean(Recognition);
const canSpeak = "speechSynthesis" in window;
function listen({ onText, onDone, onError }) {
  const r = new Recognition();
  r.lang = "fr-FR";
  r.interimResults = true;
  r.maxAlternatives = 1;
  let finalText = "";
  r.onresult = (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) finalText += e.results[i][0].transcript;
      else interim += e.results[i][0].transcript;
    }
    onText((finalText + interim).trim());
  };
  r.onerror = (e) => onError?.(e.error === "not-allowed" ? "Le micro n'est pas autorisé pour ce site." : e.error === "no-speech" ? "Je n'ai rien entendu." : "La dictée a échoué.");
  r.onend = () => onDone(finalText.trim());
  r.start();
  return r;
}
function speak(text) {
  if (!canSpeak) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "fr-FR";
  const voice = speechSynthesis.getVoices().find((v) => v.lang?.toLowerCase().startsWith("fr"));
  if (voice) u.voice = voice;
  speechSynthesis.speak(u);
}

// ---------- State ----------
const state = {
  api: null,
  chefs: [],
  chef: null,
  device: "android",
  phone: { view: "dialer", dialing: "", running: false, screen: null, inSession: false, inbox: [], sent: {}, smsDraft: "", ussdDraft: "", listening: false },
  simple: { view: "home", compose: "" },
  reports: [],
  counts: { nouveau: 0, a_verifier: 0, en_cours: 0, resolu: 0, haute: 0 },
  filter: { statut: "", urgent: false, categorie: "", q: "" },
  seen: null,
  speakAnswers: false,
  thread: [],
};
try {
  state.device = localStorage.getItem("ndiedieng.device") || state.device;
} catch {}

// ---------- API ----------
async function call(method, path, body) {
  const res = await state.api(method, path, body);
  if (res.status >= 400) throw new Error(res.body?.error || `Erreur ${res.status}`);
  return res.body;
}
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
let phoneRecognition = null;
function toggleVoiceMessage() {
  const p = state.phone;
  if (p.listening) {
    phoneRecognition?.stop();
    return;
  }
  p.listening = true;
  p.smsDraft = "";
  renderPhone();
  phoneRecognition = listen({
    onText: (t) => {
      p.smsDraft = t;
      const input = document.querySelector("#sms-input");
      if (input) input.value = t;
    },
    onDone: (t) => {
      p.listening = false;
      phoneRecognition = null;
      if (t) sendSms(t, "vocal");
      else renderPhone();
    },
    onError: (m) => toast(m),
  });
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
    id: "sms-input", type: "text", value: p.smsDraft, placeholder: p.listening ? "Je vous écoute…" : "Message", "aria-label": "Message à la Mairie", autocomplete: "off",
    oninput: (e) => (p.smsDraft = e.target.value),
    onkeydown: (e) => { if (e.key === "Enter") sendSms(e.target.value); },
  });
  const micBtn = h("button", {
    type: "button", class: `round mic${p.listening ? " listening" : ""}`, disabled: !canListen,
    "aria-label": p.listening ? "Arrêter et envoyer le message vocal" : "Dicter un message vocal",
    title: canListen ? "Message vocal (transcrit par le navigateur)" : "La dictée n'est pas disponible dans ce navigateur (essayez Chrome ou Safari)",
    onclick: toggleVoiceMessage,
  }, icon("mic"));
  setTimeout(() => (chat.scrollTop = chat.scrollHeight));
  return h("div", { class: "app" },
    h("div", { class: "chat-head" }, h("span", { class: "avatar", text: "M" }), h("strong", { text: "MAIRIE" }), h("span", { text: "Ndiédieng", style: "opacity:.6" })),
    chat,
    p.listening ? h("div", { class: "listening-note", text: "Parlez : votre message sera transcrit puis envoyé." }) : null,
    h("div", { class: "compose" }, micBtn, input,
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
  renderTips();
}

function renderTips() {
  const smart = state.device !== "simple";
  const tips = [
    h("li", {}, "Composez ", h("code", { text: CODE }), ", puis ", h("code", { text: "1" }), " ", h("code", { text: "1" }), " ", h("code", { text: "1" }), " ", h("code", { text: "1" }), " : forage en panne, urgent."),
    h("li", {}, "Tout en une fois : ", h("code", { text: "*123*1*4*3#" }), " (lampadaire, peut attendre)."),
    h("li", {}, smart ? "Onglet Messages : envoyez « bonjour », puis 5, puis votre message." : "Touche Messages, puis Écrire : « bonjour », puis 5, puis votre message."),
    smart ? h("li", {}, "Le micro de Messages dicte un message vocal, transcrit par le navigateur.") : h("li", {}, "Le clavier de l'ordinateur marche quand le téléphone a le focus : Entrée appelle, Échap raccroche."),
    h("li", {}, "À droite, « Résolu » envoie un SMS au chef : il arrive dans ce téléphone."),
  ];
  $("tips").replaceChildren(...tips);
}

// ---------- Mairie: reports ----------
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
    // A background refresh never redraws under the user's hands, nor for nothing.
    const signature = JSON.stringify([q.toString(), d]);
    if (background && (signature === lastSignature || document.activeElement?.closest?.("#rows"))) return;
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
async function act(r, verb, body) {
  try {
    const res = await call("POST", `/api/signalements/${r.code}/${verb}`, body);
    toast(`SMS envoyé au chef du ${r.village} : « ${res.sms} »`);
    if (state.chefs.find((c) => c.telephone === state.chef)?.village === r.village) {
      await phoneCall("inbox");
      renderPhone();
    }
    refreshReports();
  } catch (err) {
    toast(err.message);
  }
}
function actionsFor(r) {
  if (r.statut === "a_verifier") {
    const cat = h("select", { "aria-label": `Catégorie pour ${r.code}` }, Object.entries(LABEL).map(([k, v]) => h("option", { value: k, selected: k === r.categorie, text: v })));
    const urg = h("select", { "aria-label": `Urgence pour ${r.code}` }, ["haute", "moyenne", "basse"].map((u) => h("option", { value: u, selected: u === r.urgence, text: u })));
    return [cat, urg, h("button", { type: "button", class: "btn btn-primary", onclick: (e) => { e.target.disabled = true; act(r, "verifier", { categorie: cat.value, urgence: urg.value }); }, text: "Valider" })];
  }
  if (r.statut === "nouveau") {
    return [
      h("button", { type: "button", class: "btn", onclick: (e) => { e.target.disabled = true; act(r, "prendre"); }, text: "Prendre en charge" }),
      h("button", { type: "button", class: "btn btn-primary", onclick: (e) => { e.target.disabled = true; act(r, "resoudre"); }, text: "Résolu" }),
    ];
  }
  if (r.statut === "en_cours") return h("button", { type: "button", class: "btn btn-primary", onclick: (e) => { e.target.disabled = true; act(r, "resoudre"); }, text: "Marquer résolu" });
  return h("span", { class: "sub", text: "Chef informé par SMS" });
}
function renderReports(fresh = new Set()) {
  for (const k of ["nouveau", "a_verifier", "en_cours", "haute"]) $(`k-${k}`).textContent = state.counts[k];
  for (const b of document.querySelectorAll(".kpi")) {
    const f = b.dataset.filter;
    b.setAttribute("aria-pressed", String(f === "urgent" ? state.filter.urgent : state.filter.statut === f && !state.filter.urgent));
  }
  const total = state.counts.nouveau + state.counts.a_verifier + state.counts.en_cours + state.counts.resolu;
  const segs = [["", "Tous", total], ["nouveau", "Nouveaux", state.counts.nouveau], ["a_verifier", "À vérifier", state.counts.a_verifier], ["en_cours", "En cours", state.counts.en_cours], ["resolu", "Résolus", state.counts.resolu]];
  $("statuts").replaceChildren(...segs.map(([v, label, n]) => h("button", {
    type: "button", role: "radio", "aria-checked": String(state.filter.statut === v),
    onclick: () => { state.filter.statut = v; state.filter.urgent = false; refreshReports(); },
  }, label, h("span", { class: "count", text: String(n) }))));

  const rows = state.reports.filter(matches);
  const urgent = rows.filter((r) => r.urgence === "haute" && r.statut !== "resolu").length;
  $("result-line").textContent = `${rows.length} signalement${rows.length > 1 ? "s" : ""}${urgent ? ` · ${urgent} urgent${urgent > 1 ? "s" : ""} non résolu${urgent > 1 ? "s" : ""}` : ""}${state.filter.urgent ? " · filtre : urgents" : ""}`;
  $("empty").hidden = rows.length > 0;
  $("rows").replaceChildren(...rows.map((r) => h("tr", { class: fresh.has(r.code) ? "fresh" : null },
    h("td", {},
      h("span", { class: "code", text: r.code }),
      h("span", { class: "sub channel" }, icon(r.canal), CANAL[r.canal] ?? r.canal),
      h("span", { class: "sub", title: fullDate(r.creeLe), text: ago(r.creeLe) })),
    h("td", {}, h("span", { class: "nowrap", text: r.village }), h("span", { class: "sub nowrap", text: r.telephone })),
    h("td", { class: "cell-object" },
      h("div", { class: "object" },
        h("span", { class: `cat cat-${r.categorie}`, text: LABEL[r.categorie] ?? r.categorie }),
        r.equipement ? h("span", { class: "sub", text: r.equipement.split(",")[0] }) : null,
        h("span", { class: "desc", text: r.description }),
        r.confiance < 1 ? h("span", { class: "sub", text: `Classé automatiquement, confiance ${Math.round(r.confiance * 100)}\u00a0%` }) : null)),
    h("td", {}, h("span", { class: `badge u-${r.urgence}`, text: r.urgence })),
    h("td", {}, h("span", { class: `badge s-${r.statut}`, text: STATUT[r.statut] })),
    h("td", { class: "cell-actions" }, h("div", { class: "actions" }, actionsFor(r))))));
}

// ---------- Mairie: assistant ----------
function renderThread() {
  $("thread").replaceChildren(...state.thread.map((m) => {
    if (m.role === "user") return h("div", { class: "msg msg-user", text: m.text });
    if (m.pending) return h("div", { class: "msg msg-bot", "aria-label": "L'assistant réfléchit" }, h("span", { class: "typing" }, h("span"), h("span"), h("span")));
    const data = m.sql
      ? h("details", {},
          h("summary", { text: `Données utilisées · ${m.rows.length} ligne${m.rows.length > 1 ? "s" : ""}` }),
          h("pre", { text: m.sql }),
          h("div", { class: "data-scroll" },
            h("table", {},
              h("thead", {}, h("tr", {}, m.columns.map((c) => h("th", { text: c })))),
              h("tbody", {}, m.rows.slice(0, 50).map((r) => h("tr", {}, m.columns.map((c) => h("td", { text: String(r[c] ?? "") }))))))))
      : null;
    return h("div", { class: "msg msg-bot" },
      h("div", { text: m.text }),
      data,
      canSpeak ? h("div", { class: "msg-tools" }, h("button", { type: "button", onclick: () => speak(m.text), text: "Écouter" })) : null);
  }));
  $("thread").scrollTop = $("thread").scrollHeight;
}
async function ask(question, viaVoice = false) {
  question = question.trim();
  if (!question) return;
  $("question").value = "";
  state.thread.push({ role: "user", text: question }, { role: "bot", pending: true });
  renderThread();
  try {
    const a = await call("POST", "/api/ask", { question });
    state.thread[state.thread.length - 1] = { role: "bot", text: a.answer, sql: a.sql, columns: a.columns, rows: a.rows };
    if (viaVoice || state.speakAnswers) speak(a.answer);
  } catch (err) {
    state.thread[state.thread.length - 1] = { role: "bot", text: `Désolé : ${err.message}` };
  }
  renderThread();
}
let askRecognition = null;
function toggleDictation() {
  const mic = $("mic");
  if (askRecognition) return askRecognition.stop();
  mic.classList.add("listening");
  mic.setAttribute("aria-label", "Arrêter la dictée");
  $("question").placeholder = "Je vous écoute…";
  askRecognition = listen({
    onText: (t) => ($("question").value = t),
    onDone: (t) => {
      askRecognition = null;
      mic.classList.remove("listening");
      mic.setAttribute("aria-label", "Dicter la question");
      $("question").placeholder = "Posez une question, ou dictez-la";
      if (t) ask(t, true);
    },
    onError: (m) => toast(m),
  });
}

// ---------- Start ----------
async function start() {
  try {
    if (MODE === "local") {
      const { boot } = await import("./app/web/local.js");
      state.api = await boot();
    } else {
      state.api = async (method, path, body) => {
        const res = await fetch(path, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
        return { status: res.status, body: await res.json() };
      };
    }
    const [info, chefs] = await Promise.all([call("GET", "/api/info"), call("GET", "/api/chefs")]);
    $("mode").textContent = info.mode;
    state.chefs = chefs;
    state.chef = chefs[6]?.telephone ?? chefs[0].telephone;
  } catch (err) {
    $("booting").replaceChildren(h("p", { text: `La démonstration n'a pas pu démarrer : ${err.message}. Vérifiez votre connexion (SQLite se charge depuis cdnjs) puis rechargez la page.` }));
    return;
  }

  $("chef").replaceChildren(...state.chefs.map((c) => h("option", { value: c.telephone, text: `${c.village} · ${c.telephone.slice(0, 4)} •• ${c.telephone.slice(-2)}` })));
  $("chef").value = state.chef;
  $("chef").onchange = async (e) => {
    state.chef = e.target.value;
    Object.assign(state.phone, { screen: null, running: false, dialing: "", ussdDraft: "", smsDraft: "" });
    state.simple = { view: "home", compose: "" };
    await phoneCall("inbox");
    renderPhone();
  };
  const setDevice = (d) => {
    state.device = d;
    try { localStorage.setItem("ndiedieng.device", d); } catch {}
    for (const b of document.querySelectorAll("#devices button")) b.setAttribute("aria-checked", String(b.dataset.device === d));
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

  for (const b of document.querySelectorAll(".kpi")) {
    b.onclick = () => {
      const f = b.dataset.filter;
      if (f === "urgent") { state.filter.urgent = !state.filter.urgent; state.filter.statut = ""; }
      else { state.filter.statut = state.filter.statut === f && !state.filter.urgent ? "" : f; state.filter.urgent = false; }
      refreshReports();
    };
  }
  $("q").oninput = (e) => { state.filter.q = e.target.value.trim(); renderReports(); };
  $("categorie").onchange = (e) => { state.filter.categorie = e.target.value; refreshReports(); };
  $("clear").onclick = () => { state.filter = { statut: "", urgent: false, categorie: "", q: "" }; $("q").value = ""; $("categorie").value = ""; refreshReports(); };

  state.thread.push({ role: "bot", text: "Bonjour. Je réponds à partir des fiches de la commune et des signalements reçus, et je montre toujours les données utilisées. Posez une question, ou dictez-la avec le micro." });
  renderThread();
  const examples = ["Quels forages sont en panne ?", "Quels villages ont le plus de pannes ?", "Combien de naissances ce mois-ci ?", "Quels signalements urgents sont en attente ?", "Combien de fiches sont à mettre à jour ?"];
  $("chips").replaceChildren(...examples.map((q) => h("button", { type: "button", onclick: () => ask(q), text: q })));
  $("ask-form").onsubmit = (e) => { e.preventDefault(); ask($("question").value); };
  const mic = $("mic");
  if (!canListen) { mic.disabled = true; mic.title = "La dictée n'est pas disponible dans ce navigateur (essayez Chrome ou Safari)."; }
  mic.onclick = toggleDictation;
  const speakBtn = $("speak");
  if (!canSpeak) speakBtn.hidden = true;
  speakBtn.onclick = () => {
    state.speakAnswers = !state.speakAnswers;
    speakBtn.setAttribute("aria-pressed", String(state.speakAnswers));
    if (!state.speakAnswers && canSpeak) speechSynthesis.cancel();
  };

  $("booting").hidden = true;
  $("app").hidden = false;
  setDevice(state.device);
  await phoneCall("inbox");
  renderPhone();
  await refreshReports();
  setInterval(() => refreshReports({ background: true }), MODE === "local" ? 5000 : 4000);
  setInterval(() => { if (!document.activeElement?.closest?.(".device")) renderPhone(); }, 30000);
}
start();
