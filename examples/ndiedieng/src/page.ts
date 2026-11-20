/**
 * The demo page. Plain HTML, CSS and a little JavaScript, no build step.
 * Every value from the server is put on the page with textContent, never as
 * HTML, so a report's text cannot inject markup into the dashboard.
 */

export function demoPage(options: { code: string; mode: string }): string {
  const code = options.code.replace(/[^*#0-9]/g, "");
  const mode = options.mode.replace(/[<>&"]/g, "");
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ndiédieng · prototype Kalangu</title>
<style>
:root { --ink:#16201b; --muted:#5b6b62; --line:#d9e1dc; --bg:#f4f7f5; --card:#fff; --accent:#0d6b45; --accent-soft:#e3f2ea; --haute:#b42318; --haute-soft:#fde8e6; --moyenne:#9a5b00; --moyenne-soft:#fff1d6; --basse:#3b5b4c; --basse-soft:#e8efeb; }
* { box-sizing: border-box; }
body { margin: 0; font: 15px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; color: var(--ink); background: var(--bg); }
header { padding: 18px 24px; background: var(--card); border-bottom: 1px solid var(--line); display: flex; justify-content: space-between; align-items: baseline; gap: 16px; flex-wrap: wrap; }
header h1 { margin: 0; font-size: 20px; }
header p { margin: 0; color: var(--muted); font-size: 13px; }
.fictif { font-size: 12px; color: var(--moyenne); background: var(--moyenne-soft); padding: 3px 8px; border-radius: 99px; }
main { display: grid; grid-template-columns: 340px 1fr; gap: 24px; padding: 24px; max-width: 1400px; margin: 0 auto; }
main > section, .right > * { min-width: 0; }
@media (max-width: 900px) { main { grid-template-columns: 1fr; padding: 16px; } }
h2 { font-size: 15px; margin: 0 0 12px; }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 16px; }
.phone { background: #1d2420; border-radius: 28px; padding: 18px; color: #e9efe9; }
.phone label { font-size: 12px; color: #aab8ae; }
.phone select, .phone input { width: 100%; font: inherit; padding: 8px 10px; border-radius: 8px; border: 1px solid #3c4740; background: #2a332d; color: #e9efe9; }
.screen { margin: 12px 0; min-height: 168px; background: #c9d8b6; color: #1b2614; font: 14px/1.4 ui-monospace, Menlo, monospace; border-radius: 6px; padding: 10px 12px; white-space: pre-wrap; }
.screen.end { outline: 2px solid #8aa070; }
.keys { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 10px 0; }
.keys button, .row button { font: inherit; padding: 10px; border-radius: 10px; border: 0; background: #39443d; color: #fff; cursor: pointer; }
.keys button:hover, .row button:hover { background: #4a574e; }
.row { display: flex; gap: 8px; margin-top: 8px; }
.row button { flex: 1; }
.row button.go { background: #2e8b57; }
.row button.stop { background: #9b2c2c; }
.inbox { margin-top: 14px; }
.sms { background: #2a332d; border-radius: 10px; padding: 8px 10px; margin-top: 6px; font-size: 13px; }
.sms b { color: #9fd6b3; font-weight: 600; }
.hint { font-size: 12px; color: #aab8ae; margin-top: 6px; }
.counters { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 16px; }
.counter { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px; }
.counter strong { display: block; font-size: 26px; line-height: 1.1; }
.counter span { color: var(--muted); font-size: 13px; }
.counter.alert strong { color: var(--haute); }
.filters { display: flex; gap: 8px; margin-bottom: 10px; flex-wrap: wrap; }
.filters select { font: inherit; padding: 6px 8px; border-radius: 8px; border: 1px solid var(--line); background: #fff; }
table { width: 100%; border-collapse: collapse; font-size: 14px; }
th { text-align: left; color: var(--muted); font-weight: 500; font-size: 12px; padding: 6px 8px; border-bottom: 1px solid var(--line); }
td { padding: 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
tr.new td { background: var(--accent-soft); }
.badge { display: inline-block; font-size: 12px; padding: 2px 8px; border-radius: 99px; white-space: nowrap; }
.u-haute { color: var(--haute); background: var(--haute-soft); }
.u-moyenne { color: var(--moyenne); background: var(--moyenne-soft); }
.u-basse { color: var(--basse); background: var(--basse-soft); }
.s-a_verifier { color: var(--moyenne); background: var(--moyenne-soft); }
.s-resolu { color: var(--accent); background: var(--accent-soft); }
.small { color: var(--muted); font-size: 12px; }
td button, .ask button, td select { font: inherit; font-size: 13px; padding: 5px 10px; border-radius: 8px; border: 1px solid var(--line); background: #fff; cursor: pointer; }
td button.primary, .ask button { background: var(--accent); color: #fff; border-color: var(--accent); }
.tablewrap { max-height: 460px; overflow: auto; }
.tablewrap table { min-width: 760px; }
td.nowrap, .nowrap { white-space: nowrap; }
.ask { display: flex; gap: 8px; }
.ask input { flex: 1; font: inherit; padding: 9px 12px; border-radius: 10px; border: 1px solid var(--line); }
.chips { display: flex; gap: 6px; flex-wrap: wrap; margin: 10px 0; }
.chips button { font: inherit; font-size: 12px; padding: 4px 10px; border-radius: 99px; border: 1px solid var(--line); background: #fff; cursor: pointer; }
.answer { margin-top: 12px; font-size: 15px; }
details { margin-top: 8px; }
pre { background: #f0f3f1; padding: 10px; border-radius: 8px; overflow: auto; font-size: 12px; }
.right { display: grid; gap: 24px; align-content: start; }
@media (max-width: 900px) { .counters { grid-template-columns: repeat(2, 1fr); } }
</style>
</head>
<body>
<header>
  <div><h1>Commune de Ndiédieng · alertes sans internet</h1><p>Prototype construit avec Kalangu · ${mode}</p></div>
  <span class="fictif">Données fictives : 58 villages, 200 équipements, 499 fiches</span>
</header>
<main>
  <section>
    <div class="phone">
      <label for="chef">Téléphone du chef de village</label>
      <select id="chef"></select>
      <div id="screen" class="screen">Composez ${code} pour appeler la Mairie.</div>
      <input id="entry" placeholder="Saisie (chiffres ou texte)" autocomplete="off">
      <div class="keys" id="keys"></div>
      <div class="row"><button class="go" id="send">Appeler / Envoyer</button><button class="stop" id="hangup">Raccrocher</button></div>
      <div class="inbox">
        <label for="smsText">SMS à la Mairie</label>
        <div class="row" style="margin-top:4px"><input id="smsText" placeholder="ex. le forage est en panne depuis hier"><button id="smsSend" style="flex:0 0 auto">SMS</button></div>
        <div class="hint">Un SMS sans menu ouvert reçoit le menu ; choisissez 5 pour écrire librement.</div>
        <div id="inbox"></div>
      </div>
    </div>
  </section>
  <section class="right">
    <div>
      <div class="counters">
        <div class="counter"><strong id="c-nouveau">0</strong><span>nouveaux</span></div>
        <div class="counter"><strong id="c-a_verifier">0</strong><span>à vérifier</span></div>
        <div class="counter"><strong id="c-en_cours">0</strong><span>en cours</span></div>
        <div class="counter alert"><strong id="c-haute">0</strong><span>urgents non résolus</span></div>
      </div>
      <div class="card">
        <h2>Signalements reçus</h2>
        <div class="filters">
          <select id="fStatut"><option value="">Tous les statuts</option><option value="nouveau">Nouveaux</option><option value="a_verifier">À vérifier</option><option value="en_cours">En cours</option><option value="resolu">Résolus</option></select>
          <select id="fCat"><option value="">Toutes les catégories</option><option value="eau">Eau</option><option value="sante">Santé</option><option value="ecole">École</option><option value="energie">Énergie</option><option value="piste">Piste</option><option value="naissance">Naissance</option><option value="deces">Décès</option><option value="autre">Autre</option></select>
        </div>
        <div class="tablewrap"><table><thead><tr><th>N°</th><th>Village</th><th>Catégorie</th><th>Urgence</th><th>Description</th><th>Reçu</th><th>Statut</th><th></th></tr></thead><tbody id="rows"></tbody></table></div>
      </div>
    </div>
    <div class="card">
      <h2>Assistant territorial</h2>
      <div class="ask"><input id="question" placeholder="Posez une question sur les fiches et les signalements"><button id="askBtn">Demander</button></div>
      <div class="chips" id="chips"></div>
      <div class="answer" id="answer"></div>
      <div id="details"></div>
    </div>
  </section>
</main>
<script>
const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(props)) { if (k === "class") e.className = v; else if (k.startsWith("on")) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v); } for (const c of kids) e.append(c); return e; };
const post = (url, body) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
const CAT = { eau: "Eau", sante: "Santé", ecole: "École", energie: "Énergie", piste: "Piste", naissance: "Naissance", deces: "Décès", autre: "Autre" };
const STAT = { nouveau: "Nouveau", a_verifier: "À vérifier", en_cours: "En cours", resolu: "Résolu" };
let inSession = false, seen = new Set(), first = true;

function showPhone(res) {
  if (res.error) { $("screen").textContent = res.error; return; }
  if (res.screen) { $("screen").textContent = res.screen.text; $("screen").classList.toggle("end", res.screen.end); }
  inSession = res.inSession;
  const inbox = $("inbox"); inbox.replaceChildren();
  for (const m of res.inbox.slice().reverse()) inbox.append(el("div", { class: "sms" }, el("b", {}, m.from + " : "), m.text));
}
const phone = (action, text = "") => post("/api/phone", { telephone: $("chef").value, action, text }).then((r) => { showPhone(r); refresh(); });

for (const k of ["1","2","3","4","5","6","7","8","9","*","0","#"]) $("keys").append(el("button", { onclick: () => { $("entry").value += k; } }, k));
$("send").onclick = () => { const v = $("entry").value.trim(); $("entry").value = ""; inSession ? phone("press", v) : phone("dial", v || "${code}"); };
$("entry").onkeydown = (e) => { if (e.key === "Enter") $("send").click(); };
$("hangup").onclick = () => { $("screen").textContent = "Appel terminé. Recomposez ${code} pour reprendre où vous étiez."; $("screen").classList.remove("end"); phone("hangup"); };
$("smsSend").onclick = () => { const v = $("smsText").value.trim(); if (!v) return; $("smsText").value = ""; phone("sms", v); };
$("smsText").onkeydown = (e) => { if (e.key === "Enter") $("smsSend").click(); };
$("chef").onchange = () => { inSession = false; $("screen").textContent = "Composez ${code} pour appeler la Mairie."; phone("inbox"); };

function act(code, verb, body) { post("/api/signalements/" + code + "/" + verb, body || {}).then(() => { refresh(); phone("inbox"); }); }

function row(s) {
  const actions = el("td");
  if (s.statut === "a_verifier") {
    const cat = el("select"); for (const [k, v] of Object.entries(CAT)) { const o = el("option", { value: k }, v); if (k === s.categorie) o.selected = true; cat.append(o); }
    const urg = el("select"); for (const u of ["haute","moyenne","basse"]) { const o = el("option", { value: u }, u); if (u === s.urgence) o.selected = true; urg.append(o); }
    actions.append(cat, " ", urg, " ", el("button", { class: "primary", onclick: () => act(s.code, "verifier", { categorie: cat.value, urgence: urg.value }) }, "Valider"));
  } else if (s.statut === "nouveau") {
    actions.append(el("button", { onclick: () => act(s.code, "prendre") }, "Prendre en charge"), " ", el("button", { class: "primary", onclick: () => act(s.code, "resoudre") }, "Résolu"));
  } else if (s.statut === "en_cours") {
    actions.append(el("button", { class: "primary", onclick: () => act(s.code, "resoudre") }, "Résolu"));
  }
  const fresh = !first && !seen.has(s.code);
  const tr = el("tr", fresh ? { class: "new" } : {},
    el("td", { class: "nowrap" }, s.code, el("div", { class: "small" }, s.canal.toUpperCase())),
    el("td", { class: "nowrap" }, s.village, el("div", { class: "small" }, s.telephone)),
    el("td", {}, CAT[s.categorie] || s.categorie, s.equipement ? el("div", { class: "small" }, s.equipement) : ""),
    el("td", {}, el("span", { class: "badge u-" + s.urgence }, s.urgence)),
    el("td", {}, s.description, s.canal === "sms" && s.confiance < 1 ? el("div", { class: "small" }, "classé avec confiance " + Math.round(s.confiance * 100) + " %") : ""),
    el("td", { class: "small" }, new Date(s.creeLe).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })),
    el("td", {}, el("span", { class: "badge s-" + s.statut }, STAT[s.statut])),
    actions);
  return tr;
}

function refresh() {
  const q = new URLSearchParams(); if ($("fStatut").value) q.set("statut", $("fStatut").value); if ($("fCat").value) q.set("categorie", $("fCat").value);
  fetch("/api/signalements?" + q).then((r) => r.json()).then((d) => {
    for (const k of ["nouveau","a_verifier","en_cours","haute"]) $("c-" + k).textContent = d.counts[k];
    $("rows").replaceChildren(...d.signalements.map(row));
    for (const s of d.signalements) seen.add(s.code); first = false;
  });
}
$("fStatut").onchange = refresh; $("fCat").onchange = refresh;

function ask(question) {
  $("answer").textContent = "…"; $("details").replaceChildren();
  post("/api/ask", { question }).then((a) => {
    if (a.error) { $("answer").textContent = a.error; return; }
    $("answer").textContent = a.answer;
    if (!a.sql) return;
    const table = el("table", {}, el("thead", {}, el("tr", {}, ...a.columns.map((c) => el("th", {}, c)))), el("tbody", {}, ...a.rows.slice(0, 50).map((r) => el("tr", {}, ...a.columns.map((c) => el("td", {}, String(r[c] ?? "")))))));
    $("details").append(el("details", {}, el("summary", {}, "Données utilisées (" + a.rows.length + " ligne(s), " + (a.par === "gemini" ? "requête écrite par Gemini" : "requête prédéfinie") + ")"), el("pre", {}, a.sql), table));
  });
}
$("askBtn").onclick = () => { const q = $("question").value.trim(); if (q) ask(q); };
$("question").onkeydown = (e) => { if (e.key === "Enter") $("askBtn").click(); };
for (const q of ["Quels forages sont en panne ?", "Quels villages ont le plus de pannes ?", "Combien de naissances ce mois-ci ?", "Quels signalements urgents sont en attente ?", "Combien de fiches sont à mettre à jour ?"]) $("chips").append(el("button", { onclick: () => { $("question").value = q; ask(q); } }, q));

fetch("/api/chefs").then((r) => r.json()).then((chefs) => {
  for (const c of chefs) $("chef").append(el("option", { value: c.telephone }, c.village + " · " + c.telephone.slice(0, 4) + " •• " + c.telephone.slice(-2)));
  $("chef").value = chefs[6].telephone; phone("inbox");
});
refresh(); setInterval(refresh, 4000);
</script>
</body>
</html>`;
}
