// Components for phone and voice services where the internet is thin: the
// pieces we could not find elsewhere while building the Ndiédieng example.
// Each is HTML, CSS and a setup function. The page runs every demo from
// exactly this code (in its own shadow root) and shows the same code, so
// what you copy is what you saw working. Two of them run Kalangu itself
// (@kalangu/core and @kalangu/sim, mapped in index.html).
// MIT licensed, like the rest of Kalangu.

export const COMPONENTS = [
  {
    id: "bouncer",
    nickname: "The Bouncer",
    name: "USSD and SMS screen preview, on Kalangu's own budgeter",
    tags: ["ussd", "sms", "kalangu"],
    why: "Write \"reçu\" in an SMS and the message silently drops from 160 characters to 70: one character outside the standard SMS alphabet (ç, ê, ô, î, and in Wolof ë or ŋ) switches the whole message to Unicode, and the operator bills you for three SMS instead of one. é, è and à are fine, which nobody guesses. On USSD, accents don't show at all, and anything past the screen limit gets split by the operator with their own \"98\". This runs Kalangu's real budgeter, so you see exactly what a keypad phone will get, before a village chief does.",
    usedIn: { label: "@kalangu/core budgeter", href: "/docs/design/" },
    html: `<div class="modes" role="radiogroup" aria-label="Channel">
  <button role="radio" aria-checked="true" data-mode="sms">SMS</button>
  <button role="radio" aria-checked="false" data-mode="ussd">USSD menu</button>
</div>
<label class="field"><span class="label">Your text</span>
  <textarea rows="5" spellcheck="false"></textarea></label>
<div class="presets"></div>
<div class="verdict" aria-live="polite"></div>
<div class="screens"></div>`,
    css: `:host { display: grid; gap: 12px; padding: 20px; }
.modes { display: inline-flex; justify-self: start; gap: 2px; padding: 3px; border-radius: 10px; background: #eef2ef; }
.modes button { border: 0; background: none; padding: 6px 14px; border-radius: 8px; font: inherit; font-size: 14px; cursor: pointer; }
.modes [aria-checked="true"] { background: #fff; font-weight: 600; box-shadow: 0 1px 2px rgba(0,0,0,.12); }
.field { display: grid; gap: 6px; }
.label { font-size: 13px; font-weight: 600; color: #47564d; }
textarea { width: 100%; padding: 10px 12px; border: 1px solid #dfe5e1; border-radius: 10px; font: 14px/1.45 ui-monospace, monospace; resize: vertical; }
.presets { display: flex; flex-wrap: wrap; gap: 6px; }
.presets button { border: 1px solid #dfe5e1; background: #fff; border-radius: 99px; padding: 4px 10px; font: inherit; font-size: 12.5px; cursor: pointer; }
.verdict { display: flex; flex-wrap: wrap; gap: 8px; font-size: 13px; }
.verdict span { padding: 3px 10px; border-radius: 99px; background: #eef2ef; }
.verdict .bad { background: #fdecea; color: #b42318; font-weight: 600; }
.verdict .good { background: #e4f3eb; color: #0b6b45; font-weight: 600; }
.screens { display: flex; gap: 10px; overflow-x: auto; padding-bottom: 4px; }
.lcd { flex: none; width: 190px; padding: 8px 10px 6px; border-radius: 8px; background: linear-gradient(#cfe0b4, #b9cf97);
  color: #1d2a12; font: 12px/1.3 ui-monospace, monospace; white-space: pre-wrap; overflow-wrap: anywhere;
  box-shadow: inset 0 2px 6px rgba(0,0,0,.25); }
.lcd small { display: block; margin-top: 6px; padding-top: 3px; border-top: 1px dashed rgba(29,42,18,.35); font-size: 10.5px; opacity: .8; }
.lcd mark { background: #ffb4a8; color: inherit; border-radius: 2px; }`,
    js: async function setup(root) {
      // The real thing: Kalangu's budgeter, the same code the library runs.
      const { smsLength, splitSegments, toUssdSafe, optionNumbers, paginateMenu, BudgetError } = await import("@kalangu/core");
      const PRESETS = {
        sms: [
          ["é, è, à : still 160", "Mairie de Ndiédieng : votre signalement S-0042 (forage) est résolu. Merci de l'avoir signalé. Pour un autre problème, composez *123#."],
          ["One ç : now 70", "Mairie de Ndiédieng : nous avons bien reçu votre signalement S-0042 (forage). Il sera traité dès que possible. Pour un autre problème, composez *123#."],
          ["Wolof ë", "Jërëjëf ! Mairie de Ndiédieng : votre signalement S-0042 (forage) est résolu. Pour un autre problème, composez *123#."],
        ],
        ussd: [
          ["Menu court", "Mairie de Ndiédieng\nSignaler une panne\nDéclarer une naissance\nDéclarer un décès\nSuivre un signalement\nÉcrire un message"],
          ["Menu long", "Quel équipement est en panne dans votre village ?\nForage du centre\nBorne-fontaine près de l'école\nPoste de santé\nCase de santé\nSalle de classe\nLatrines de l'école\nLampadaire solaire\nPiste vers Kaolack\nAutre équipement"],
        ],
      };
      const textarea = root.querySelector("textarea");
      const verdict = root.querySelector(".verdict");
      const screens = root.querySelector(".screens");
      let mode = "sms";
      const pill = (text, cls = "") => Object.assign(document.createElement("span"), { textContent: text, className: cls });
      const lcd = (text, note, bad = []) => {
        const box = document.createElement("div");
        box.className = "lcd";
        for (const ch of text) { // characters that cost the encoding, highlighted (as text nodes, never HTML)
          if (bad.includes(ch)) box.append(Object.assign(document.createElement("mark"), { textContent: ch }));
          else box.append(ch);
        }
        box.append(Object.assign(document.createElement("small"), { textContent: note }));
        return box;
      };
      const draw = () => {
        const text = textarea.value;
        if (mode === "sms") {
          const len = smsLength(text);
          const parts = splitSegments(text, len.encoding);
          verdict.replaceChildren(
            pill(len.encoding === "gsm7" ? "GSM-7: 160 per SMS" : "Unicode (UCS-2): 70 per SMS", len.encoding === "gsm7" ? "good" : "bad"),
            pill(`${len.units} units`),
            pill(`${len.segments} SMS billed`, len.segments > 1 ? "bad" : "good"),
            len.nonGsmChars.length ? pill(`Because of: ${len.nonGsmChars.join(" ")}`, "bad") : pill("No costly characters", "good"),
          );
          screens.replaceChildren(...parts.map((p, i) => lcd(p, `SMS ${i + 1}/${parts.length}`, len.nonGsmChars)));
          return;
        }
        const [head = "", ...items] = text.split("\n").map((l) => l.trim()).filter(Boolean);
        const safe = toUssdSafe([head, ...items].join("\n"));
        const [safeHead, ...safeItems] = safe.text.split("\n");
        const numbers = optionNumbers(safeItems.length);
        try {
          const pages = paginateMenu({ head: [safeHead], items: safeItems.map((it, i) => `${numbers[i]}. ${it}`), maxChars: 160, moreLine: "98. Suite" });
          verdict.replaceChildren(
            pill(`${pages.length} screen${pages.length > 1 ? "s" : ""} of 160`, pages.length > 1 ? "bad" : "good"),
            safe.changed ? pill("Accents removed: USSD can't show them", "bad") : pill("Nothing to strip", "good"),
            safe.removed.length ? pill(`Dropped: ${safe.removed.join(" ")}`, "bad") : pill("Nothing dropped"),
          );
          screens.replaceChildren(...pages.map((p, i) => lcd(p, `screen ${i + 1}/${pages.length} · ${p.length}/160`)));
        } catch (err) {
          verdict.replaceChildren(pill(err instanceof BudgetError ? `Won't fit: ${err.message}` : String(err), "bad"));
          screens.replaceChildren();
        }
      };
      const setMode = (m) => {
        mode = m;
        for (const b of root.querySelectorAll("[data-mode]")) b.setAttribute("aria-checked", String(b.dataset.mode === m));
        root.querySelector(".presets").replaceChildren(...PRESETS[m].map(([label, text]) => {
          const b = Object.assign(document.createElement("button"), { textContent: label });
          b.onclick = () => { textarea.value = text; draw(); };
          return b;
        }));
        textarea.value = PRESETS[m][m === "sms" ? 1 : 0][1];
        draw();
      };
      for (const b of root.querySelectorAll("[data-mode]")) b.onclick = () => setMode(b.dataset.mode);
      textarea.oninput = draw;
      setMode("sms");
    },
  },

  {
    id: "triplets",
    nickname: "The Triplets",
    name: "One Kalangu USSD session, on three phones",
    tags: ["ussd", "simulator", "kalangu"],
    why: "USSD looks nothing alike from one phone to the next: a green monochrome screen on a keypad phone, a system alert on an iPhone, a Material dialog on Android. If you only test on one, you ship surprises to the others. This is a real Kalangu agent and the real simulator from @kalangu/sim, no SIM card, no operator, no account. Switch phones mid-session: the session carries on.",
    usedIn: { label: "Ndiédieng's phones", href: "/ndiedieng/" },
    html: `<div class="skins" role="radiogroup" aria-label="Phone">
  <button role="radio" aria-checked="true" data-skin="keypad">Keypad</button>
  <button role="radio" aria-checked="false" data-skin="android">Android</button>
  <button role="radio" aria-checked="false" data-skin="ios">iPhone</button>
</div>
<div class="phone keypad">
  <div class="screen" aria-live="polite"></div>
  <form class="reply">
    <input inputmode="numeric" autocomplete="off" aria-label="Your answer">
    <div class="btns"><button type="button" class="cancel">Annuler</button><button type="submit">Envoyer</button></div>
  </form>
</div>`,
    css: `:host { display: grid; justify-items: center; gap: 14px; padding: 22px 12px; }
.skins { display: inline-flex; gap: 2px; padding: 3px; border-radius: 10px; background: #eef2ef; }
.skins button { border: 0; background: none; padding: 6px 14px; border-radius: 8px; font: inherit; font-size: 14px; cursor: pointer; }
.skins [aria-checked="true"] { background: #fff; font-weight: 600; box-shadow: 0 1px 2px rgba(0,0,0,.12); }
.phone { width: 250px; }
.screen { white-space: pre-wrap; overflow-wrap: anywhere; min-height: 120px; }
.reply input { width: 100%; font: inherit; }
.btns { display: flex; }
.btns button { flex: 1; border: 0; background: none; font: inherit; cursor: pointer; }
/* Keypad phone: monochrome LCD, soft keys. */
.keypad { padding: 14px; border-radius: 26px; background: linear-gradient(160deg, #3a4048, #20242a); }
.keypad .screen { padding: 8px; border-radius: 6px 6px 0 0; background: linear-gradient(#cfe0b4, #b9cf97); color: #1d2a12; font: 12.5px/1.3 ui-monospace, monospace; }
.keypad .reply { padding: 0 8px 6px; border-radius: 0 0 6px 6px; background: #b9cf97; }
.keypad input { border: 0; border-top: 1px dashed rgba(29,42,18,.4); background: transparent; color: #1d2a12; font: 12.5px ui-monospace, monospace; padding: 4px 0; outline: none; }
.keypad .btns button { color: #1d2a12; font: 700 11px ui-monospace, monospace; text-transform: uppercase; padding: 4px 0; }
.keypad .btns button + button { text-align: right; }
.keypad .btns { flex-direction: row-reverse; }
/* Android: Material dialog. */
.android { padding: 22px 22px 10px; border-radius: 28px; background: #eef0f9; box-shadow: 0 8px 28px rgba(0,0,0,.18); font-family: Roboto, system-ui, sans-serif; }
.android .screen { color: #44474f; font-size: 14px; line-height: 1.45; min-height: 0; }
.android input { margin-top: 14px; padding: 10px 12px; border: 1px solid #74777f; border-radius: 4px; background: transparent; }
.android .btns { justify-content: flex-end; margin-top: 10px; }
.android .btns button { flex: none; padding: 10px 14px; border-radius: 20px; color: #0b57d0; font-weight: 500; }
/* iPhone: system alert. */
.ios { border-radius: 14px; background: rgba(242,242,247,.98); box-shadow: 0 10px 30px rgba(0,0,0,.2); font-family: -apple-system, system-ui, sans-serif; overflow: hidden; }
.ios .screen { padding: 18px 16px 12px; font-size: 13px; line-height: 1.38; min-height: 0; }
.ios input { width: calc(100% - 32px); margin: 0 16px 14px; padding: 5px 8px; border: .5px solid #c6c6c8; border-radius: 7px; background: #fff; }
.ios .btns { border-top: .5px solid #c6c6c8; }
.ios .btns button { min-height: 44px; color: #007aff; font-size: 16px; }
.ios .btns button + button { border-left: .5px solid #c6c6c8; font-weight: 600; }
.ended input, .ended .cancel { display: none; }`,
    js: async function setup(root) {
      // A real agent, and the real simulated phone that dials it.
      const { createAgent, menu, ask, say, silentLogger } = await import("@kalangu/core");
      const { createPhone } = await import("@kalangu/sim");
      const agent = createAgent({
        channels: [],
        logger: silentLogger,
        start: menu("Mairie de Ndiédieng", {
          "Signaler une panne": menu("Quel équipement ?", {
            "Forage": say("Signalement S-0042 enregistré : forage, urgence haute. Un SMS vous dira quand il est traité."),
            "Poste de santé": say("Signalement S-0043 enregistré : poste de santé. Un SMS vous dira quand il est traité."),
            "Piste coupée": say("Signalement S-0044 enregistré : piste. Merci."),
          }),
          "Suivre un signalement": ask("Numéro du signalement ?", (code) => `${code.toUpperCase()} : pris en charge par la Mairie.`),
        }),
      });
      const phone = createPhone(agent, { phone: "+221770000001", code: "*123#" });
      const box = root.querySelector(".phone");
      const screen = root.querySelector(".screen");
      const input = root.querySelector("input");
      const show = (s) => {
        screen.textContent = s.text;
        box.classList.toggle("ended", s.end);
        root.querySelector('[type="submit"]').textContent = s.end ? "Recomposer *123#" : "Envoyer";
        input.value = "";
      };
      root.querySelector(".reply").onsubmit = async (e) => {
        e.preventDefault();
        show(phone.inSession ? await phone.press(input.value.trim()) : await phone.dial("*123#"));
        if (phone.inSession) input.focus();
      };
      root.querySelector(".cancel").onclick = () => { phone.hangUp(); show({ text: "Session terminée.", end: true }); };
      for (const b of root.querySelectorAll("[data-skin]")) {
        b.onclick = () => {
          for (const o of root.querySelectorAll("[data-skin]")) o.setAttribute("aria-checked", String(o === b));
          box.className = `phone ${b.dataset.skin}${box.classList.contains("ended") ? " ended" : ""}`;
        };
      }
      show(await phone.dial("*123#"));
    },
  },

  {
    id: "marble",
    nickname: "The Mood Marble",
    name: "Voice orb wired to your real microphone",
    tags: ["voice", "animation"],
    why: "A talking interface has four moods, and people need to see which one they are in: waiting, listening, thinking, speaking. Most voice orbs are a looping animation that would wiggle just the same if your microphone were unplugged. This one grows with your actual voice (Web Audio, nothing recorded or sent), then thinks, then answers out loud.",
    usedIn: { label: "Ndiédieng's assistant", href: "/ndiedieng/assistant/" },
    html: `<button class="orb" data-state="idle" aria-label="Tap and speak">
  <span class="glow"></span>
  <span class="core"><i></i><i></i><i></i><i></i></span>
  <span class="shine"></span>
</button>
<p class="state" aria-live="polite">Tap the orb and say something.</p>`,
    css: `:host { display: grid; justify-items: center; gap: 18px; padding: 30px 0 18px; }
.orb { --size: 124px; --speed: 1; --level: 0; position: relative; width: var(--size); height: var(--size);
  padding: 0; border: 0; background: none; border-radius: 50%; cursor: pointer; }
.orb > span { position: absolute; inset: 0; border-radius: 50%; pointer-events: none; }
.glow { inset: -30% !important; filter: blur(10px); opacity: calc(.55 + var(--level) * .45);
  background: radial-gradient(circle, rgba(155,114,203,.42), rgba(66,133,244,.22) 40%, transparent 70%);
  scale: calc(1 + var(--level) * .3); transition: scale .08s linear; }
.core { overflow: hidden; background: radial-gradient(circle at 50% 45%, #fff, #f1f0ff 55%, #e4e6fb);
  box-shadow: inset 0 -6px 18px rgba(66,133,244,.22), inset 0 6px 14px #fff, 0 10px 30px rgba(110,90,200,.28);
  scale: calc(1 + var(--level) * .16); transition: scale .08s linear; }
.core i { position: absolute; left: 18%; top: 18%; width: 64%; height: 64%; border-radius: 50%;
  filter: blur(12px); opacity: .9; animation: drift calc(var(--d) * var(--speed)) linear infinite; }
.core i:nth-child(1) { --d: 9s;  --r: 22%; background: #4285f4; }
.core i:nth-child(2) { --d: 12s; --r: 26%; background: #a06ee0; animation-direction: reverse; }
.core i:nth-child(3) { --d: 14s; --r: 20%; background: #f06a8a; animation-delay: -5s; }
.core i:nth-child(4) { --d: 7s;  --r: 16%; background: #3cc6f2; width: 46%; height: 46%; left: 27%; top: 27%; }
@keyframes drift { from { transform: rotate(0) translateX(var(--r)) rotate(0); }
  to { transform: rotate(360deg) translateX(var(--r)) rotate(-360deg); } }
.shine { background: radial-gradient(circle at 32% 26%, rgba(255,255,255,.95), rgba(255,255,255,.45) 9%, transparent 26%);
  box-shadow: inset 0 0 0 1px rgba(255,255,255,.55); scale: calc(1 + var(--level) * .16); }
.orb[data-state="listening"] { --speed: .35; }
.orb[data-state="thinking"] { --speed: .25; }
.orb[data-state="thinking"] .core { animation: spin 1.2s linear infinite; }
.orb[data-state="speaking"] { --speed: .55; }
@keyframes spin { to { rotate: 360deg; } }
.state { margin: 0; font-size: 14px; color: #47564d; min-height: 20px; text-align: center; }`,
    js: function setup(root) {
      const orb = root.querySelector(".orb");
      const label = root.querySelector(".state");
      let stopMic = null;
      let raf = 0;
      const level = (v) => orb.style.setProperty("--level", v.toFixed(3));
      const mood = (state, text) => { orb.dataset.state = state; label.textContent = text; };

      async function listen() {
        // Your microphone's loudness, about 60 times a second; nothing is recorded.
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const ctx = new AudioContext();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        ctx.createMediaStreamSource(stream).connect(analyser);
        const data = new Uint8Array(analyser.fftSize);
        const tick = () => {
          analyser.getByteTimeDomainData(data);
          let sum = 0;
          for (const x of data) sum += ((x - 128) / 128) ** 2;
          level(Math.min(1, Math.sqrt(sum / data.length) * 4.5));
          raf = requestAnimationFrame(tick);
        };
        tick();
        return () => { cancelAnimationFrame(raf); stream.getTracks().forEach((t) => t.stop()); ctx.close(); level(0); };
      }

      function answer() {
        mood("thinking", "Thinking…");
        setTimeout(() => {
          mood("speaking", "Speaking.");
          const words = new SpeechSynthesisUtterance("Je vous ai bien entendu.");
          words.lang = "fr-FR";
          // Speech synthesis gives no level: a gentle pulse stands in while it talks.
          const t0 = performance.now();
          const pulse = (t) => { level(0.3 * Math.abs(Math.sin((t - t0) / 160))); raf = requestAnimationFrame(pulse); };
          raf = requestAnimationFrame(pulse);
          const done = () => { cancelAnimationFrame(raf); level(0); mood("idle", "Tap the orb and say something."); };
          words.onend = done;
          words.onerror = done;
          if ("speechSynthesis" in window) speechSynthesis.speak(words);
          else setTimeout(done, 1500);
        }, 1200);
      }

      orb.onclick = async () => {
        if (orb.dataset.state === "listening") {
          stopMic?.();
          stopMic = null;
          return answer();
        }
        if (orb.dataset.state !== "idle") return;
        try {
          stopMic = await listen();
          mood("listening", "Listening… tap again when you're done.");
        } catch {
          label.textContent = "No microphone here, or it was refused.";
        }
      };
    },
  },

  {
    id: "marble-jr",
    nickname: "Marble Jr.",
    name: "The way in to the assistant",
    tags: ["animation", "css only"],
    why: "The Mood Marble's little sibling, so the button that opens the assistant already looks like the assistant: people recognise the orb before they read the word. Four layered gradients, no image, a slow turn, and a faster one when you hover, as if it is pleased to see you.",
    usedIn: { label: "Ndiédieng's top bar", href: "/ndiedieng/" },
    html: `<a class="pill" href="#"><span class="mini"></span>Assistant</a>`,
    css: `:host { display: grid; place-items: center; padding: 40px 0; }
.pill { display: inline-flex; align-items: center; gap: 8px; padding: 6px 16px 6px 8px; border-radius: 99px;
  border: 1px solid #dfe5e1; background: #fff; color: #15201a; font-weight: 600; text-decoration: none; }
.mini { width: 22px; height: 22px; border-radius: 50%;
  background: radial-gradient(circle at 32% 26%, rgba(255,255,255,.95), transparent 30%),
    radial-gradient(circle at 28% 72%, #4285f4, transparent 62%),
    radial-gradient(circle at 74% 38%, #a06ee0, transparent 62%),
    radial-gradient(circle at 66% 80%, #f06a8a, transparent 58%), #e9e6fb;
  box-shadow: 0 2px 8px rgba(110,90,200,.45); animation: turn 8s linear infinite; }
.pill:hover .mini { animation-duration: 2.5s; box-shadow: 0 2px 14px rgba(110,90,200,.7); }
@keyframes turn { to { rotate: 360deg; } }`,
    js: null,
  },

  {
    id: "patience",
    nickname: "The Patience Timer",
    name: "Dictation that never hangs",
    tags: ["voice", "reliability"],
    why: "The Web Speech API has three traps. Brave, Arc and others offer it and then never start, so the page waits forever. Safari only allows it when started directly from a tap, so any await before start() silently breaks it. And the error codes are not words a person understands. This wrapper starts inside the tap, gives the browser 5 seconds to show signs of life, caps a dictation at 45, and turns every failure into a sentence.",
    usedIn: { label: "Every microphone in Ndiédieng", href: "/ndiedieng/assistant/" },
    html: `<div class="row">
  <button class="real">🎙 Dictate (for real)</button>
  <button class="broken">Pretend my browser is broken</button>
</div>
<p class="out" aria-live="polite">French, by default. Nothing leaves your browser except what your browser itself sends.</p>`,
    css: `:host { display: grid; justify-items: center; gap: 14px; padding: 34px 16px; text-align: center; }
.row { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; }
button { padding: 10px 16px; border: 1px solid #dfe5e1; border-radius: 99px; background: #fff; font: inherit; cursor: pointer; }
.real { background: #0b6b45; border-color: #0b6b45; color: #fff; font-weight: 600; }
.out { margin: 0; min-height: 44px; max-width: 380px; font-size: 14px; color: #47564d; }`,
    js: function setup(root) {
      const ERRORS = {
        "not-allowed": "The microphone is blocked for this site. Allow it in the address bar.",
        "audio-capture": "No microphone was found.",
        "no-speech": "I didn't hear anything.",
        network: "This browser's dictation needs its servers, or isn't really offered (Brave, Arc…). Try Chrome, Edge or Safari.",
        silent: "This browser shows dictation but doesn't run it. Try Chrome, Edge or Safari.",
      };

      /** One dictation. Call it inside the click: Safari refuses it later. */
      function listen(Recognition, { lang = "fr-FR", onText, onDone, onError }) {
        const r = new Recognition();
        r.lang = lang;
        r.interimResults = true;
        let text = "", started = false, ended = false, failed = false;
        const finish = () => {
          if (ended) return;
          ended = true;
          clearTimeout(watchdog);
          clearTimeout(cap);
          onDone(failed ? "" : text.trim());
        };
        // No sign of life in 5 s: stop, and say so, rather than wait forever.
        const watchdog = setTimeout(() => {
          if (started) return;
          failed = true;
          onError(ERRORS.silent);
          r.abort();
          finish(); // some browsers never even fire "end"
        }, 5000);
        const cap = setTimeout(() => r.stop(), 45_000);
        r.onaudiostart = () => (started = true);
        r.onresult = (e) => {
          text = Array.from(e.results, (res) => res[0].transcript).join("");
          onText(text);
        };
        r.onerror = (e) => {
          if (e.error === "aborted") return;
          failed = true;
          onError(ERRORS[e.error] ?? `Dictation failed (${e.error}).`);
        };
        r.onend = finish;
        r.start(); // first, synchronously, still inside the tap
        return { stop: () => r.stop() };
      }

      const out = root.querySelector(".out");
      const callbacks = {
        onText: (t) => (out.textContent = `“${t}”`),
        onDone: (t) => { if (t) out.textContent = `Heard: “${t}”`; },
        onError: (m) => (out.textContent = m),
      };
      root.querySelector(".real").onclick = () => {
        const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!Recognition) return (out.textContent = "No dictation in this browser. Try Chrome, Edge or Safari.");
        out.textContent = "Listening… speak French.";
        listen(Recognition, callbacks);
      };
      // A recognizer that never starts, like some browsers ship.
      class NeverStarts { start() {} stop() {} abort() {} }
      root.querySelector(".broken").onclick = () => {
        out.textContent = "Listening… (this one will never start)";
        listen(NeverStarts, callbacks);
      };
    },
  },

  {
    id: "unmuter",
    nickname: "The Unmuter",
    name: "Spoken answers that actually play on an iPhone",
    tags: ["voice", "mobile", "reliability"],
    why: "On an iPhone, sound that starts after a network call is blocked: the answer arrives three seconds after your tap, and plays in silence. The fix is to unlock a player inside the tap and reuse it. And if you route the audio through an analyser to animate it, a suspended audio context mutes everything, so the analyser is plugged in only once the context is really running. This demo plays a talking-drum phrase (the kalangu that gives the project its name), made in the browser.",
    usedIn: { label: "Ndiédieng's spoken answers", href: "/ndiedieng/assistant/" },
    html: `<button class="play">Play the drum</button>
<div class="meter" aria-hidden="true"><i></i></div>
<p class="out" aria-live="polite">The bar follows the real sound.</p>`,
    css: `:host { display: grid; justify-items: center; gap: 14px; padding: 34px 16px; }
.play { padding: 10px 18px; border: 0; border-radius: 99px; background: #b5501b; color: #fff; font: inherit; font-weight: 600; cursor: pointer; }
.meter { width: 240px; height: 10px; border-radius: 5px; background: #eee5d8; overflow: hidden; }
.meter i { display: block; height: 100%; width: calc(var(--level, 0) * 100%); border-radius: 5px; background: linear-gradient(90deg, #e9c22e, #b5501b); transition: width .05s linear; }
.out { margin: 0; font-size: 13.5px; color: #47564d; }`,
    js: function setup(root) {
      let player = null, ctx = null, analyser = null;

      /** Inside the tap: create and unlock the one player we will reuse. */
      function unlock() {
        player ??= Object.assign(new Audio(), { playsInline: true });
        ctx ??= new AudioContext();
        ctx.resume().then(() => {
          // Only once audio really runs: a suspended context would mute the player.
          if (analyser || ctx.state !== "running") return;
          analyser = ctx.createAnalyser();
          analyser.fftSize = 256;
          ctx.createMediaElementSource(player).connect(analyser);
          analyser.connect(ctx.destination);
        });
      }

      /** A talking drum: pitch bends like a voice, as a WAV made right here. */
      function drumWav() {
        const rate = 22050, beats = [[0, 180, 120], [0.32, 240, 150], [0.55, 150, 110], [0.9, 260, 160], [1.2, 200, 120]];
        const n = Math.floor(rate * 1.7), pcm = new Int16Array(n);
        for (const [at, from, to] of beats) {
          for (let i = 0; i < rate * 0.35; i++) {
            const t = i / rate, j = Math.floor((at + t) * rate);
            if (j >= n) break;
            const f = to + (from - to) * Math.exp(-t * 9); // the squeeze of the drum's cords
            pcm[j] += Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 7) * 12000;
          }
        }
        const head = new DataView(new ArrayBuffer(44));
        const str = (o, s) => [...s].forEach((c, i) => head.setUint8(o + i, c.charCodeAt(0)));
        str(0, "RIFF"); head.setUint32(4, 36 + n * 2, true); str(8, "WAVEfmt ");
        head.setUint32(16, 16, true); head.setUint16(20, 1, true); head.setUint16(22, 1, true);
        head.setUint32(24, rate, true); head.setUint32(28, rate * 2, true); head.setUint16(32, 2, true); head.setUint16(34, 16, true);
        str(36, "data"); head.setUint32(40, n * 2, true);
        return new Blob([head, pcm], { type: "audio/wav" });
      }

      root.querySelector(".play").onclick = async () => {
        unlock(); // first, inside the tap
        // Then the slow part (in Ndiédieng: fetching Gemini's voice, about 3 s).
        await new Promise((r) => setTimeout(r, 600));
        const url = URL.createObjectURL(drumWav());
        player.src = url;
        await player.play();
        const bar = root.querySelector(".meter");
        const data = new Uint8Array(256);
        const tick = () => {
          if (analyser) {
            analyser.getByteTimeDomainData(data);
            let peak = 0;
            for (const x of data) peak = Math.max(peak, Math.abs(x - 128) / 128);
            bar.style.setProperty("--level", Math.min(1, peak * 1.6).toFixed(3));
          }
          if (!player.ended) requestAnimationFrame(tick);
          else { bar.style.setProperty("--level", "0"); URL.revokeObjectURL(url); }
        };
        tick();
        root.querySelector(".out").textContent = analyser ? "Playing, and measured as it plays." : "Playing (no level reading in this browser).";
      };
    },
  },
];
