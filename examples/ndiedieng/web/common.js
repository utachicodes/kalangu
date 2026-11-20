// Shared by the dashboard (ui.js) and the assistant's page (assistant.js):
// small DOM helpers, the connection to the prototype's API, and voice.
// Every value from the API reaches the page through textContent, never as
// HTML; only the constant icons below are parsed as markup.

export const MODE = document.querySelector('meta[name="ndiedieng-mode"]')?.getAttribute("content") ?? "server";
export const CODE = "*123#";

// ---------- DOM ----------
export const $ = (id) => document.getElementById(id);
export function h(tag, props = {}, ...children) {
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
  stop: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2"/></svg>',
  erase: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5h11v14H9l-6-7z"/><path d="m12 9 5 6m0-6-5 6"/></svg>',
  ussd: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h10"/></svg>',
  sms: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z"/></svg>',
  vocal: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
  mairie: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 10h18M5 10v8M9 10v8M15 10v8M19 10v8M3 20h18M12 3l9 5H3z"/></svg>',
  speaker: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/></svg>',
  copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/></svg>',
  spark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2c.6 5.4 4.6 9.4 10 10-5.4.6-9.4 4.6-10 10-.6-5.4-4.6-9.4-10-10 5.4-.6 9.4-4.6 10-10z"/></svg>',
  signal: '<svg viewBox="0 0 18 12" aria-hidden="true"><rect x="0" y="8" width="3" height="4" rx="1" fill="currentColor"/><rect x="5" y="5" width="3" height="7" rx="1" fill="currentColor"/><rect x="10" y="2.5" width="3" height="9.5" rx="1" fill="currentColor"/><rect x="15" y="0" width="3" height="12" rx="1" fill="currentColor" opacity=".35"/></svg>',
  battery: '<svg viewBox="0 0 26 12" aria-hidden="true"><rect x=".5" y=".5" width="22" height="11" rx="3" fill="none" stroke="currentColor" opacity=".5"/><rect x="2" y="2" width="15" height="8" rx="1.6" fill="currentColor"/><rect x="23.5" y="4" width="2" height="4" rx="1" fill="currentColor" opacity=".5"/></svg>',
};
export function icon(name) {
  const span = document.createElement("span");
  span.innerHTML = ICONS[name]; // constant markup, never data
  return span.firstElementChild;
}

/** A short message at the bottom; with `action`, a button in it (such as Undo) and a longer stay. */
export function toast(text, { action = null, duration = action ? 8000 : 5000 } = {}) {
  const t = $("toast");
  const button = action
    ? h("button", {
        type: "button", class: "toast-action",
        onclick: () => { t.hidden = true; clearTimeout(toast.timer); action.run(); },
      }, action.label)
    : null;
  t.replaceChildren(...[h("span", { text }), button].filter(Boolean));
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), duration);
  if (button && document.activeElement === document.body) button.focus({ preventScroll: true });
}
export const announce = (text) => {
  $("announce").textContent = "";
  setTimeout(() => ($("announce").textContent = text), 50);
};

// ---------- Words the pages share ----------
export const LABEL = { eau: "Eau", sante: "Santé", ecole: "École", energie: "Énergie", piste: "Piste", naissance: "Naissance", deces: "Décès", autre: "Autre" };
export const STATUT = { nouveau: "Nouveau", a_verifier: "À vérifier", en_cours: "En cours", resolu: "Résolu" };
export const URGENCE = { haute: "Haute", moyenne: "Moyenne", basse: "Basse" };
export const CANAL = { ussd: "USSD", sms: "SMS", vocal: "Vocal", mairie: "Mairie" };
const rtf = new Intl.RelativeTimeFormat("fr", { numeric: "auto" });
export function ago(iso) {
  let v = (new Date(iso).getTime() - Date.now()) / 1000;
  for (const [n, unit] of [[60, "second"], [60, "minute"], [24, "hour"], [7, "day"], [4.35, "week"], [12, "month"], [Infinity, "year"]]) {
    if (Math.abs(v) < n) return rtf.format(Math.round(v), unit);
    v /= n;
  }
  return "";
}
export const fullDate = (iso) => new Date(iso).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" });

