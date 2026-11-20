/**
 * The Kalangu agent the village chiefs reach by USSD or SMS: report a
 * breakdown, declare a birth or a death, follow a report, or write freely.
 *
 * The village is never asked for: it comes from the caller's number, which
 * must be a registered chief's. Every report gets a tracking number, and the
 * Mairie's answer comes back by SMS (see app.ts).
 */
import { ask, createAgent, menu } from "@kalangu/core";
import { REVIEW_BELOW } from "./classify.js";
const LABELS = {
    eau: "eau",
    sante: "santé",
    ecole: "école",
    energie: "énergie",
    piste: "piste",
    naissance: "naissance",
    deces: "décès",
    autre: "autre",
};
export const NOT_REGISTERED = "Ce numéro n'est pas enregistré comme chef de village. Contactez la Mairie pour l'ajouter.";
/**
 * A free-text message from a chief (an SMS, or a voice message once
 * transcribed): sorted, recorded, and the reply to send back. Null when the
 * number is not a registered chief's.
 */
export async function recordFreeText(commune, classifier, telephone, text, canal) {
    const chef = commune.chefByPhone(telephone);
    if (!chef)
        return null;
    const c = await classifier.classify(text);
    const equipement = c.nature ? commune.equipementFor(chef.villageId, c.nature) : null;
    const review = c.confiance < REVIEW_BELOW || c.categorie === "autre";
    const s = commune.addSignalement({
        villageId: chef.villageId,
        telephone: chef.telephone,
        categorie: c.categorie,
        equipementId: equipement?.id ?? null,
        urgence: c.urgence,
        description: text.trim().slice(0, 300),
        canal,
        statut: review ? "a_verifier" : "nouveau",
        confiance: c.confiance,
    });
    const reply = review
        ? `Message reçu (${s.code}). La Mairie va le vérifier et vous répondra par SMS.`
        : `Message reçu (${s.code}) : ${LABELS[c.categorie]}${c.nature ? `, ${c.nature}` : ""}, urgence ${c.urgence}. Merci.`;
    return { signalement: s, reply };
}
/** A date typed as JJ/MM/AAAA, not in the future, as YYYY-MM-DD; null otherwise. */
export function parseDate(text, today = new Date()) {
    const m = /^\s*(\d{1,2})[/.\- ](\d{1,2})[/.\- ](\d{4})\s*$/.exec(text);
    if (!m)
        return null;
    const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const date = new Date(Date.UTC(y, mo - 1, d));
    if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d)
        return null;
    if (date.getTime() > today.getTime() || y < 1900)
        return null;
    return date.toISOString().slice(0, 10);
}
export function createNdiediengAgent(options) {
    const { commune, classifier, ...rest } = options;
    const chefOf = (ctx) => commune.chefByPhone(ctx.phone);
    const canal = (ctx) => (ctx.channelKind === "ussd" ? "ussd" : "sms");
    // --- A breakdown: type, then equipment, then urgency.
    const recordBreakdown = (urgence) => (_, ctx) => {
        const chef = chefOf(ctx);
        if (!chef)
            return NOT_REGISTERED;
        const type = String(ctx.session["type"] ?? "autre");
        const nature = String(ctx.session["nature"] ?? "");
        const equipement = nature ? commune.equipementFor(chef.villageId, nature) : null;
        const s = commune.addSignalement({
            villageId: chef.villageId,
            telephone: chef.telephone,
            categorie: type,
            equipementId: equipement?.id ?? null,
            urgence,
            description: `${nature || LABELS[type]} en panne${equipement ? "" : " (non inventorié)"}`,
            canal: canal(ctx),
        });
        delete ctx.session["type"];
        delete ctx.session["nature"];
        return `Signalement ${s.code} enregistré : ${nature || LABELS[type]}, ${chef.village}, urgence ${urgence}. Un SMS vous dira quand il est traité.`;
    };
    const urgencyMenu = menu("Urgence ?", [
        { label: "Urgent : service coupé", to: recordBreakdown("haute") },
        { label: "Gênant, marche encore", to: recordBreakdown("moyenne") },
        { label: "Peut attendre", to: recordBreakdown("basse") },
    ]);
    const choose = (type, nature) => (_, ctx) => {
        ctx.session["type"] = type;
        ctx.session["nature"] = nature;
        return urgencyMenu;
    };
    const breakdown = menu("Type d'équipement ?", [
        { label: "Eau", to: menu("Quel équipement ?", [
                { label: "Forage", to: choose("eau", "forage") },
                { label: "Borne-fontaine", to: choose("eau", "borne-fontaine") },
            ]) },
        { label: "Santé", to: menu("Quel équipement ?", [
                { label: "Poste de santé", to: choose("sante", "poste de sante") },
                { label: "Case de santé", to: choose("sante", "case de sante") },
            ]) },
        { label: "École", to: menu("Quel équipement ?", [
                { label: "Salle de classe", to: choose("ecole", "salle de classe") },
                { label: "Latrines", to: choose("ecole", "latrines") },
            ]) },
        { label: "Énergie (lampadaire)", to: choose("energie", "lampadaire solaire") },
        { label: "Piste coupée", to: choose("piste", "piste") },
    ]);
    // --- A birth or a death: the name, then the date.
    const recordCivil = (categorie) => (text, ctx) => {
        const chef = chefOf(ctx);
        if (!chef)
            return NOT_REGISTERED;
        const date = parseDate(text);
        if (!date)
            return categorie === "naissance" ? birthDateRetry : deathDateRetry;
        const nom = String(ctx.session["nom"] ?? "");
        const s = commune.addSignalement({
            villageId: chef.villageId,
            telephone: chef.telephone,
            categorie,
            urgence: "moyenne",
            description: `${categorie === "naissance" ? "Naissance" : "Décès"} de ${nom}, le ${date}`,
            canal: canal(ctx),
        });
        delete ctx.session["nom"];
        return `${categorie === "naissance" ? "Naissance" : "Décès"} pré-déclaré(e) sous le numéro ${s.code}. L'officier d'état civil vous contactera pour l'acte.`;
    };
    const birthDate = ask("Date de naissance ? (JJ/MM/AAAA)", recordCivil("naissance"));
    const birthDateRetry = ask("Date non valide. Date de naissance ? (JJ/MM/AAAA)", recordCivil("naissance"));
    const deathDate = ask("Date du décès ? (JJ/MM/AAAA)", recordCivil("deces"));
    const deathDateRetry = ask("Date non valide. Date du décès ? (JJ/MM/AAAA)", recordCivil("deces"));
    const askName = (question, next) => ask(question, (name, ctx) => {
        if (!chefOf(ctx))
            return NOT_REGISTERED;
        ctx.session["nom"] = name.trim().slice(0, 80);
        return next;
    });
    // --- Following a report from the same village.
    const follow = ask("Numéro de suivi ? (ex. S-0042)", (code, ctx) => {
        const chef = chefOf(ctx);
        if (!chef)
            return NOT_REGISTERED;
        const s = commune.signalement(code.replace(/\s/g, "").replace(/^s(\d)/i, "S-$1"));
        if (!s || s.villageId !== chef.villageId)
            return "Numéro inconnu pour votre village. Vérifiez le numéro reçu par SMS.";
        const statut = { nouveau: "reçu", a_verifier: "en vérification", en_cours: "en cours de traitement", resolu: "résolu" }[s.statut];
        return `${s.code} (${LABELS[s.categorie]}) : ${statut}.`;
    });
    // --- Free text, sorted by the classifier.
    const message = ask("Décrivez le problème ou la déclaration :", async (text, ctx) => {
        const done = await recordFreeText(commune, classifier, ctx.phone, text, canal(ctx));
        return done ? done.reply : NOT_REGISTERED;
    });
    const start = menu("Mairie de Ndiédieng", [
        { label: "Signaler une panne", to: breakdown },
        { label: "Déclarer une naissance", to: askName("Prénom et nom de l'enfant ?", birthDate) },
        { label: "Déclarer un décès", to: askName("Prénom et nom du défunt ?", deathDate) },
        { label: "Suivre un signalement", to: follow },
        { label: "Écrire un message", to: message },
    ]);
    return createAgent({
        start,
        steps: [urgencyMenu, birthDate, birthDateRetry, deathDate, deathDateRetry],
        defaultLocale: "fr",
        ...rest,
    });
}
export const VILLAGE_LABELS = LABELS;
