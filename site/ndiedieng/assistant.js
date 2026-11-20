// The assistant's page: questions in writing or by voice, answers from the
// commune's records with the data used. Every value from the API reaches the
// page through textContent, never as HTML (see common.js).

import { $, h, icon, toast, announce, connect, call, canListen, canSpeak, listenUnavailable, listen, speak, stopSpeaking } from "./common.js";

const IDEAS = [
  ["Quels forages sont en panne ?", "eau"],
  ["Quels villages ont le plus de pannes ?", "chart"],
  ["Quels signalements urgents sont en attente ?", "alert"],
  ["Combien de naissances ce mois-ci ?", "baby"],
];
const IDEA_ICONS = {
  eau: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/></svg>',
  chart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
  alert: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2 20h20zM12 10v4M12 17v.5"/></svg>',
  baby: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M5 21a7 7 0 0 1 14 0"/></svg>',
};
const ideaIcon = (name) => {
  const s = document.createElement("span");
  s.className = "ico";
  s.innerHTML = IDEA_ICONS[name]; // constant markup, never data
  return s;
};

const state = { thread: [], speakAnswers: false, busy: false, speaking: null };
try {
  state.speakAnswers = localStorage.getItem("ndiedieng.speak") === "1";
} catch {}

// ---------- Conversation ----------
function used(m) {
  if (!m.sql) return null;
  const n = m.rows.length;
  return h("details", { class: "used" },
    h("summary", {},
      h("span", { class: "spark", "aria-hidden": "true", style: "width:16px;height:16px" }),
      `Données utilisées · ${n} ligne${n > 1 ? "s" : ""}`),
    h("pre", { text: m.sql }),
    n
      ? h("div", { class: "data" },
          h("table", {},
            h("thead", {}, h("tr", {}, m.columns.map((c) => h("th", { scope: "col", text: c })))),
            h("tbody", {}, m.rows.slice(0, 100).map((r) => h("tr", {}, m.columns.map((c) => h("td", { text: String(r[c] ?? "") })))))),
          n > 100 ? h("p", { class: "more", text: `100 premières lignes sur ${n}.` }) : null)
      : null);
}
function botTurn(m, i) {
  if (m.pending) {
    return h("div", { class: "turn-bot", "aria-label": "L'assistant cherche dans les fiches" },
      h("span", { class: "spark thinking", "aria-hidden": "true" }),
      h("div", { class: "shimmer" }, h("i"), h("i"), h("i")));
  }
  const listening = state.speaking === i;
  return h("div", { class: "turn-bot" },
    h("span", { class: "spark", "aria-hidden": "true" }),
    h("div", {},
      h("div", { class: "answer" }, m.text.split(/\n+/).map((p) => h("p", { text: p }))),
      used(m),
      h("div", { class: "tools" },
        canSpeak
          ? h("button", { type: "button", "aria-pressed": String(listening), onclick: () => (listening ? quiet() : say(m.text, i)) },
              icon(listening ? "stop" : "speaker"), listening ? "Arrêter" : "Écouter")
          : null,
        h("button", {
          type: "button",
          onclick: async () => {
            try { await navigator.clipboard.writeText(m.text); toast("Réponse copiée."); } catch { toast("La copie n'est pas permise ici."); }
          },
        }, icon("copy"), "Copier"))));
}
function render() {
  const empty = state.thread.length === 0;
  $("hello").hidden = !empty;
  $("restart").hidden = empty;
  $("thread").replaceChildren(...state.thread.map((m, i) => (m.role === "user" ? h("div", { class: "turn-user", text: m.text }) : botTurn(m, i))));
  if (!empty) requestAnimationFrame(() => ($("scroller").scrollTop = $("scroller").scrollHeight));
}
function say(text, i) {
  speak(text, {
    onStart: () => { state.speaking = i; render(); },
    onEnd: () => { if (state.speaking === i) { state.speaking = null; render(); } },
  });
  state.speaking = i;
  render();
}
function quiet() {
  stopSpeaking();
  state.speaking = null;
  render();
}

