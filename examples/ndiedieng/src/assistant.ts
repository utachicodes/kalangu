/**
 * The territorial assistant: the Mayor, the BEL or the ADL ask a question in
 * French and get an answer computed from the commune's data, with the SQL
 * that produced it, so every figure can be checked.
 *
 * Without a key it recognises the common questions and runs a query written
 * in advance for each. With Gemini, the model writes the query; it runs only
 * after `checkQuery` accepts it (one SELECT, nothing that writes), on a
 * read-only connection, and the model then answers from the rows it got back,
 * never from memory.
 */

import { fold } from "./classify.js";
import { SCHEMA, type Commune } from "./db.js";

export interface Answer {
  answer: string;
  sql: string | null;
  columns: string[];
  rows: Array<Record<string, unknown>>;
  par: "regles" | "gemini";
}

export interface Assistant {
  ask(question: string): Promise<Answer>;
}

const FORBIDDEN = /\b(insert|update|delete|drop|create|alter|replace|attach|detach|pragma|vacuum|reindex|analyze|begin|commit|rollback|savepoint|load_extension|writefile|readfile)\b/i;

/** Null when the query may run; otherwise why not. One read-only SELECT (or WITH), nothing else. */
export function checkQuery(sql: string): string | null {
  const q = sql.trim().replace(/;\s*$/, "");
  if (!/^(select|with)\b/i.test(q)) return "only a SELECT can run";
  if (q.includes(";")) return "only one statement can run";
  if (FORBIDDEN.test(q)) return "the query uses a forbidden keyword";
  return null;
}

/** Runs a checked query where it cannot change anything. */
function runReadOnly(commune: Commune, sql: string, limit = 200): { columns: string[]; rows: Array<Record<string, unknown>> } {
  const problem = checkQuery(sql);
  if (problem) throw new Error(problem);
  const { columns, rows } = commune.readOnly(sql.trim().replace(/;\s*$/, ""));
  return { columns, rows: rows.slice(0, limit) };
}

interface Intent {
  /** Every one of these folded words must appear. */
  match: RegExp[];
  sql: string;
  say: (rows: Array<Record<string, unknown>>) => string;
}

const n = (v: unknown) => Number(v ?? 0);

const INTENTS: Intent[] = [
  {
    match: [/forage/, /panne/],
    sql: `SELECT v.nom AS village, s.code, s.urgence, CAST(julianday('now') - julianday(s.cree_le) AS INTEGER) AS jours
FROM signalements s JOIN villages v ON v.id = s.village_id JOIN equipements e ON e.id = s.equipement_id
WHERE e.nature = 'forage' AND s.statut != 'resolu' ORDER BY jours DESC`,
    say: (rows) =>
      rows.length
        ? `${rows.length} forage(s) en panne non résolue(s). Le plus ancien : ${rows[0]!["village"]}, signalé il y a ${rows[0]!["jours"]} jour(s).`
        : "Aucun forage en panne non résolue.",
  },
  {
    match: [/naissance/],
    sql: `SELECT v.nom AS village, COUNT(*) AS naissances FROM signalements s JOIN villages v ON v.id = s.village_id
WHERE s.categorie = 'naissance' AND s.cree_le >= date('now', 'start of month') GROUP BY v.nom ORDER BY naissances DESC, v.nom`,
    say: (rows) => {
      const total = rows.reduce((a, r) => a + n(r["naissances"]), 0);
      return total ? `${total} naissance(s) pré-déclarée(s) ce mois-ci, dans ${rows.length} village(s).` : "Aucune naissance pré-déclarée ce mois-ci.";
    },
  },
  {
    match: [/deces|mort/],
    sql: `SELECT v.nom AS village, COUNT(*) AS deces FROM signalements s JOIN villages v ON v.id = s.village_id
WHERE s.categorie = 'deces' AND s.cree_le >= date('now', 'start of month') GROUP BY v.nom ORDER BY deces DESC, v.nom`,
    say: (rows) => {
      const total = rows.reduce((a, r) => a + n(r["deces"]), 0);
      return total ? `${total} décès pré-déclaré(s) ce mois-ci, dans ${rows.length} village(s).` : "Aucun décès pré-déclaré ce mois-ci.";
    },
  },
  {
    match: [/urgen/],
    sql: `SELECT s.code, v.nom AS village, s.categorie, s.description, s.statut FROM signalements s JOIN villages v ON v.id = s.village_id
WHERE s.urgence = 'haute' AND s.statut != 'resolu' ORDER BY s.cree_le`,
    say: (rows) => (rows.length ? `${rows.length} signalement(s) urgent(s) non résolu(s).` : "Aucun signalement urgent en attente."),
  },
  {
    match: [/village|\bou\b|quel/, /panne|signalement/],
    sql: `SELECT v.nom AS village, COUNT(*) AS pannes FROM signalements s JOIN villages v ON v.id = s.village_id
WHERE s.categorie IN ('eau', 'sante', 'ecole', 'energie', 'piste') AND s.statut != 'resolu' GROUP BY v.nom ORDER BY pannes DESC, v.nom LIMIT 10`,
    say: (rows) =>
      rows.length
        ? `Villages avec le plus de pannes non résolues : ${rows[0]!["village"]} en tête (${rows[0]!["pannes"]}). Les ${rows.length} premiers sont listés.`
        : "Aucune panne non résolue.",
  },
  {
    match: [/panne|signalement/],
    sql: `SELECT s.categorie, COUNT(*) AS non_resolus FROM signalements s
WHERE s.categorie IN ('eau', 'sante', 'ecole', 'energie', 'piste') AND s.statut != 'resolu' GROUP BY s.categorie ORDER BY non_resolus DESC`,
    say: (rows) => {
      const total = rows.reduce((a, r) => a + n(r["non_resolus"]), 0);
      return `${total} panne(s) non résolue(s), par type d'équipement.`;
    },
  },
  {
    match: [/equipement/],
    sql: `SELECT type, etat, COUNT(*) AS equipements FROM equipements GROUP BY type, etat ORDER BY type, etat`,
    say: (rows) => {
      const total = rows.reduce((a, r) => a + n(r["equipements"]), 0);
      const broken = rows.filter((r) => r["etat"] === "en panne").reduce((a, r) => a + n(r["equipements"]), 0);
      return `${total} équipements inventoriés, dont ${broken} en panne.`;
    },
  },
  {
    match: [/fiche/],
    sql: `SELECT categorie, COUNT(*) AS fiches, SUM(etat = 'a mettre a jour') AS a_mettre_a_jour FROM fiches GROUP BY categorie ORDER BY fiches DESC`,
    say: (rows) => {
      const total = rows.reduce((a, r) => a + n(r["fiches"]), 0);
      const stale = rows.reduce((a, r) => a + n(r["a_mettre_a_jour"]), 0);
      return `${total} fiches territoriales, dont ${stale} à mettre à jour.`;
    },
  },
  {
    match: [/population|habitant/],
    sql: `SELECT nom AS village, population FROM villages ORDER BY population DESC LIMIT 10`,
    say: (rows) => `Les villages les plus peuplés (données des fiches) : ${rows[0]!["village"]} en tête avec ${rows[0]!["population"]} habitants.`,
  },
];

