/**
 * The demo's API: a simulated phone for any village chief (USSD, SMS and a
 * transcribed voice message, through Kalangu's simulator), the Mairie's
 * reports, and the territorial assistant. A standard Request -> Response
 * handler with no Node APIs, so it runs behind server.ts and, on the website,
 * inside the visitor's browser (web/local.ts).
 *
 * When the Mairie acts on a report, the chief gets an SMS: in the demo it
 * lands in the simulated phone's inbox; with a real gateway, `notify` sends it.
 */
import { createPhone } from "@kalangu/sim";
import { NOT_REGISTERED, recordFreeText, VILLAGE_LABELS } from "./agent.js";
export const USSD_CODE = "*123#";
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });
/** A chief's number as the dashboard shows it: enough to recognise, not to dial. */
export const maskPhone = (p) => `${p.slice(0, 4)} •• ••• •• ${p.slice(-2)}`;
const view = (s) => ({
    code: s.code,
    villageId: s.villageId,
    village: s.village,
    telephone: maskPhone(s.telephone),
    categorie: s.categorie,
    equipementId: s.equipementId,
    equipement: s.equipement,
    urgence: s.urgence,
    description: s.description,
    canal: s.canal,
    statut: s.statut,
    confiance: s.confiance,
    creeLe: s.creeLe,
    resoluLe: s.resoluLe,
});
/** What a chief is told when the Mairie moves a report on. */
function statusSms(s, statut) {
    const what = s.equipement ? s.equipement.split(",")[0] : VILLAGE_LABELS[s.categorie];
    if (statut === "resolu")
        return `Mairie de Ndiédieng : votre signalement ${s.code} (${what}) est résolu. Merci de l'avoir signalé.`;
    if (statut === "en_cours")
        return `Mairie de Ndiédieng : votre signalement ${s.code} (${what}) est pris en charge.`;
    return null;
}
/** The fields the Mairie may set, checked; a message for the first that is wrong. */
function readChange(body, creating) {
    const change = {};
    if (body["categorie"] !== undefined) {
        if (!CATEGORIES.includes(body["categorie"]))
            return { change, error: "Catégorie inconnue." };
        change.categorie = body["categorie"];
    }
    if (body["urgence"] !== undefined) {
        if (!URGENCES.includes(body["urgence"]))
            return { change, error: "Urgence inconnue." };
        change.urgence = body["urgence"];
    }
    if (body["statut"] !== undefined) {
        if (!STATUTS.includes(body["statut"]))
            return { change, error: "Statut inconnu." };
        change.statut = body["statut"];
    }
    if (body["description"] !== undefined) {
        const d = String(body["description"]).trim();
        if (!d)
            return { change, error: "La description ne peut pas être vide." };
        change.description = d.slice(0, 300);
    }
    if (body["equipementId"] !== undefined)
        change.equipementId = body["equipementId"] === null ? null : Number(body["equipementId"]);
    if (creating && (!change.categorie || !change.urgence || !change.description)) {
        return { change, error: "Catégorie, urgence et description sont nécessaires." };
    }
    return { change };
}
const STATUTS = ["nouveau", "a_verifier", "en_cours", "resolu"];
const CATEGORIES = Object.keys(VILLAGE_LABELS);
const URGENCES = ["haute", "moyenne", "basse"];
export function createApp(options) {
    const { commune, agent, assistant } = options;
    const phones = new Map();
    const phoneFor = (telephone) => {
        let phone = phones.get(telephone);
        if (!phone) {
            phone = createPhone(agent, { phone: telephone, code: USSD_CODE, sender: "MAIRIE", operator: "Sénégal" });
            phones.set(telephone, phone);
            if (options.inboxes) {
                phone.inbox.push(...(options.inboxes.get(telephone) ?? []));
                options.inboxes.set(telephone, phone.inbox);
            }
        }
        return phone;
    };
    const notify = options.notify ??
        (async (to, text) => {
            phoneFor(to).inbox.push({ from: "MAIRIE", text, at: new Date() });
        });
    const inboxOf = (phone) => phone.inbox.map((m) => ({ from: m.from, text: m.text, at: m.at.toISOString() }));
    return async (req) => {
        const url = new URL(req.url);
        const path = url.pathname;
        try {
            if (req.method === "GET" && path === "/api/info")
                return json({ mode: options.mode, code: USSD_CODE });
            if (req.method === "GET" && path === "/api/chefs")
                return json(commune.chefs());
            if (req.method === "GET" && path === "/api/villages")
                return json(commune.villages());
            if (req.method === "GET" && path === "/api/equipements") {
                const village = Number(url.searchParams.get("village"));
                if (!Number.isInteger(village))
                    return json({ error: "village is required" }, 400);
                return json(commune.equipementsOf(village));
            }
            // Created by an agent, after a phone call for example.
            if (req.method === "POST" && path === "/api/signalements") {
                const body = (await req.json());
                const villageId = Number(body["villageId"]);
                const chef = commune.chefs().map((c) => commune.chefByPhone(c.telephone)).find((c) => c?.villageId === villageId) ?? null;
                if (!chef)
                    return json({ error: "Village inconnu." }, 400);
                const { change, error } = readChange(body, true);
                if (error)
                    return json({ error }, 400);
                if (change.equipementId && !commune.equipementsOf(villageId).some((e) => e.id === change.equipementId)) {
                    return json({ error: "Cet équipement n'est pas dans ce village." }, 400);
                }
                const created = commune.addSignalement({
                    villageId,
                    telephone: chef.telephone,
                    categorie: change.categorie,
                    urgence: change.urgence,
                    description: change.description,
                    equipementId: change.equipementId ?? null,
                    canal: "mairie",
                    statut: change.statut ?? "nouveau",
                });
                let sms = null;
                if (body["notify"] !== false) {
                    sms = `Mairie de Ndiédieng : nous avons enregistré le signalement ${created.code} (${VILLAGE_LABELS[created.categorie]}) pour votre village.`;
                    await notify(created.telephone, sms);
                }
                return json({ signalement: view(created), sms }, 201);
            }
            const one = /^\/api\/signalements\/(S-\d{4,})$/.exec(path);
            if (one && (req.method === "PATCH" || req.method === "DELETE" || req.method === "GET")) {
                const current = commune.signalement(one[1]);
                if (!current)
                    return json({ error: "Signalement introuvable." }, 404);
                if (req.method === "GET")
                    return json(view(current));
                if (req.method === "DELETE") {
                    commune.deleteSignalement(current.code);
                    return json({ deleted: current.code });
                }
                const body = (await req.json());
                const { change, error } = readChange(body, false);
                if (error)
                    return json({ error }, 400);
                const updated = commune.updateSignalement(current.code, change);
                const sms = body["notify"] !== false && updated.statut !== current.statut ? statusSms(updated, updated.statut) : null;
                if (sms)
                    await notify(updated.telephone, sms);
                return json({ signalement: view(updated), sms });
            }
            if (req.method === "POST" && path === "/api/phone") {
                const body = (await req.json());
                if (!body.telephone)
                    return json({ error: "telephone is required" }, 400);
                const phone = phoneFor(body.telephone);
                const text = String(body.text ?? "");
                let screen = null;
                if (body.action === "dial")
                    screen = await phone.dial(text || USSD_CODE);
                else if (body.action === "press") {
                    if (!phone.inSession)
                        return json({ error: "No USSD session: dial first" }, 409);
                    screen = await phone.press(text);
                }
                else if (body.action === "hangup")
                    phone.hangUp();
                else if (body.action === "sms") {
                    if (!text.trim())
                        return json({ error: "empty SMS" }, 400);
                    await phone.sendSms(text);
                }
                else if (body.action === "vocal") {
                    // A voice message, already transcribed: recorded like a free SMS, confirmed by SMS.
                    if (!text.trim())
                        return json({ error: "empty voice message" }, 400);
                    const done = await recordFreeText(commune, options.classifier, body.telephone, text, "vocal");
                    await notify(body.telephone, done ? done.reply : NOT_REGISTERED);
                }
                else if (body.action !== "inbox")
                    return json({ error: `unknown action ${body.action}` }, 400);
                return json({ screen, inSession: phone.inSession, inbox: inboxOf(phone) });
            }
            if (req.method === "GET" && path === "/api/signalements") {
                const statut = url.searchParams.get("statut");
                const categorie = url.searchParams.get("categorie");
                return json({
                    counts: commune.counts(),
                    signalements: commune
                        .signalements({
                        ...(statut && STATUTS.includes(statut) ? { statut } : {}),
                        ...(categorie && CATEGORIES.includes(categorie) ? { categorie } : {}),
                    })
                        .map(view),
                });
            }
            const action = /^\/api\/signalements\/(S-\d{4,})\/(prendre|verifier|resoudre)$/.exec(path);
            if (req.method === "POST" && action) {
                const [, code, verb] = action;
                const current = commune.signalement(code);
                if (!current)
                    return json({ error: "unknown report" }, 404);
                const body = verb === "verifier" ? (await req.json()) : {};
                if (verb === "verifier" && ((body.categorie && !CATEGORIES.includes(body.categorie)) || (body.urgence && !URGENCES.includes(body.urgence)))) {
                    return json({ error: "invalid category or urgency" }, 400);
                }
                const updated = commune.setStatut(code, verb === "resoudre" ? "resolu" : "en_cours", {
                    ...(body.categorie ? { categorie: body.categorie } : {}),
                    ...(body.urgence ? { urgence: body.urgence } : {}),
                });
                const sms = statusSms(updated, updated.statut);
                await notify(updated.telephone, sms);
                return json({ signalement: view(updated), sms });
            }
            if (req.method === "POST" && path === "/api/ask") {
                const body = (await req.json());
                const question = String(body.question ?? "").trim().slice(0, 500);
                if (!question)
                    return json({ error: "empty question" }, 400);
                return json(await assistant.ask(question));
            }
            return json({ error: "not found" }, 404);
        }
        catch (err) {
            return json({ error: err instanceof Error ? err.message : String(err) }, 500);
        }
    };
}