// ---------- The API: in this browser, or over HTTP to server.ts ----------
let api = null;
let localModule = null;
export async function connect() {
  if (MODE === "local") {
    localModule = await import("./app/web/local.js");
    const booted = await localModule.boot();
    api = booted.api;
    return { restored: booted.restored };
  }
  api = async (method, path, body) => {
    const res = await fetch(path, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json() };
  };
  return { restored: false };
}
export async function call(method, path, body) {
  const res = await api(method, path, body);
  if (res.status >= 400) throw new Error(res.body?.error || `Erreur ${res.status}`);
  return res.body;
}
/** Starts the in-browser demo over; false when there is nothing to reset (server mode). */
export async function resetDemo() {
  if (!localModule) return false;
  await localModule.reset();
  return true;
}

// ---------- Voice ----------
// Dictation is the browser's own speech recognition (Chrome, Edge, Safari).
// It starts first, inside the click, as Safari requires; the microphone's
// level for the animation is read after, and the animation falls back to
// the recognition's own events if the level cannot be read.
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
export const canListen = Boolean(Recognition) && window.isSecureContext;
export const canSpeak = "speechSynthesis" in window;
export const listenUnavailable = !window.isSecureContext
  ? "La dictée demande une page sécurisée (https)."
  : "La dictée n'est pas disponible dans ce navigateur. Essayez Chrome, Edge ou Safari.";

const ERRORS = {
  "not-allowed": "Le micro est bloqué pour ce site. Autorisez-le dans la barre d'adresse, puis réessayez.",
  "service-not-allowed": "Ce navigateur refuse la dictée sur ce site. Essayez Chrome, Edge ou Safari.",
  "audio-capture": "Aucun micro n'a été trouvé.",
  "no-speech": "Je n'ai rien entendu. Touchez le micro et parlez.",
  network: "La dictée de ce navigateur a besoin d'internet, ou n'y est pas proposée (Brave, Arc, Opera…). Essayez Chrome, Edge ou Safari.",
  "language-not-supported": "Ce navigateur ne sait pas dicter en français.",
  silent: "La dictée ne démarre pas dans ce navigateur (Brave, Arc et d'autres l'affichent sans la faire marcher). Essayez Chrome, Edge ou Safari.",
};
// The browser must start within this time, and a dictation never runs longer.
const START_TIMEOUT = 5000;
const MAX_LISTEN = 45000;

/**
 * Listens once. onText gets the transcript as it grows, onLevel a 0..1
 * volume about 30 times a second, onDone the final text ("" when nothing
 * was heard or on error), onError a sentence for the user.
 */
export function listen({ onText, onLevel, onDone, onError }) {
  const r = new Recognition();
  r.lang = "fr-FR";
  r.interimResults = true;
  r.continuous = false;
  r.maxAlternatives = 1;
  let finalText = "";
  let interim = "";
  let ended = false;
  let stream = null;
  let ctx = null;
  let raf = 0;
  let fakeLevel = 0;
  let speaking = false;
  let failed = false;

  const meter = async () => {
    // The level for the animation; dictation works without it.
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      if (ended) return cleanup();
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.6;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (const v of data) sum += ((v - 128) / 128) ** 2;
        onLevel?.(Math.min(1, Math.sqrt(sum / data.length) * 4.5));
        raf = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      // No level: the animation follows the recognition's own events.
      const tick = () => {
        fakeLevel = speaking ? 0.35 + Math.random() * 0.45 : fakeLevel * 0.85;
        onLevel?.(fakeLevel);
        raf = requestAnimationFrame(tick);
      };
      tick();
    }
  };
  const cleanup = () => {
    cancelAnimationFrame(raf);
    stream?.getTracks().forEach((t) => t.stop());
    ctx?.close().catch(() => {});
    stream = null;
    ctx = null;
  };

  let started = false;
  const watchdog = setTimeout(() => {
    if (started || ended) return;
    failed = true;
    onError?.(ERRORS.silent);
    r.abort();
    finish(); // some browsers do not even end
  }, START_TIMEOUT);
  const cap = setTimeout(() => r.stop(), MAX_LISTEN);
  r.onaudiostart = () => {
    started = true;
    meter();
  };
  r.onspeechstart = () => (speaking = true);
  r.onspeechend = () => (speaking = false);
  r.onresult = (e) => {
    interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) finalText += e.results[i][0].transcript;
      else interim += e.results[i][0].transcript;
    }
    speaking = true;
    onText?.((finalText + interim).trim());
  };
  r.onerror = (e) => {
    if (e.error === "aborted") return;
    failed = true;
    onError?.(ERRORS[e.error] ?? `La dictée a échoué (${e.error}).`);
  };
  const finish = () => {
    if (ended) return;
    ended = true;
    clearTimeout(watchdog);
    clearTimeout(cap);
    cleanup();
    // Some browsers end with only an interim result: keep what was said.
    onDone(failed ? "" : (finalText || interim).trim());
  };
  r.onend = finish;
  try {
    r.start();
  } catch {
    failed = true;
    onError?.(ERRORS["service-not-allowed"]);
    finish();
  }
  return {
    stop: () => (started ? r.stop() : (r.abort(), finish())),
    cancel: () => {
      failed = true;
      r.abort();
      finish();
    },
  };
}

