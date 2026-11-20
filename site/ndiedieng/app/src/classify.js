/**
 * Sorting a free-text SMS: what kind of report it is, which equipment, how
 * urgent. A USSD report needs none of this, since the chief picks from menus.
 *
 * Two classifiers with one shape. `keywordClassifier` needs nothing: words
 * and rules, readable and predictable. `geminiClassifier` asks Gemini for the
 * same fields in a fixed JSON shape, and falls back to the keywords if Gemini
 * fails. Either way, a low confidence sends the report to "a verifier", where
 * someone at the Mairie decides.
 */
export const REVIEW_BELOW = 0.6;
/** Lower case, no accents, single spaces: what the keyword rules compare. */
export function fold(text) {
    return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/['’]/g, " ").replace(/\s+/g, " ").trim();
}
const WORDS = [
    { categorie: "eau", nature: "forage", words: ["forage", "pompe", "chateau d eau"] },
    { categorie: "eau", nature: "borne-fontaine", words: ["borne", "fontaine", "robinet"] },
    { categorie: "eau", words: ["eau", "puits"] },
    { categorie: "sante", nature: "poste de sante", words: ["poste de sante", "infirmier", "infirmiere", "maternite"] },
    { categorie: "sante", nature: "case de sante", words: ["case de sante", "matrone"] },
    { categorie: "sante", words: ["sante", "medicament", "sage-femme", "sage femme"] },
    { categorie: "ecole", nature: "salle de classe", words: ["salle de classe", "classe", "table-banc", "table banc", "toit de l ecole"] },
    { categorie: "ecole", nature: "latrines", words: ["latrine", "toilette"] },
    { categorie: "ecole", words: ["ecole", "enseignant", "eleve"] },
    { categorie: "energie", nature: "lampadaire solaire", words: ["lampadaire", "eclairage", "panneau solaire", "solaire"] },
    { categorie: "energie", words: ["electricite", "lumiere", "courant"] },
    { categorie: "piste", nature: "piste", words: ["piste", "route", "pont", "chemin", "radier"] },
    { categorie: "naissance", words: ["naissance", "accouche", "nouveau-ne", "nouveau ne", "bebe"] },
    { categorie: "deces", words: ["deces", "decede", "decedee", "mort", "morte", "enterrement"] },
];
const URGENT = ["urgent", "urgence", "grave", "plus d eau", "pas d eau", "plus du tout", "depuis", "tout le village", "malade", "bloque", "coupee", "coupe", "inonde", "danger"];
const has = (folded, word) => new RegExp(`(^|[^a-z])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(folded);
/** Words and rules: no network, the same answer every time. */
export function keywordClassifier() {
    return {
        async classify(text) {
            const t = fold(text);
            const scores = new Map();
            let nature = null;
            for (const rule of WORDS) {
                const hits = rule.words.filter((w) => has(t, w)).length;
                if (!hits)
                    continue;
                // A named equipment counts more than a general word.
                scores.set(rule.categorie, (scores.get(rule.categorie) ?? 0) + hits * (rule.nature ? 2 : 1));
                if (rule.nature && !nature)
                    nature = rule.nature;
            }
            const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
            const [best, second] = ranked;
            if (!best)
                return { categorie: "autre", nature: null, urgence: "moyenne", confiance: 0.2, par: "mots-cles" };
            const categorie = best[0];
            if (nature && !WORDS.some((r) => r.categorie === categorie && r.nature === nature))
                nature = null;
            // Clear when one category leads; doubtful when two are close.
            const confiance = second ? Math.min(0.9, 0.5 + (best[1] - second[1]) * 0.15) : Math.min(0.95, 0.65 + best[1] * 0.1);
            return { categorie, nature, urgence: urgency(categorie, t), confiance: Number(confiance.toFixed(2)), par: "mots-cles" };
        },
    };
}
/** The Mairie's rules: water and health are urgent by default; urgent words raise anything. */
export function urgency(categorie, folded) {
    if (URGENT.some((w) => has(folded, w)))
        return "haute";
    if (categorie === "eau" || categorie === "sante")
        return "haute";
    if (categorie === "piste" || categorie === "naissance" || categorie === "deces")
        return "moyenne";
    return "basse";
}
const CATEGORIES = ["eau", "sante", "ecole", "energie", "piste", "naissance", "deces", "autre"];
const NATURE_LIST = ["forage", "borne-fontaine", "poste de sante", "case de sante", "salle de classe", "latrines", "lampadaire solaire", "piste"];
/**
 * Gemini, asked for the same fields in a fixed JSON shape. The key goes in a
 * header; only the message text is sent, never the sender's number. On any
 * failure it falls back to the keywords, so a report is never lost.
 */
export function geminiClassifier(options) {
    const fallback = keywordClassifier();
    const doFetch = options.fetch ?? fetch;
    const model = options.model ?? "gemini-3.5-flash-lite";
    const warn = options.warn ?? ((m) => console.warn(m));
    return {
        async classify(text) {
            try {
                const res = await doFetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
                    method: "POST",
                    headers: { "content-type": "application/json", "x-goog-api-key": options.apiKey },
                    body: JSON.stringify({
                        systemInstruction: {
                            parts: [
                                {
                                    text: "Tu classes les messages SMS envoyes par les chefs de village de la commune de Ndiedieng (Senegal) a la Mairie. " +
                                        "Le message peut etre en francais ou en wolof, avec des fautes. Categories : eau (forage, borne-fontaine), sante (poste ou case de sante), " +
                                        "ecole (salle de classe, latrines), energie (lampadaire solaire), piste (piste coupee, pont), naissance, deces, autre. " +
                                        "Urgence haute si un service essentiel est coupe pour beaucoup de gens ou s'il y a un danger. " +
                                        "confiance : ta certitude entre 0 et 1 ; sois honnete quand le message est ambigu.",
                                },
                            ],
                        },
                        contents: [{ role: "user", parts: [{ text }] }],
                        generationConfig: {
                            responseMimeType: "application/json",
                            responseJsonSchema: {
                                type: "object",
                                properties: {
                                    categorie: { type: "string", enum: CATEGORIES },
                                    nature: { type: "string", enum: [...NATURE_LIST, "aucune"] },
                                    urgence: { type: "string", enum: ["haute", "moyenne", "basse"] },
                                    confiance: { type: "number" },
                                },
                                required: ["categorie", "nature", "urgence", "confiance"],
                            },
                        },
                    }),
                    signal: AbortSignal.timeout(8000),
                });
                if (!res.ok)
                    throw new Error(`Gemini answered ${res.status}`);
                const data = (await res.json());
                const raw = (data.candidates?.[0]?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? "").join("");
                const out = JSON.parse(raw);
                if (!CATEGORIES.includes(out.categorie))
                    throw new Error(`unknown category ${out.categorie}`);
                return {
                    categorie: out.categorie,
                    nature: NATURE_LIST.includes(out.nature) ? out.nature : null,
                    urgence: ["haute", "moyenne", "basse"].includes(out.urgence) ? out.urgence : urgency(out.categorie, fold(text)),
                    confiance: Math.max(0, Math.min(1, Number(out.confiance) || 0)),
                    par: "gemini",
                };
            }
            catch (err) {
                warn(`[ndiedieng] Gemini classification failed (${err instanceof Error ? err.message : String(err)}); using keywords`);
                return fallback.classify(text);
            }
        },
    };
}