async function ask(question, viaVoice = false) {
  question = question.trim();
  if (!question || state.busy) return;
  state.busy = true;
  quiet();
  $("question").value = "";
  syncPrompt();
  state.thread.push({ role: "user", text: question }, { role: "bot", pending: true });
  render();
  try {
    const a = await call("POST", "/api/ask", { question });
    state.thread[state.thread.length - 1] = { role: "bot", text: a.answer, sql: a.sql, columns: a.columns ?? [], rows: a.rows ?? [] };
    announce(a.answer);
    if (viaVoice || state.speakAnswers) say(a.answer, state.thread.length - 1);
  } catch (err) {
    state.thread[state.thread.length - 1] = { role: "bot", text: `Désolé, je n'ai pas pu répondre : ${err.message}` };
  } finally {
    state.busy = false;
  }
  render();
  $("question").focus({ preventScroll: true });
}

// ---------- Prompt ----------
function syncPrompt() {
  const q = $("question");
  q.style.height = "auto";
  q.style.height = `${Math.min(q.scrollHeight, 160)}px`;
  $("send").hidden = !q.value.trim() || Boolean(dictation);
}

let dictation = null;
function setListening(on) {
  $("ask-form").classList.toggle("listening", on);
  $("aurora").classList.toggle("on", on);
  $("bars").hidden = !on;
  const mic = $("mic");
  mic.classList.toggle("on", on);
  mic.replaceChildren(icon(on ? "stop" : "mic"));
  mic.setAttribute("aria-label", on ? "Arrêter la dictée" : "Dicter la question");
  $("question").placeholder = on ? "Je vous écoute…" : "Demandez à l'assistant";
  if (!on) document.documentElement.style.setProperty("--level", "0");
  syncPrompt();
}
function toggleDictation() {
  if (dictation) return dictation.stop();
  if (!canListen) return toast(listenUnavailable);
  quiet();
  const levels = Array(14).fill(0);
  $("bars").replaceChildren(...levels.map(() => h("i")));
  const bars = [...$("bars").children];
  dictation = listen({
    onText: (t) => { $("question").value = t; syncPrompt(); },
    onLevel: (v) => {
      levels.push(v);
      levels.shift();
      $("aurora").style.setProperty("--level", v.toFixed(3));
      // Mirrored, loudest in the middle, as a voice looks.
      bars.forEach((b, i) => {
        const k = levels[Math.abs(levels.length - 1 - Math.abs(2 * i - (bars.length - 1)))] ?? 0;
        b.style.height = `${6 + k * 24}px`;
      });
    },
    onDone: (t) => {
      dictation = null;
      setListening(false);
      if (t) ask(t, true);
    },
    onError: (m) => toast(m),
  });
  if (dictation) setListening(true);
}

// ---------- Start ----------
async function start() {
  $("ideas").replaceChildren(...IDEAS.map(([q, ic]) => h("button", { type: "button", class: "idea", onclick: () => ask(q) }, h("span", { text: q }), ideaIcon(ic))));
  render();
  const q = $("question");
  q.addEventListener("input", syncPrompt);
  q.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); ask(q.value); }
  });
  $("ask-form").onsubmit = (e) => { e.preventDefault(); ask(q.value); };
  $("mic").onclick = toggleDictation;
  if (!canListen) $("mic").title = listenUnavailable;
  $("restart").onclick = () => { quiet(); state.thread = []; render(); q.focus(); };
  const speakBtn = $("speak");
  speakBtn.hidden = !canSpeak;
  speakBtn.setAttribute("aria-pressed", String(state.speakAnswers));
  speakBtn.onclick = () => {
    state.speakAnswers = !state.speakAnswers;
    speakBtn.setAttribute("aria-pressed", String(state.speakAnswers));
    try { localStorage.setItem("ndiedieng.speak", state.speakAnswers ? "1" : "0"); } catch {}
    if (!state.speakAnswers) quiet();
  };
  try {
    await connect();
  } catch (err) {
    $("booting").replaceChildren(h("p", { text: `L'assistant n'a pas pu démarrer : ${err.message}. Vérifiez votre connexion puis rechargez la page.` }));
    return;
  }
  $("booting").hidden = true;
  q.focus({ preventScroll: true });
}
start();
