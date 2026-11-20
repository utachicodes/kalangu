// The assistant's page: touch the orb and speak, as with a voice assistant,
// and the answer is read aloud; or type the question with the keyboard
// button, and the answer is written. Either way it shows the data used, and
// "Écouter" reads any answer. Every value from the API reaches the
// page through textContent, never as HTML (see common.js).

import { $, h, icon, toast, announce, connect, call, canListen, canSpeak, listenUnavailable, listen, speak, stopSpeaking,
  naturalVoiceAvailable, unlockVoice, speakNatural, stopNatural } from "./common.js";

const IDEAS = ["Quels forages sont en panne ?", "Quels villages ont le plus de pannes ?", "Quels signalements urgents sont en attente ?", "Combien de naissances ce mois-ci ?"];

const state = { thread: [], busy: false, speaking: null, orb: "idle", natural: false };

// ---------- The orb: one control, four states ----------
let speakingWobble = 0;
function setOrb(next, line = null, heard = false, { realLevel = false } = {}) {
  state.orb = next;
  const orb = $("orb");
  orb.dataset.state = next;
  orb.setAttribute("aria-label", next === "listening" ? "Arrêter et envoyer" : next === "speaking" ? "Arrêter la lecture" : next === "thinking" ? "L'assistant réfléchit" : "Parler à l'assistant");
  $("aurora").classList.toggle("on", next === "listening" || next === "speaking");
  cancelAnimationFrame(speakingWobble);
  if (next === "speaking" && !realLevel) {
    // No level comes from the browser's speech synthesis: a gentle pulse stands in for it.
    const t0 = performance.now();
    const tick = (t) => {
      const v = 0.25 + 0.25 * Math.abs(Math.sin((t - t0) / 180)) * (0.6 + 0.4 * Math.sin((t - t0) / 530));
      level(v);
      speakingWobble = requestAnimationFrame(tick);
    };
    speakingWobble = requestAnimationFrame(tick);
  } else if (next !== "listening" && next !== "speaking") level(0);
  const live = $("live");
  live.textContent = line ?? (next === "idle" ? (state.thread.length ? "Touchez l'orbe pour une autre question." : canListen ? "Touchez l'orbe et parlez." : "Écrivez votre question avec le clavier.") : "");
  live.classList.toggle("heard", heard);
}
function level(v) {
  $("orb").style.setProperty("--level", v.toFixed(3));
  $("aurora").style.setProperty("--level", v.toFixed(3));
}

let dictation = null;
function onOrb() {
  if (state.orb === "listening") return dictation?.stop();
  if (state.orb === "speaking") return quiet();
  if (state.orb === "thinking") return;
  if (state.natural) unlockVoice(); // inside the tap, so the answer can be heard
  if (!canListen) {
    toast(listenUnavailable);
    return showKeyboard(true);
  }
  quiet();
  setOrb("listening", "Je vous écoute…");
  dictation = listen({
    onText: (t) => setOrb("listening", t || "Je vous écoute…", Boolean(t)),
    onLevel: level,
    onDone: (t) => {
      dictation = null;
      if (t) ask(t, { spoken: true });
      else setOrb("idle");
    },
    onError: (m) => toast(m),
  });
}

