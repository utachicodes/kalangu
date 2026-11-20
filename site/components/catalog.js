// The components we built for the Ndiédieng example, each as a small
// standalone piece: HTML, CSS and a setup function. The page runs every
// demo from exactly this code (in its own shadow root) and shows the same
// code underneath, so what you copy is what you saw working.
// MIT licensed, like the rest of Kalangu.

export const COMPONENTS = [
  {
    id: "orb",
    nickname: "The Mood Marble",
    name: "Voice orb",
    tags: ["animation", "voice"],
    why: "People don't read buttons, they tap shiny things. One control that listens, thinks and talks, and shows which one it is doing. The first version was a conic gradient that looked like a pie chart having a bad day; this one is pale glass with colour drifting inside.",
    usedIn: { label: "Assistant", href: "/ndiedieng/assistant/" },
    html: `<button class="orb" data-state="idle" aria-label="Talk to the orb">
  <span class="glow"></span>
  <span class="core"><i></i><i></i><i></i><i></i></span>
  <span class="shine"></span>
</button>
<div class="controls" role="group" aria-label="State">
  <button data-s="idle" aria-pressed="true">Idle</button>
  <button data-s="listening">Listening</button>
  <button data-s="thinking">Thinking</button>
  <button data-s="speaking">Speaking</button>
</div>`,
    css: `:host { display: grid; justify-items: center; gap: 22px; padding: 28px 0 8px; }
.orb { --size: 124px; --speed: 1; --level: 0; position: relative; width: var(--size); height: var(--size);
  padding: 0; border: 0; background: none; border-radius: 50%; cursor: pointer; }
.orb > span { position: absolute; inset: 0; border-radius: 50%; pointer-events: none; }
/* a soft halo that breathes, brighter with the voice */
.glow { inset: -30% !important; filter: blur(10px); opacity: calc(.55 + var(--level) * .45);
  background: radial-gradient(circle, rgba(155,114,203,.42), rgba(66,133,244,.22) 40%, transparent 70%);
  scale: calc(1 + var(--level) * .25); animation: halo 4.5s ease-in-out infinite; }
@keyframes halo { 50% { transform: scale(1.06); } }
/* pale glass, with four blurred blobs drifting inside */
.core { overflow: hidden; background: radial-gradient(circle at 50% 45%, #fff, #f1f0ff 55%, #e4e6fb);
  box-shadow: inset 0 -6px 18px rgba(66,133,244,.22), inset 0 6px 14px #fff, 0 10px 30px rgba(110,90,200,.28);
  scale: calc(1 + var(--level) * .14); transition: scale .09s linear; }
.core i { position: absolute; left: 18%; top: 18%; width: 64%; height: 64%; border-radius: 50%;
  filter: blur(12px); opacity: .9; animation: drift calc(var(--d) * var(--speed)) linear infinite; }
.core i:nth-child(1) { --d: 9s;  --r: 22%; background: #4285f4; }
.core i:nth-child(2) { --d: 12s; --r: 26%; background: #a06ee0; animation-direction: reverse; }
.core i:nth-child(3) { --d: 14s; --r: 20%; background: #f06a8a; animation-delay: -5s; }
.core i:nth-child(4) { --d: 7s;  --r: 16%; background: #3cc6f2; width: 46%; height: 46%; left: 27%; top: 27%; }
@keyframes drift { from { transform: rotate(0) translateX(var(--r)) rotate(0); }
  to { transform: rotate(360deg) translateX(var(--r)) rotate(-360deg); } }
.shine { background: radial-gradient(circle at 32% 26%, rgba(255,255,255,.95), rgba(255,255,255,.45) 9%, transparent 26%);
  box-shadow: inset 0 0 0 1px rgba(255,255,255,.55); scale: calc(1 + var(--level) * .14); }
.orb[data-state="listening"] { --speed: .35; }
.orb[data-state="thinking"] { --speed: .25; }
.orb[data-state="thinking"] .core { animation: spin 1.4s linear infinite; }
.orb[data-state="speaking"] { --speed: .55; }
@keyframes spin { to { rotate: 360deg; } }
.controls { display: flex; gap: 4px; padding: 4px; border-radius: 99px; background: #f0ece4; }
.controls button { border: 0; background: none; padding: 6px 12px; border-radius: 99px; font: inherit; font-size: 13px; cursor: pointer; }
.controls [aria-pressed="true"] { background: #fff; font-weight: 600; box-shadow: 0 1px 2px rgba(0,0,0,.12); }`,
    js: function setup(root) {
      const orb = root.querySelector(".orb");
      const order = ["idle", "listening", "thinking", "speaking"];
      let raf = 0;
      const set = (state) => {
        orb.dataset.state = state;
        for (const b of root.querySelectorAll("[data-s]")) b.setAttribute("aria-pressed", String(b.dataset.s === state));
        cancelAnimationFrame(raf);
        orb.style.setProperty("--level", "0");
        if (state !== "listening" && state !== "speaking") return;
        // A pretend voice; the real page feeds the microphone's level here.
        const t0 = performance.now();
        const tick = (t) => {
          const v = Math.abs(Math.sin((t - t0) / 170)) * (0.5 + 0.5 * Math.sin((t - t0) / 610));
          orb.style.setProperty("--level", v.toFixed(3));
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      };
      for (const b of root.querySelectorAll("[data-s]")) b.onclick = () => set(b.dataset.s);
      orb.onclick = () => set(order[(order.indexOf(orb.dataset.state) + 1) % order.length]);
    },
  },

  {
    id: "mini-orb",
    nickname: "Marble Jr.",
    name: "Assistant button",
    tags: ["animation"],
    why: "The big orb's little sibling, so the way to the assistant already looks like the assistant. Layered radial gradients, no images, turns slowly, spins faster when you hover as if it is excited to see you.",
    usedIn: { label: "Dashboard top bar", href: "/ndiedieng/" },
    html: `<a class="pill" href="#"><span class="mini"></span>Assistant</a>`,
    css: `:host { display: grid; place-items: center; padding: 36px 0; }
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
    id: "select",
    nickname: "The Personal Space Arrow",
    name: "Dropdown with its own chevron",
    tags: ["form", "css only"],
    why: "Browsers draw the dropdown arrow wherever they like, sometimes right on top of a long village name. We drew our own, in a lane reserved for it: always vertically centred, always 18 px from the edge, and the text is told to stop and say \"…\" before it gets there.",
    usedIn: { label: "Every dropdown", href: "/ndiedieng/" },
    html: `<label>Chef de village
  <select>
    <option>Village 07 · +221 •• 07</option>
    <option>A village with a remarkably, almost suspiciously long name</option>
  </select>
</label>`,
    css: `:host { display: grid; place-items: center; padding: 34px 16px; }
label { display: grid; gap: 6px; width: min(300px, 100%); font-size: 13px; font-weight: 600; color: #47564d; }
select {
  appearance: none; -webkit-appearance: none; width: 100%;
  min-height: 42px; padding: 8px 44px 8px 12px; /* 44 px: the arrow's own lane */
  border: 1px solid #dfe5e1; border-radius: 10px; background-color: #fff;
  font: inherit; font-size: 15px; font-weight: 400; color: #15201a; cursor: pointer;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M2.5 4.5 6 8l3.5-3.5' fill='none' stroke='%236b7a71' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
  background-repeat: no-repeat; background-size: 12px; background-position: right 18px center;
}`,
    js: null,
  },

  {
    id: "toast",
    nickname: "The Oops Button",
    name: "Toast with Undo",
    tags: ["feedback"],
    why: "\"Are you sure?\" dialogs train people to click Yes without reading. So deleting just happens, and for a few seconds an Undo sits at the bottom of the screen. Faster when you meant it, painless when you didn't.",
    usedIn: { label: "Deleting a report", href: "/ndiedieng/" },
    html: `<ul class="list">
  <li>S-0042 · Forage en panne <button>Supprimer</button></li>
  <li>S-0043 · Piste coupée <button>Supprimer</button></li>
  <li>S-0044 · Lampadaire éteint <button>Supprimer</button></li>
</ul>
<div class="toast" role="status" hidden></div>`,
    css: `:host { display: block; position: relative; min-height: 230px; padding: 20px; }
.list { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.list li { display: flex; justify-content: space-between; align-items: center; padding: 10px 12px;
  background: #fff; border: 1px solid #e8e2d8; border-radius: 10px; font-size: 14px; }
.list li[hidden] { display: none; }
.list button { border: 0; background: none; color: #b42318; font: inherit; font-weight: 600; cursor: pointer; }
.toast { position: absolute; left: 50%; bottom: 16px; translate: -50% 0; display: flex; gap: 14px; align-items: center;
  padding: 10px 10px 10px 16px; border-radius: 12px; background: #15201a; color: #fff; font-size: 14px;
  white-space: nowrap; animation: up .2s ease-out; }
.toast[hidden] { display: none; }
.toast button { border: 0; border-radius: 8px; padding: 6px 12px; background: rgba(255,255,255,.14);
  color: #8ee4b5; font: inherit; font-weight: 700; cursor: pointer; }
@keyframes up { from { opacity: 0; translate: -50% 8px; } }`,
    js: function setup(root) {
      const toast = root.querySelector(".toast");
      let timer;
      for (const button of root.querySelectorAll(".list button")) {
        button.onclick = () => {
          const item = button.closest("li");
          item.hidden = true; // gone at once: no "are you sure?"
          const undo = Object.assign(document.createElement("button"), { textContent: "Annuler" });
          undo.onclick = () => { item.hidden = false; toast.hidden = true; };
          const text = document.createElement("span");
          text.textContent = `${item.firstChild.textContent.trim().split(" ·")[0]} supprimé.`;
          toast.replaceChildren(text, undo);
          toast.hidden = false;
          clearTimeout(timer);
          timer = setTimeout(() => (toast.hidden = true), 6000);
        };
      }
    },
  },

  {
    id: "tabs",
    nickname: "The Headcount",
    name: "Status filters with counts",
    tags: ["navigation", "keyboard"],
    why: "We had big number cards and status tabs that did the same thing, which is two things too many for a busy town hall. Now the filter is the count. Arrow keys move between them, like the radio buttons they really are.",
    usedIn: { label: "Report list", href: "/ndiedieng/" },
    html: `<div class="tabs" role="radiogroup" aria-label="Statut"></div>
<p class="out" aria-live="polite"></p>`,
    css: `:host { display: grid; justify-items: center; gap: 14px; padding: 34px 12px; }
.tabs { display: flex; gap: 2px; padding: 3px; border-radius: 11px; background: #eef2ef; max-width: 100%; overflow-x: auto; }
.tabs button { display: inline-flex; gap: 6px; align-items: center; min-height: 32px; padding: 4px 12px;
  border: 0; border-radius: 8px; background: none; font: inherit; font-size: 14px; color: #47564d; cursor: pointer; white-space: nowrap; }
.tabs [aria-checked="true"] { background: #fff; color: #15201a; font-weight: 600; box-shadow: 0 1px 2px rgba(0,0,0,.12); }
.tabs small { font-size: 12px; color: #6b7a71; font-weight: 500; }
.out { margin: 0; font-size: 13px; color: #6b7a71; }`,
    js: function setup(root) {
      const tabs = [["Tous", 37], ["Nouveaux", 18], ["À vérifier", 2], ["En cours", 15], ["Résolus", 2]];
      const host = root.querySelector(".tabs");
      let current = 0;
      const draw = (focus = false) => {
        host.replaceChildren(...tabs.map(([label, n], i) => {
          const b = document.createElement("button");
          b.setAttribute("role", "radio");
          b.setAttribute("aria-checked", String(i === current));
          b.tabIndex = i === current ? 0 : -1; // one tab stop for the group
          b.append(label, Object.assign(document.createElement("small"), { textContent: n }));
          b.onclick = () => { current = i; draw(true); };
          return b;
        }));
        root.querySelector(".out").textContent = `${tabs[current][1]} signalements · ${tabs[current][0]}`;
        if (focus) host.children[current].focus();
      };
      host.onkeydown = (e) => {
        if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
        current = (current + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length;
        draw(true);
      };
      draw();
    },
  },

  {
    id: "palette",
    nickname: "The Teleporter",
    name: "Quick search (Ctrl/⌘ K)",
    tags: ["keyboard", "search"],
    why: "On stage, \"scroll, scroll, where was it\" is the sound of a demo dying. Type two letters and you are there. Results are grouped, the match is highlighted, and the arrow keys never leave the search box.",
    usedIn: { label: "Dashboard", href: "/ndiedieng/" },
    html: `<button class="open">Rechercher <kbd>Ctrl K</kbd></button>
<dialog>
  <input placeholder="Un signalement, un village…" role="combobox" aria-expanded="true" aria-controls="list" autocomplete="off">
  <ul id="list" role="listbox"></ul>
</dialog>`,
    css: `:host { display: grid; place-items: center; padding: 38px 0; }
.open { display: inline-flex; gap: 10px; align-items: center; padding: 8px 14px; border: 1px solid #dfe5e1;
  border-radius: 10px; background: #fff; font: inherit; color: #6b7a71; cursor: pointer; }
kbd { padding: 1px 6px; border: 1px solid #dfe5e1; border-bottom-width: 2px; border-radius: 6px; font: 600 11px/1.6 system-ui; }
dialog { width: min(440px, 92vw); padding: 0; border: 0; border-radius: 14px; box-shadow: 0 24px 64px rgba(0,0,0,.28); }
dialog::backdrop { background: rgba(15,25,20,.35); }
input { width: 100%; padding: 14px 16px; border: 0; border-bottom: 1px solid #eef2ef; font: inherit; font-size: 16px; outline: none; }
ul { list-style: none; margin: 0; padding: 6px; max-height: 260px; overflow: auto; }
li { padding: 10px 12px; border-radius: 9px; cursor: pointer; font-size: 14px; }
li[aria-selected="true"] { background: #e4f3eb; }
mark { background: #fff3a8; color: inherit; border-radius: 3px; }`,
    js: function setup(root) {
      const items = ["S-0012 · Santé · Village 25", "S-0013 · Santé · Village 35", "S-0007 · Eau · Village 43",
        "S-0021 · Piste · Village 08", "Village 10", "Nouveau signalement", "Exporter en CSV"];
      const dialog = root.querySelector("dialog");
      const input = root.querySelector("input");
      const list = root.querySelector("ul");
      const fold = (t) => t.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
      let shown = [], active = 0;
      const draw = () => {
        const q = fold(input.value.trim());
        shown = items.filter((t) => fold(t).includes(q));
        active = Math.min(active, Math.max(0, shown.length - 1));
        list.replaceChildren(...shown.map((t, i) => {
          const li = document.createElement("li");
          li.setAttribute("role", "option");
          li.setAttribute("aria-selected", String(i === active));
          const at = q ? fold(t).indexOf(q) : -1; // highlight with text nodes, never innerHTML
          if (at < 0) li.textContent = t;
          else li.append(t.slice(0, at), Object.assign(document.createElement("mark"), { textContent: t.slice(at, at + q.length) }), t.slice(at + q.length));
          li.onclick = () => { input.value = t; dialog.close(); };
          return li;
        }));
      };
      const open = () => { input.value = ""; active = 0; draw(); dialog.showModal(); input.focus(); };
      root.querySelector(".open").onclick = open;
      input.oninput = () => { active = 0; draw(); };
      input.onkeydown = (e) => {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          if (shown.length) active = (active + (e.key === "ArrowDown" ? 1 : shown.length - 1)) % shown.length;
          draw();
        } else if (e.key === "Enter" && shown[active]) dialog.close();
      };
      dialog.onclick = (e) => { if (e.target === dialog) dialog.close(); };
      document.addEventListener("keydown", (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k" && root.host.isConnected && root.host.matches(":hover, :focus-within")) {
          e.preventDefault();
          open();
        }
      });
    },
  },

  {
    id: "waveform",
    nickname: "The Seismograph",
    name: "Live microphone waveform",
    tags: ["voice", "animation"],
    why: "When you talk to a page and nothing moves, you start doubting the page, then the microphone, then yourself. These bars read your actual voice through the Web Audio API, so you know you are being heard. Nothing is recorded or sent.",
    usedIn: { label: "Voice messages in the phones", href: "/ndiedieng/" },
    html: `<div class="bars" aria-hidden="true"></div>
<div class="row">
  <button class="mic">Use my microphone</button>
  <button class="fake">Pretend</button>
</div>
<p class="note" aria-live="polite">Nothing is recorded or sent anywhere.</p>`,
    css: `:host { display: grid; justify-items: center; gap: 16px; padding: 30px 12px; }
.bars { display: flex; align-items: center; gap: 4px; height: 64px; }
.bars i { width: 5px; height: 6px; border-radius: 3px; transition: height .08s linear;
  background: linear-gradient(#4285f4, #9b72cb 60%, #d96570); }
.row { display: flex; gap: 8px; }
button { padding: 8px 14px; border: 1px solid #dfe5e1; border-radius: 99px; background: #fff; font: inherit; font-size: 14px; cursor: pointer; }
.note { margin: 0; font-size: 12.5px; color: #6b7a71; }`,
    js: function setup(root) {
      const host = root.querySelector(".bars");
      const bars = Array.from({ length: 24 }, () => host.appendChild(document.createElement("i")));
      const levels = Array(24).fill(0);
      let stop = () => {};
      const show = (v) => {
        levels.push(v);
        levels.shift();
        // Mirrored, loudest in the middle, as a voice looks.
        bars.forEach((b, i) => (b.style.height = `${6 + levels[Math.abs(23 - Math.abs(2 * i - 23))] * 56}px`));
      };
      root.querySelector(".mic").onclick = async () => {
        stop();
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          const ctx = new AudioContext();
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 512;
          ctx.createMediaStreamSource(stream).connect(analyser);
          const data = new Uint8Array(analyser.fftSize);
          let raf;
          const tick = () => {
            analyser.getByteTimeDomainData(data);
            let sum = 0;
            for (const x of data) sum += ((x - 128) / 128) ** 2;
            show(Math.min(1, Math.sqrt(sum / data.length) * 4.5)); // loudness, 0 to 1
            raf = requestAnimationFrame(tick);
          };
          tick();
          root.querySelector(".note").textContent = "Listening. Say something!";
          stop = () => { cancelAnimationFrame(raf); stream.getTracks().forEach((t) => t.stop()); ctx.close(); };
        } catch {
          root.querySelector(".note").textContent = "No microphone here; try Pretend.";
        }
      };
      root.querySelector(".fake").onclick = () => {
        stop();
        let raf;
        const t0 = performance.now();
        const tick = (t) => { show(Math.abs(Math.sin((t - t0) / 140)) * Math.random()); raf = requestAnimationFrame(tick); };
        raf = requestAnimationFrame(tick);
        stop = () => cancelAnimationFrame(raf);
      };
    },
  },

  {
    id: "island",
    nickname: "The Island Hopper",
    name: "iPhone status bar with Dynamic Island",
    tags: ["phone", "css"],
    why: "Our first iPhone had its island parked on the bezel and the clock elbowing it. The fix: put the island inside the screen and split the status bar into a three-column grid, so the time and the icons each get their own \"ear\". No Wi-Fi icon, on purpose: the village has no internet.",
    usedIn: { label: "iPhone simulator", href: "/ndiedieng/" },
    html: `<div class="phone">
  <div class="screen">
    <div class="island"></div>
    <div class="status">
      <span class="ear time">09:41</span>
      <span></span>
      <span class="ear">▂▄▆ ▭</span>
    </div>
    <p class="hello">*123#</p>
  </div>
</div>`,
    css: `:host { display: grid; place-items: center; padding: 24px 0; }
.phone { width: 260px; padding: 10px; border-radius: 46px; background: #1c1c1e;
  box-shadow: inset 0 0 0 1px #6b6b70, inset 0 0 0 4px #2c2c2e, 0 18px 40px rgba(0,0,0,.25); }
.screen { position: relative; height: 170px; border-radius: 36px; background: #fff; overflow: hidden;
  font-family: -apple-system, system-ui, sans-serif; }
.island { position: absolute; top: 8px; left: 50%; translate: -50% 0; width: 84px; height: 25px;
  border-radius: 13px; background: #000; z-index: 2; }
.status { display: grid; grid-template-columns: 1fr 92px 1fr; align-items: center; height: 40px; font-size: 14px; font-weight: 600; }
.ear { display: flex; justify-content: center; letter-spacing: -.02em; }
.time { padding-left: 8px; }
.hello { margin: 34px 0 0; text-align: center; font-size: 30px; font-weight: 300; }`,
    js: function setup(root) {
      const time = root.querySelector(".time");
      const tick = () => (time.textContent = new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }));
      tick();
      setInterval(tick, 30_000);
    },
  },

  {
    id: "brick",
    nickname: "The Brick",
    name: "Keypad phone with USSD",
    tags: ["phone", "keyboard"],
    why: "Most phones in the villages look like this, so the demo has to work on this first. A green-grey screen, real keys, and your computer keyboard works too. Dial *123# and press the green key.",
    usedIn: { label: "Simple phone", href: "/ndiedieng/" },
    html: `<div class="brick" tabindex="0" aria-label="Keypad phone: type digits, Enter to call">
  <div class="lcd" aria-live="polite"></div>
  <div class="keys"></div>
</div>`,
    css: `:host { display: grid; place-items: center; padding: 20px 0; }
.brick { width: 200px; padding: 16px 14px 18px; border-radius: 30px 30px 36px 36px; outline: none;
  background: linear-gradient(160deg, #3a4048, #20242a); box-shadow: 0 16px 34px rgba(0,0,0,.28); }
.brick:focus-visible { box-shadow: 0 0 0 3px #b5501b, 0 16px 34px rgba(0,0,0,.28); }
.lcd { height: 112px; padding: 6px 8px; border-radius: 6px; white-space: pre-wrap; overflow: hidden;
  background: linear-gradient(#cfe0b4, #b9cf97); color: #1d2a12; font: 12px/1.3 ui-monospace, monospace;
  box-shadow: inset 0 2px 6px rgba(0,0,0,.25); }
.keys { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-top: 12px; }
.keys button { min-height: 32px; border: 0; border-radius: 10px; background: #e9ecef; font: 600 15px system-ui; cursor: pointer; }
.keys .call { background: #2f8f4e; color: #fff; }
.keys .end { background: #b33a3a; color: #fff; }
.keys button:active { transform: translateY(1px); filter: brightness(.92); }`,
    js: function setup(root) {
      const lcd = root.querySelector(".lcd");
      let typed = "";
      const MENU = "Mairie de Ndiédieng\n1. Signaler une panne\n2. Naissance\n3. Décès\n4. Suivre";
      const draw = () => (lcd.textContent = typed ? `\n\n${typed}_` : "▂▄▆ SN        09:41\n\n\n  Composez *123#");
      const press = (k) => {
        if (k === "call") { lcd.textContent = typed === "*123#" ? MENU : "Code inconnu.\nEssayez *123#"; typed = ""; return; }
        if (k === "end") { typed = ""; return draw(); }
        typed += k;
        draw();
      };
      root.querySelector(".keys").append(
        ...["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#", "call", "end"].map((k) => {
          const b = Object.assign(document.createElement("button"), { textContent: k === "call" ? "📞" : k === "end" ? "✕" : k });
          if (k === "call" || k === "end") b.className = k;
          b.onclick = () => press(k);
          return b;
        }),
      );
      root.querySelector(".brick").onkeydown = (e) => {
        if (/^[0-9*#]$/.test(e.key)) press(e.key);
        else if (e.key === "Enter") press("call");
        else if (e.key === "Escape" || e.key === "Backspace") press("end");
      };
      draw();
    },
  },

  {
    id: "fit",
    nickname: "The Shrink Ray",
    name: "Fit-to-container scaling",
    tags: ["layout"],
    why: "A phone is 620 px tall; a laptop screen, after the browser has eaten its share, often isn't. Instead of making the page scroll, the phone shrinks to whatever room is left. Drag the corner of the box to zap it.",
    usedIn: { label: "Village side", href: "/ndiedieng/" },
    html: `<div class="stage">
  <div class="fit"><div class="device">300 × 620</div></div>
</div>
<p class="note" aria-live="polite"></p>`,
    css: `:host { display: grid; justify-items: center; gap: 10px; padding: 18px 12px; }
.stage { position: relative; width: 300px; height: 230px; min-width: 120px; min-height: 120px; max-width: 100%;
  resize: both; overflow: hidden; border: 2px dashed #d8cfc1; border-radius: 12px; background: #fff; }
.fit { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%) scale(var(--fit, 1)); }
.device { width: 300px; height: 620px; border-radius: 44px; display: grid; place-items: center;
  background: #1c1c1e; color: #fff; font: 600 22px system-ui; box-shadow: inset 0 0 0 10px #2c2c2e; }
.note { margin: 0; font-size: 13px; color: #6b7a71; font-variant-numeric: tabular-nums; }`,
    js: function setup(root) {
      const stage = root.querySelector(".stage");
      const fit = root.querySelector(".fit");
      new ResizeObserver(() => {
        // The largest scale at which the whole device still fits, never above 1.
        const s = Math.min(1, (stage.clientHeight - 8) / 620, (stage.clientWidth - 8) / 300);
        fit.style.setProperty("--fit", String(Math.max(0.1, s)));
        root.querySelector(".note").textContent = `scale ${s.toFixed(2)}`;
      }).observe(stage);
    },
  },

  {
    id: "patience",
    nickname: "The Patience Timer",
    name: "Dictation watchdog",
    tags: ["voice", "reliability"],
    why: "Some browsers offer speech recognition and then simply never start it, leaving you shouting at a page that isn't listening. We give it 5 seconds to show signs of life, then stop politely and say which browsers do work.",
    usedIn: { label: "Every microphone button", href: "/ndiedieng/assistant/" },
    html: `<button class="go">Start a dictation that never starts</button>
<p class="out" aria-live="polite">Waiting for you to press the button.</p>`,
    css: `:host { display: grid; justify-items: center; gap: 14px; padding: 40px 16px; text-align: center; }
.go { padding: 10px 16px; border: 1px solid #dfe5e1; border-radius: 99px; background: #fff; font: inherit; cursor: pointer; }
.out { margin: 0; min-height: 40px; max-width: 340px; font-size: 14px; color: #47564d; }`,
    js: function setup(root) {
      const out = root.querySelector(".out");
      // The real thing wraps the browser's SpeechRecognition; here, one that hangs.
      const brokenRecognition = { start() {}, abort() {}, onaudiostart: null };
      function listenWithTimeout(recognition, ms, onGiveUp) {
        let started = false;
        recognition.onaudiostart = () => (started = true);
        const watchdog = setTimeout(() => {
          if (started) return;
          recognition.abort();
          onGiveUp();
        }, ms);
        recognition.start();
        return () => clearTimeout(watchdog);
      }
      root.querySelector(".go").onclick = () => {
        let left = 5;
        out.textContent = "Listening… 5";
        const count = setInterval(() => (out.textContent = left > 1 ? `Listening… ${--left}` : out.textContent), 1000);
        listenWithTimeout(brokenRecognition, 5000, () => {
          clearInterval(count);
          out.textContent = "This browser shows dictation but doesn't run it. Try Chrome, Edge or Safari.";
        });
      };
    },
  },

  {
    id: "csv",
    nickname: "The Spreadsheet Butler",
    name: "CSV export that opens right in French Excel",
    tags: ["data"],
    why: "A CSV with commas opens in French Excel as one sad column, and \"Décès\" turns into \"DÃ©cÃ¨s\". Semicolons and a byte-order mark fix both. Phone numbers stay masked: a spreadsheet travels further than you think.",
    usedIn: { label: "Exporter button", href: "/ndiedieng/" },
    html: `<button class="go">Download a sample</button>
<pre class="peek"></pre>`,
    css: `:host { display: grid; justify-items: center; gap: 12px; padding: 26px 12px; }
.go { padding: 10px 16px; border: 0; border-radius: 10px; background: #0b6b45; color: #fff; font: inherit; font-weight: 600; cursor: pointer; }
.peek { margin: 0; max-width: 100%; overflow: auto; padding: 10px 12px; border-radius: 8px; background: #fff;
  border: 1px solid #e8e2d8; font: 12px/1.5 ui-monospace, monospace; }`,
    js: function setup(root) {
      const rows = [
        ["Signalement", "Village", "Catégorie", "Statut", "Téléphone (masqué)"],
        ["S-0042", "Village 12", "Eau", "En cours", "+221 •• ••• •• 12"],
        ["S-0043", "Village 08", "Décès", "Nouveau", "+221 •• ••• •• 08"],
      ];
      const cell = (v) => (/[;"\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
      const csv = rows.map((r) => r.map(cell).join(";")).join("\r\n");
      root.querySelector(".peek").textContent = csv;
      root.querySelector(".go").onclick = () => {
        // "﻿" first: the byte-order mark that tells Excel it is UTF-8.
        const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
        const a = Object.assign(document.createElement("a"), { href: url, download: "signalements.csv" });
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      };
    },
  },
];