// Reading aloud: a French voice once the browser has listed them; long
// answers are read sentence by sentence (Chrome stops long utterances).
let frVoice = null;
const pickVoice = () => {
  const voices = (canSpeak ? speechSynthesis.getVoices() : []).filter((v) => v.lang?.toLowerCase().replace("_", "-").startsWith("fr"));
  // The most natural French voice the system has: neural and premium ones first, France before others.
  const score = (v) =>
    (/natural|neural|online|premium|enhanced|google/i.test(v.name) ? 4 : 0) +
    (/^fr-fr$/i.test(v.lang.replace("_", "-")) ? 2 : 0) +
    (/amélie|amelie|audrey|denise|vivienne|thomas|google français/i.test(v.name) ? 1 : 0) +
    (v.localService ? 0 : 1);
  frVoice = voices.sort((a, b) => score(b) - score(a))[0] ?? null;
};
if (canSpeak) {
  pickVoice();
  speechSynthesis.addEventListener?.("voiceschanged", pickVoice);
}
export function speak(text, { onStart, onEnd } = {}) {
  if (!canSpeak) return;
  speechSynthesis.cancel();
  const parts = text.match(/[^.!?;:\n]+[.!?;:]*\s*/g) ?? [text];
  parts.forEach((part, i) => {
    const u = new SpeechSynthesisUtterance(part.trim());
    u.lang = "fr-FR";
    if (frVoice) u.voice = frVoice;
    u.rate = 0.98;
    u.pitch = 1;
    if (i === 0) u.onstart = () => onStart?.();
    if (i === parts.length - 1) {
      u.onend = () => onEnd?.();
      u.onerror = () => onEnd?.();
    }
    speechSynthesis.speak(u);
  });
}
export const stopSpeaking = () => canSpeak && speechSynthesis.cancel();

// ---------- A natural voice: Gemini's speech model, through the website's function ----------
// Used when the function is there (it holds the key); the browser's voice
// otherwise, or whenever it fails. The player is unlocked inside the tap,
// since phones refuse sound that starts later without one.
const SPEECH_URL = "/api/ndiedieng/gemini";
const SILENCE = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=";
let player = null;
let playerCtx = null;
let playerAnalyser = null;
let playing = null; // { url, raf, done }

/** Whether this site can read answers with Gemini's voice. */
export async function naturalVoiceAvailable() {
  if (MODE !== "local") return false;
  try {
    const res = await fetch(SPEECH_URL, { signal: AbortSignal.timeout(2500) });
    const body = await res.json();
    return res.ok && body.speech === true;
  } catch {
    return false;
  }
}

/** Call inside a tap or click, before any natural speech that follows it. */
export function unlockVoice() {
  try {
    player ??= Object.assign(new Audio(), { playsInline: true, preload: "auto" });
    playerCtx ??= new (window.AudioContext || window.webkitAudioContext)();
    // Routed through the analyser only once the context runs: a suspended
    // context would silence the voice, so without it the voice plays as is.
    playerCtx.resume().then(() => {
      if (playerAnalyser || playerCtx.state !== "running") return;
      const analyser = playerCtx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.7;
      playerCtx.createMediaElementSource(player).connect(analyser);
      analyser.connect(playerCtx.destination);
      playerAnalyser = analyser;
    }).catch(() => {});
    if (!playing) {
      player.src = SILENCE;
      player.play().catch(() => {});
    }
  } catch {
    // no Web Audio: the natural voice still plays, without its level
  }
}

