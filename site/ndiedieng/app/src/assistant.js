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
import { directGemini } from "./gemini.js";
const FORBIDDEN = /\b(insert|update|delete|drop|create|alter|replace|attach|detach|pragma|vacuum|reindex|analyze|begin|commit|rollback|savepoint|load_extension|writefile|readfile)\b/i;
/** Null when the query may run; otherwise why not. One read-only SELECT (or WITH), nothing else. */
export function checkQuery(sql) {
    const q = sql.trim().replace(/;\s*$/, "");
    if (!/^(select|with)\b/i.test(q))
        return "only a SELECT can run";
    if (q.includes(";"))
        return "only one statement can run";
    if (FORBIDDEN.test(q))
        return "the query uses a forbidden keyword";
    return null;
}
/** Runs a checked query where it cannot change anything. */
function runReadOnly(commune, sql, limit = 200) {
    const problem = checkQuery(sql);
    if (problem)
        throw new Error(problem);
    const { columns, rows } = commune.readOnly(sql.trim().replace(/;\s*$/, ""));
    return { columns, rows: rows.slice(0, limit) };
}
const n = (v) => Number(v ?? 0);
const INTENTS = [
    {
        match: [/forage/, /panne/],
        sql: `SELECT v.nom AS village, s.code, s.urgence, CAST(julianday('now') - julianday(s.cree_le) AS INTEGER) AS jours
FROM signalements s JOIN villages v ON v.id = s.village_id JOIN equipements e ON e.id = s.equipement_id
WHERE e.nature = 'forage' AND s.statut != 'resolu' ORDER BY jours DESC`,
        say: (rows) => rows.length
            ? `${rows.length} forage(s) en panne non résolue(s). Le plus ancien : ${rows[0]["village"]}, signalé il y a ${rows[0]["jours"]} jour(s).`
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
        say: (rows) => rows.length
            ? `Villages avec le plus de pannes non résolues : ${rows[0]["village"]} en tête (${rows[0]["pannes"]}). Les ${rows.length} premiers sont listés.`
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
        say: (rows) => `Les villages les plus peuplés (données des fiches) : ${rows[0]["village"]} en tête avec ${rows[0]["population"]} habitants.`,
    },
];
export const EXAMPLES = [
    "Quels forages sont en panne ?",
    "Quels villages ont le plus de pannes ?",
    "Combien de naissances ce mois-ci ?",
    "Quels signalements urgents sont en attente ?",
    "Combien de fiches sont à mettre à jour ?",
];
/** Greetings, thanks and "what can you do": answered warmly, with questions to try. */
const SMALL_TALK = [
    { match: /\b(merci|jerejef|thanks?|thank you)\b/, say: "Avec plaisir. Une autre question sur la commune ?" },
    {
        match: /\b(aide|help|que (sais|peux)|qui es|tu fais quoi|comment ca marche)\b/,
        say: "Je réponds aux questions sur la commune : les pannes et les signalements, les naissances et les décès, la population et les fiches des villages. Chaque réponse montre les données utilisées. Par exemple :",
    },
    {
        match: /\b(bonjour|bonsoir|salut|hello|hi|hey|coucou|salam|salamalekum|nanga def|na nga def)\b/,
        say: "Bonjour ! Je suis l'assistant de la Mairie de Ndiédieng. Posez-moi une question sur les villages, par exemple :",
    },
];
/** Common questions, answered by queries written in advance. No network. */
export function ruleAssistant(commune) {
    return {
        async ask(question) {
            const q = fold(question);
            const talk = SMALL_TALK.find((t) => t.match.test(q) && q.split(" ").length <= 6);
            if (talk)
                return { answer: talk.say, sql: null, columns: [], rows: [], par: "regles", suggestions: EXAMPLES.slice(0, 4) };
            const intent = INTENTS.find((i) => i.match.every((re) => re.test(q)));
            if (!intent) {
                return {
                    answer: "Je ne sais pas encore répondre à celle-ci. Dans cette démonstration, je connais les pannes, les signalements, " +
                        "les naissances et décès, la population et les fiches des villages. Essayez par exemple :",
                    sql: null,
                    columns: [],
                    rows: [],
                    par: "regles",
                    suggestions: EXAMPLES.slice(0, 4),
                };
            }
            const { columns, rows } = runReadOnly(commune, intent.sql);
            return { answer: intent.say(rows), sql: intent.sql, columns, rows, par: "regles" };
        },
    };
}
/**
 * Free questions through Gemini: it writes a query from the schema, the query
 * is checked and run read-only, then Gemini answers from the rows. Falls back
 * to the rules when anything fails.
 */
export function geminiAssistant(commune, options) {
    const rules = ruleAssistant(commune);
    const call = "call" in options ? options.call : directGemini(options);
    return {
        async ask(question) {
            try {
                const plan = (await call({ task: "plan", question }));
                const langue = plan.langue === "wo" ? "wo" : "fr";
                const sql = String(plan.sql ?? "").trim();
                if (!sql) {
                    const reponse = String(plan.reponse ?? "").trim();
                    return {
                        answer: reponse || "Les fiches et signalements ne contiennent pas de quoi répondre à cette question.",
                        sql: null,
                        columns: [],
                        rows: [],
                        par: "gemini",
                        langue,
                        ...(reponse ? {} : { suggestions: EXAMPLES.slice(0, 4) }),
                    };
                }
                const { columns, rows } = runReadOnly(commune, sql);
                const written = (await call({ task: "answer", question, sql, rows: rows.slice(0, 50), langue }));
                return { answer: String(written.reponse ?? "").trim() || "Voici les données trouvées.", sql, columns, rows, par: "gemini", langue };
            }
            catch (err) {
                // The rules answer instead; the reason stays in the console, not in front of the Mayor.
                console.warn(`[ndiedieng] Gemini unavailable (${err instanceof Error ? err.message : String(err)}); answering by rules`);
                return rules.ask(question);
            }
        },
    };
}