// ---------- Conversation ----------
function used(m) {
  if (!m.sql) return null;
  const n = m.rows.length;
  return h("details", { class: "used" },
    h("summary", {}, h("span", { class: "spark", "aria-hidden": "true", style: "width:16px;height:16px" }), `Données utilisées · ${n} ligne${n > 1 ? "s" : ""}`),
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
  const reading = state.speaking === i;
  return h("div", { class: "turn-bot" },
    h("span", { class: "spark", "aria-hidden": "true" }),
    h("div", {},
      h("div", { class: "answer" }, m.text.split(/\n+/).map((p) => h("p", { text: p }))),
      m.suggestions?.length ? h("div", { class: "suggest" }, m.suggestions.map((q) => h("button", { type: "button", class: "chip-q", onclick: () => ask(q), text: q }))) : null,
      used(m),
      h("div", { class: "tools" },
        canSpeak
          ? h("button", { type: "button", "aria-pressed": String(reading), onclick: () => {
            if (reading) return quiet();
            if (state.natural) unlockVoice();
            say(m, i);
          } }, icon(reading ? "stop" : "speaker"), reading ? "Arrêter" : "Écouter")
          : null,
        h("button", {
          type: "button",
          onclick: async () => {
            try { await navigator.clipboard.writeText(m.text); toast("Réponse copiée."); } catch { toast("La copie n'est pas permise ici."); }
          },
        }, icon("copy"), "Copier"))));
}
function render() {
  const fresh = state.thread.length === 0;
  document.body.classList.toggle("fresh", fresh);
  $("hello").hidden = !fresh;
  $("restart").hidden = fresh;
  $("thread").replaceChildren(...state.thread.map((m, i) => (m.role === "user" ? h("div", { class: "turn-user", text: m.text }) : botTurn(m, i))));
  if (!fresh) requestAnimationFrame(() => ($("scroller").scrollTop = $("scroller").scrollHeight));
}
/** What is read aloud: the answer, and the questions offered if there are some. */
const spoken = (m) => (m.suggestions?.length ? `${m.text} ${m.suggestions.slice(0, 2).join(" Ou : ")}` : m.text);
function say(m, i) {
  const ended = () => {
    if (state.speaking !== i) return;
    state.speaking = null;
    setOrb("idle");
    render();
  };
  const browserVoice = () =>
    speak(spoken(m), { onStart: () => state.speaking === i && setOrb("speaking"), onEnd: ended });
  state.speaking = i;
  render();
  if (!state.natural) {
    setOrb("speaking");
    return browserVoice();
  }
  // Gemini's voice, with the orb following it; the browser's if it fails.
  setOrb("thinking", "Je prépare la réponse vocale…");
  speakNatural(spoken(m), {
    onStart: () => state.speaking === i && setOrb("speaking", null, false, { realLevel: true }),
    onEnd: ended,
    onLevel: (v) => state.speaking === i && level(v),
  }).catch(() => {
    if (state.speaking !== i) return;
    setOrb("speaking");
    browserVoice();
  });
}
function quiet() {
  stopSpeaking();
  stopNatural();
  if (state.speaking !== null) {
    state.speaking = null;
    render();
  }
  if (state.orb === "speaking" || (state.orb === "thinking" && !state.busy)) setOrb("idle");
}

/** A spoken question gets a spoken answer; a typed or tapped one, a written one. */
async function ask(question, { spoken = false } = {}) {
  question = question.trim();
  if (!question || state.busy) return;
  state.busy = true;
  quiet();
  $("question").value = "";
  syncPrompt();
  state.thread.push({ role: "user", text: question }, { role: "bot", pending: true });
  render();
  setOrb("thinking", "Je cherche dans les fiches…");
  let answer;
  try {
    const a = await call("POST", "/api/ask", { question });
    answer = { role: "bot", text: a.answer, sql: a.sql, columns: a.columns ?? [], rows: a.rows ?? [], suggestions: a.suggestions ?? [] };
  } catch (err) {
    answer = { role: "bot", text: `Désolé, je n'ai pas pu répondre : ${err.message}` };
  } finally {
    state.busy = false;
  }
  state.thread[state.thread.length - 1] = answer;
  const i = state.thread.length - 1;
  render();
  announce(answer.text);
  if (spoken && (state.natural || canSpeak)) say(answer, i);
  else setOrb("idle");
}

// ---------- Writing instead ----------
function syncPrompt() {
  const q = $("question");
  q.style.height = "auto";
  q.style.height = `${Math.min(q.scrollHeight, 160)}px`;
  $("send").disabled = !q.value.trim();
}
function showKeyboard(on) {
  $("ask-form").hidden = !on;
  $("keyboard").setAttribute("aria-pressed", String(on));
  if (on) $("question").focus();
}

// ---------- Start ----------
async function start() {
  $("ideas").replaceChildren(...IDEAS.map((q) => h("button", { type: "button", class: "chip-q", onclick: () => ask(q), text: q })));
  render();
  setOrb("idle");
  $("orb").onclick = onOrb;
  $("keyboard").onclick = () => showKeyboard($("ask-form").hidden);
  const q = $("question");
  q.addEventListener("input", syncPrompt);
  q.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); ask(q.value); }
    if (e.key === "Escape") showKeyboard(false);
  });
  $("ask-form").onsubmit = (e) => { e.preventDefault(); ask(q.value); };
  syncPrompt();
  $("restart").onclick = () => { quiet(); state.thread = []; render(); setOrb("idle"); };
  // Space or Enter on the page, outside a field, works the orb.
  document.addEventListener("keydown", (e) => {
    if (e.target === document.body && (e.key === " " || e.key === "Enter")) { e.preventDefault(); onOrb(); }
  });
  try {
    const [, natural] = await Promise.all([connect(), naturalVoiceAvailable()]);
    state.natural = natural;
  } catch (err) {
    $("booting").replaceChildren(h("p", { text: `L'assistant n'a pas pu démarrer : ${err.message}. Vérifiez votre connexion puis rechargez la page.` }));
    return;
  }
  try {
    const info = await call("GET", "/api/info");
    if (/gemini/i.test(info.mode)) $("fine").textContent = "Avec Gemini. Répond à partir des fiches (fictives) de la commune et des signalements, et montre les données utilisées.";
  } catch {}
  $("booting").hidden = true;
  if (!canListen) showKeyboard(true);
}
start();