/** The answer in short pieces, sentence by sentence, so the first can play while the next is prepared. */
function speechChunks(text) {
  // Two pieces at most: a short first sentence, so the voice starts soon, and
  // the rest in one go. Every piece is a request, and speech has a tight quota.
  const sentences = text.match(/[^.!?;:]+[.!?;:]*\s*/g) ?? [text];
  const first = sentences.shift().trim();
  const rest = sentences.join("").trim();
  return rest ? [first, rest] : [first];
}

async function fetchSpeech(text, langue = "fr") {
  const res = await fetch(SPEECH_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ task: "speak", text: text.slice(0, 700), langue }),
    signal: AbortSignal.timeout(25_000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.result?.data) throw new Error(body.error ?? `speech ${res.status}`);
  const bytes = Uint8Array.from(atob(body.result.data), (c) => c.charCodeAt(0));
  return URL.createObjectURL(new Blob([bytes], { type: body.result.mimeType || "audio/wav" }));
}

/**
 * Reads `text` with Gemini's voice, piece by piece: the first sentence plays
 * as soon as it is ready while the next is fetched. Resolves once it starts
 * (or throws, so the caller can use the browser's voice); onLevel gets 0..1.
 */
export async function speakNatural(text, { onStart, onEnd, onLevel, langue = "fr" } = {}) {
  stopNatural();
  const chunks = speechChunks(text);
  const current = { raf: 0, done: false, urls: [] };
  playing = current;
  const pending = chunks.map(() => null);
  const get = (i) => (pending[i] ??= fetchSpeech(chunks[i], langue).then((url) => (current.urls.push(url), url)));
  const finish = () => {
    if (current.done) return;
    current.done = true;
    cancelAnimationFrame(current.raf);
    current.urls.forEach((u) => URL.revokeObjectURL(u));
    if (playing === current) playing = null;
    onLevel?.(0);
    onEnd?.();
  };
  current.stop = finish;
  player ??= Object.assign(new Audio(), { playsInline: true });

  const first = await get(0); // throws: the caller falls back to the browser's voice
  if (current.done) return;
  if (chunks.length > 1) get(1).catch(() => {});
  const playAt = async (i, url) => {
    if (current.done) return;
    player.onended = async () => {
      if (current.done) return;
      if (i + 1 >= chunks.length) return finish();
      if (i + 2 < chunks.length) get(i + 2).catch(() => {});
      try {
        playAt(i + 1, await get(i + 1));
      } catch {
        // The rest failed (often the speech quota): the browser's voice finishes
        // it in French; Wolof, which browsers don't speak, stops cleanly.
        if (langue !== "fr" || !canSpeak) return finish();
        cancelAnimationFrame(current.raf);
        speak(chunks.slice(i + 1).join(" "), { onEnd: finish });
      }
    };
    player.onerror = finish;
    player.src = url;
    await player.play();
  };
  await playAt(0, first);
  onStart?.();
  if (onLevel && !playerAnalyser) {
    // No level to read: a gentle pulse while it speaks.
    const t0 = performance.now();
    const tick = (t) => {
      onLevel(0.25 + 0.3 * Math.abs(Math.sin((t - t0) / 170)) * (0.6 + 0.4 * Math.sin((t - t0) / 520)));
      current.raf = requestAnimationFrame(tick);
    };
    current.raf = requestAnimationFrame(tick);
  } else if (playerAnalyser && onLevel) {
    const data = new Uint8Array(playerAnalyser.fftSize);
    const tick = () => {
      playerAnalyser.getByteTimeDomainData(data);
      let sum = 0;
      for (const v of data) sum += ((v - 128) / 128) ** 2;
      onLevel(Math.min(1, Math.sqrt(sum / data.length) * 2.2));
      current.raf = requestAnimationFrame(tick);
    };
    tick();
  }
}

export function stopNatural() {
  if (!playing) return;
  const p = playing;
  player?.pause();
  p.stop?.();
}

// ---------- Listening through Gemini: record, then transcribe ----------
// Browsers' own dictation is missing or silent in many of them (Firefox,
// Brave, Arc…) and knows no Wolof. When the website's function is there,
// the page records the question itself and Gemini writes it down.

/**
 * Records one question. Stops by itself after a pause once speech was heard
 * (or after `maxMs`), or when `stop()` is called. onLevel gets 0..1 as you
 * speak; onDone gets a base64 WAV (16 kHz mono), or null when nothing was said.
 */