export const EXAMPLES = [
  "Quels forages sont en panne ?",
  "Quels villages ont le plus de pannes ?",
  "Combien de naissances ce mois-ci ?",
  "Quels signalements urgents sont en attente ?",
  "Combien de fiches sont à mettre à jour ?",
];

/** Common questions, answered by queries written in advance. No network. */
export function ruleAssistant(commune: Commune): Assistant {
  return {
    async ask(question) {
      const q = fold(question);
      const intent = INTENTS.find((i) => i.match.every((re) => re.test(q)));
      if (!intent) {
        return {
          answer: `Sans IA en ligne, je reconnais les questions courantes, par exemple : ${EXAMPLES.join(" / ")}. Avec une clé Gemini, je réponds aux questions libres.`,
          sql: null,
          columns: [],
          rows: [],
          par: "regles",
        };
      }
      const { columns, rows } = runReadOnly(commune, intent.sql);
      return { answer: intent.say(rows), sql: intent.sql, columns, rows, par: "regles" };
    },
  };
}

async function gemini(apiKey: string, model: string, doFetch: typeof fetch, system: string, user: string, schema: object): Promise<unknown> {
  const res = await doFetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: { responseMimeType: "application/json", responseJsonSchema: schema },
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Gemini answered ${res.status}`);
  const data = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }> };
  return JSON.parse((data.candidates?.[0]?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? "").join(""));
}

/**
 * Free questions through Gemini: it writes a query from the schema, the query
 * is checked and run read-only, then Gemini answers from the rows. Falls back
 * to the rules when anything fails.
 */
export function geminiAssistant(commune: Commune, options: { apiKey: string; model?: string; fetch?: typeof fetch }): Assistant {
  const rules = ruleAssistant(commune);
  const model = options.model ?? "gemini-3.5-flash-lite";
  const doFetch = options.fetch ?? fetch;
  return {
    async ask(question) {
      try {
        const plan = (await gemini(
          options.apiKey,
          model,
          doFetch,
          "Tu traduis des questions sur la commune de Ndiedieng en une requete SQLite. Une seule requete SELECT, en lecture seule. " +
            "Utilise uniquement ces tables (les valeurs texte sont en minuscules, sans accents) :\n" +
            SCHEMA +
            "\nDate du jour : date('now'). Limite a 200 lignes. Si la question ne peut pas etre traitee avec ces donnees, sql = \"\".",
          question,
          { type: "object", properties: { sql: { type: "string" } }, required: ["sql"] },
        )) as { sql: string };
        if (!plan.sql.trim()) {
          return { answer: "Les fiches et signalements ne contiennent pas de quoi répondre à cette question.", sql: null, columns: [], rows: [], par: "gemini" };
        }
        const { columns, rows } = runReadOnly(commune, plan.sql);
        const written = (await gemini(
          options.apiKey,
          model,
          doFetch,
          "Tu reponds au Maire en francais, en une ou deux phrases, uniquement a partir des resultats fournis. N'invente aucun chiffre. " +
            "Si les resultats sont vides, dis-le.",
          `Question : ${question}\nRequete : ${plan.sql}\nResultats (JSON, au plus 50 lignes) : ${JSON.stringify(rows.slice(0, 50))}`,
          { type: "object", properties: { reponse: { type: "string" } }, required: ["reponse"] },
        )) as { reponse: string };
        return { answer: written.reponse, sql: plan.sql, columns, rows, par: "gemini" };
      } catch (err) {
        const fallback = await rules.ask(question);
        return { ...fallback, answer: `${fallback.answer} (Gemini indisponible : ${err instanceof Error ? err.message : String(err)})` };
      }
    },
  };
}
