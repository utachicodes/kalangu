/**
 * The Kalangu agent the village chiefs reach by USSD or SMS: report a
 * breakdown, declare a birth or a death, follow a report, or write freely.
 *
 * The village is never asked for: it comes from the caller's number, which
 * must be a registered chief's. Every report gets a tracking number, and the
 * Mairie's answer comes back by SMS (see app.ts).
 */
import { ask, createAgent, languageMenu, memoryStore, menu, } from "@kalangu/core";
import { REVIEW_BELOW } from "./classify.js";
import { CATEGORY, equipmentName, KALANGU_WO, langOf, say, STATUS, TEXT, URGENCY } from "./strings.js";
/** Categories as the Mairie reads them (French). */
const LABELS = Object.fromEntries(Object.entries(CATEGORY).map(([k, v]) => [k, v.fr]));
export const NOT_REGISTERED = TEXT.notRegistered.fr;
/** The languages a chief chooses between at their first call, each named in itself. */
export const LANGUAGES = [
    { code: "fr", name: "Français" },
    { code: "wo", name: "Wolof" },
];
/**
 * A free-text message from a chief (an SMS, or a voice message once
 * transcribed): sorted, recorded, and the reply to send back, in the chief's
 * language. Null when the number is not a registered chief's.
 */
export async function recordFreeText(commune, classifier, telephone, text, canal, lang = "fr") {
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
    const what = `${CATEGORY[c.categorie][lang]}${c.nature ? `, ${equipmentName(c.nature, lang)}` : ""}`;
    const reply = review
        ? say(lang, "message.toCheck", { code: s.code })
        : say(lang, "message.sorted", { code: s.code, what, urgency: URGENCY[c.urgence][lang] });
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
    const sessionStore = rest.sessionStore ?? memoryStore();
    const chefOf = (ctx) => commune.chefByPhone(ctx.phone);
    const canal = (ctx) => (ctx.channelKind === "ussd" ? "ussd" : "sms");
    const lang = (ctx) => langOf(ctx.locale);
    const notRegistered = (ctx) => say(lang(ctx), "notRegistered");
    // --- A breakdown: type, then equipment, then urgency.
    const recordBreakdown = (urgence) => (_, ctx) => {
        const chef = chefOf(ctx);
        if (!chef)
            return notRegistered(ctx);
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
        const l = lang(ctx);
        return say(l, "breakdown.done", {
            code: s.code,
            what: nature ? equipmentName(nature, l) : CATEGORY[type][l],
            village: chef.village,
            urgency: URGENCY[urgence][l],
        });
    };
    const urgencyMenu = menu(TEXT["breakdown.urgency"], [
        { label: TEXT["breakdown.urgent"], to: recordBreakdown("haute") },
        { label: TEXT["breakdown.annoying"], to: recordBreakdown("moyenne") },
        { label: TEXT["breakdown.canWait"], to: recordBreakdown("basse") },
    ]);
    const choose = (type, nature) => (_, ctx) => {
        ctx.session["type"] = type;
        ctx.session["nature"] = nature;
        return urgencyMenu;
    };
    const kind = (nature) => ({ label: { fr: capital(equipmentName(nature, "fr")), wo: capital(equipmentName(nature, "wo")) } });
    const which = (type, natures) => menu(TEXT["breakdown.which"], natures.map((n) => ({ ...kind(n), to: choose(type, n) })));
    const breakdown = menu(TEXT["breakdown.type"], [
        { label: TEXT["breakdown.water"], to: which("eau", ["forage", "borne-fontaine"]) },
        { label: TEXT["breakdown.health"], to: which("sante", ["poste de sante", "case de sante"]) },
        { label: TEXT["breakdown.school"], to: which("ecole", ["salle de classe", "latrines"]) },
        { label: TEXT["breakdown.energy"], to: choose("energie", "lampadaire solaire") },
        { label: TEXT["breakdown.road"], to: choose("piste", "piste") },
    ]);
    // --- A birth or a death: the name, then the date.
    const recordCivil = (categorie) => (text, ctx) => {
        const chef = chefOf(ctx);
        if (!chef)
            return notRegistered(ctx);
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
        return say(lang(ctx), categorie === "naissance" ? "civil.birthDone" : "civil.deathDone", { code: s.code });
    };
    const retry = (question) => ({
        fr: `${TEXT["civil.badDate"].fr} ${question.fr}`,
        wo: `${TEXT["civil.badDate"].wo} ${question.wo}`,
    });
    const birthDate = ask(TEXT["civil.birthDate"], recordCivil("naissance"));
    const birthDateRetry = ask(retry(TEXT["civil.birthDate"]), recordCivil("naissance"));
    const deathDate = ask(TEXT["civil.deathDate"], recordCivil("deces"));
    const deathDateRetry = ask(retry(TEXT["civil.deathDate"]), recordCivil("deces"));
    const askName = (question, next) => ask(question, (name, ctx) => {
        if (!chefOf(ctx))
            return notRegistered(ctx);
        ctx.session["nom"] = name.trim().slice(0, 80);
        return next;
    });
    // --- Following a report from the same village.
    const follow = ask(TEXT["follow.ask"], (code, ctx) => {
        const chef = chefOf(ctx);
        if (!chef)
            return notRegistered(ctx);
        const l = lang(ctx);
        const s = commune.signalement(code.replace(/\s/g, "").replace(/^s(\d)/i, "S-$1"));
        if (!s || s.villageId !== chef.villageId)
            return say(l, "follow.unknown");
        return say(l, "follow.status", { code: s.code, what: CATEGORY[s.categorie][l], status: STATUS[s.statut][l] });
    });
    // --- Free text, sorted by the classifier.
    const message = ask(TEXT["message.ask"], async (text, ctx) => {
        const done = await recordFreeText(commune, classifier, ctx.phone, text, canal(ctx), lang(ctx));
        return done ? done.reply : notRegistered(ctx);
    });
    const start = menu(TEXT["menu.title"], [
        { label: TEXT["menu.breakdown"], to: breakdown },
        { label: TEXT["menu.birth"], to: askName(TEXT["civil.birthName"], birthDate) },
        { label: TEXT["menu.death"], to: askName(TEXT["civil.deathName"], deathDate) },
        { label: TEXT["menu.follow"], to: follow },
        { label: TEXT["menu.message"], to: message },
        { label: TEXT["menu.language"], to: languageMenu() },
    ]);
    const agent = createAgent({
        start,
        steps: [urgencyMenu, birthDate, birthDateRetry, deathDate, deathDateRetry],
        // A report in one SMS (docs/first-message-design.md §6): a chief's first
        // message is sorted and recorded at once. A greeting, "menu" or anything
        // short still opens the menu, as before.
        onMessage: async (text, ctx) => {
            if (text.length < 15 || /^(menu|aide|help)$/i.test(text))
                return;
            const done = await recordFreeText(commune, classifier, ctx.phone, text, canal(ctx), lang(ctx));
            return done ? done.reply : notRegistered(ctx);
        },
        defaultLocale: "fr",
        // Asked once per number, at the first call or SMS, and remembered.
        languages: { supported: LANGUAGES },
        messages: { wo: KALANGU_WO },
        ...rest,
        sessionStore,
    });
    return Object.assign(agent, {
        languageOf: async (telephone) => langOf((await sessionStore.load(telephone))?.locale),
    });
}
const capital = (s) => s[0].toUpperCase() + s.slice(1);
export const VILLAGE_LABELS = LABELS;