export async function recordQuestion({ onLevel, onSpeech, onDone, onError, maxMs = 30_000, silenceMs = 1500, waitMs = 8000 }) {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  } catch (err) {
    onError?.(err?.name === "NotAllowedError" ? ERRORS["not-allowed"] : ERRORS["audio-capture"]);
    onDone(null);
    return { stop() {} };
  }
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  await ctx.resume().catch(() => {});
  const source = ctx.createMediaStreamSource(stream);
  // ScriptProcessor is old but everywhere, Safari included; it hands us raw samples.
  const node = ctx.createScriptProcessor(4096, 1, 1);
  const chunks = [];
  const started = performance.now();
  let heard = false;
  let quietSince = 0;
  let finished = false;
  let level = 0;
  let raf = 0;
  // The room's own noise, from the first moments: speech is judged against it,
  // so a quiet voice in a quiet room counts, and a fan in a noisy one doesn't.
  let floor = 0;
  let floorSamples = 0;
  node.onaudioprocess = (e) => {
    const input = e.inputBuffer.getChannelData(0);
    chunks.push(new Float32Array(input));
    let sum = 0;
    for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
    const rms = Math.sqrt(sum / input.length);
    level = Math.min(1, rms * 6);
    const now = performance.now();
    if (now - started < 350) {
      floor = (floor * floorSamples + rms) / ++floorSamples;
      return;
    }
    const speaking = rms > Math.max(0.008, floor * 3);
    const quiet = rms < Math.max(0.005, floor * 1.8);
    if (speaking) {
      if (!heard) onSpeech?.();
      heard = true;
      quietSince = 0;
    } else if (heard && quiet) quietSince ||= now;
    if ((heard && quietSince && now - quietSince > silenceMs) || now - started > maxMs || (!heard && now - started > waitMs)) finish();
  };
  source.connect(node);
  node.connect(ctx.destination); // required for onaudioprocess to run; the output is silence
  const draw = () => { onLevel?.(level); raf = requestAnimationFrame(draw); };
  draw();

  function finish() {
    if (finished) return;
    finished = true;
    cancelAnimationFrame(raf);
    onLevel?.(0);
    node.disconnect();
    source.disconnect();
    stream.getTracks().forEach((t) => t.stop());
    const rate = ctx.sampleRate;
    ctx.close().catch(() => {});
    onDone(heard ? toWav(chunks, rate, 16000) : null);
  }
  return { stop: finish };
}

/** Float samples at `from` Hz, to a base64 16-bit mono WAV at `to` Hz. */
function toWav(chunks, from, to) {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const ratio = from / to;
  const n = Math.floor(total / ratio);
  const pcm = new DataView(new ArrayBuffer(44 + n * 2));
  const all = new Float32Array(total);
  let at = 0;
  for (const c of chunks) { all.set(c, at); at += c.length; }
  for (let i = 0; i < n; i++) {
    // Average the samples that fold into this one: a simple low-pass before downsampling.
    const a = Math.floor(i * ratio), b = Math.min(total, Math.floor((i + 1) * ratio));
    let s = 0;
    for (let j = a; j < b; j++) s += all[j];
    const v = Math.max(-1, Math.min(1, s / Math.max(1, b - a)));
    pcm.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true);
  }
  const str = (o, t) => { for (let i = 0; i < t.length; i++) pcm.setUint8(o + i, t.charCodeAt(i)); };
  str(0, "RIFF"); pcm.setUint32(4, 36 + n * 2, true); str(8, "WAVEfmt ");
  pcm.setUint32(16, 16, true); pcm.setUint16(20, 1, true); pcm.setUint16(22, 1, true);
  pcm.setUint32(24, to, true); pcm.setUint32(28, to * 2, true); pcm.setUint16(32, 2, true); pcm.setUint16(34, 16, true);
  str(36, "data"); pcm.setUint32(40, n * 2, true);
  const bytes = new Uint8Array(pcm.buffer);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** A recorded question to text, by Gemini through the website's function. */
export async function transcribe(wavBase64) {
  const res = await fetch(SPEECH_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ task: "transcribe", audio: wavBase64, mimeType: "audio/wav" }),
    signal: AbortSignal.timeout(25_000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `transcription ${res.status}`);
  return String(body.result?.texte ?? "").trim();
}
