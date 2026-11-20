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

import type { Agent } from "@kalangu/core";
import { createPhone, type SimPhone } from "@kalangu/sim";
import { NOT_REGISTERED, recordFreeText, VILLAGE_LABELS } from "./agent.js";
import type { Assistant } from "./assistant.js";
import type { Classifier } from "./classify.js";
import type { Categorie, Commune, Signalement, Statut, Urgence } from "./db.js";

export const USSD_CODE = "*123#";

export interface AppOptions {
  commune: Commune;
  agent: Agent;
  assistant: Assistant;
  /** Sorts a transcribed voice message, as for a free SMS. */
  classifier: Classifier;
  /** Sends an SMS to a chief outside a conversation. Defaults to the simulated phone's inbox. */
  notify?: (to: string, text: string) => Promise<void>;
  /** Which classifier and assistant are on, for the page to say. */
  mode: string;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });

/** A chief's number as the dashboard shows it: enough to recognise, not to dial. */
export const maskPhone = (p: string) => `${p.slice(0, 4)} •• ••• •• ${p.slice(-2)}`;

const view = (s: Signalement) => ({
  code: s.code,
  village: s.village,
  telephone: maskPhone(s.telephone),
  categorie: s.categorie,
  equipement: s.equipement,
  urgence: s.urgence,
  description: s.description,
  canal: s.canal,
  statut: s.statut,
  confiance: s.confiance,
  creeLe: s.creeLe,
});

const STATUTS: Statut[] = ["nouveau", "a_verifier", "en_cours", "resolu"];
const CATEGORIES = Object.keys(VILLAGE_LABELS) as Categorie[];
const URGENCES: Urgence[] = ["haute", "moyenne", "basse"];

export function createApp(options: AppOptions): (req: Request) => Promise<Response> {
  const { commune, agent, assistant } = options;
  const phones = new Map<string, SimPhone>();
  const phoneFor = (telephone: string) => {
    let phone = phones.get(telephone);
    if (!phone) {
      phone = createPhone(agent, { phone: telephone, code: USSD_CODE, sender: "MAIRIE", operator: "Sénégal" });
      phones.set(telephone, phone);
    }
    return phone;
  };
  const notify =
    options.notify ??
    (async (to: string, text: string) => {
      phoneFor(to).inbox.push({ from: "MAIRIE", text, at: new Date() });
    });
  const inboxOf = (phone: SimPhone) => phone.inbox.map((m) => ({ from: m.from, text: m.text, at: m.at.toISOString() }));

  return async (req) => {
    const url = new URL(req.url);
    const path = url.pathname;
    try {
      if (req.method === "GET" && path === "/api/info") return json({ mode: options.mode, code: USSD_CODE });
      if (req.method === "GET" && path === "/api/chefs") return json(commune.chefs());

      if (req.method === "POST" && path === "/api/phone") {
        const body = (await req.json()) as { telephone?: string; action?: string; text?: string };
        if (!body.telephone) return json({ error: "telephone is required" }, 400);
        const phone = phoneFor(body.telephone);
        const text = String(body.text ?? "");
        let screen: { text: string; end: boolean } | null = null;
        if (body.action === "dial") screen = await phone.dial(text || USSD_CODE);
        else if (body.action === "press") {
          if (!phone.inSession) return json({ error: "No USSD session: dial first" }, 409);
          screen = await phone.press(text);
        } else if (body.action === "hangup") phone.hangUp();
        else if (body.action === "sms") {
          if (!text.trim()) return json({ error: "empty SMS" }, 400);
          await phone.sendSms(text);
        } else if (body.action === "vocal") {
          // A voice message, already transcribed: recorded like a free SMS, confirmed by SMS.
          if (!text.trim()) return json({ error: "empty voice message" }, 400);
          const done = await recordFreeText(commune, options.classifier, body.telephone, text, "vocal");
          await notify(body.telephone, done ? done.reply : NOT_REGISTERED);
        } else if (body.action !== "inbox") return json({ error: `unknown action ${body.action}` }, 400);
        return json({ screen, inSession: phone.inSession, inbox: inboxOf(phone) });
      }

      if (req.method === "GET" && path === "/api/signalements") {
        const statut = url.searchParams.get("statut") as Statut | null;
        const categorie = url.searchParams.get("categorie") as Categorie | null;
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
        const current = commune.signalement(code!);
        if (!current) return json({ error: "unknown report" }, 404);
        const body = verb === "verifier" ? ((await req.json()) as { categorie?: Categorie; urgence?: Urgence }) : {};
        if (verb === "verifier" && ((body.categorie && !CATEGORIES.includes(body.categorie)) || (body.urgence && !URGENCES.includes(body.urgence)))) {
          return json({ error: "invalid category or urgency" }, 400);
        }
        const updated = commune.setStatut(code!, verb === "resoudre" ? "resolu" : "en_cours", {
          ...(body.categorie ? { categorie: body.categorie } : {}),
          ...(body.urgence ? { urgence: body.urgence } : {}),
        })!;
        const what = updated.equipement ? updated.equipement.split(",")[0] : VILLAGE_LABELS[updated.categorie];
        const sms =
          verb === "resoudre"
            ? `Mairie de Ndiédieng : votre signalement ${updated.code} (${what}) est résolu. Merci de l'avoir signalé.`
            : `Mairie de Ndiédieng : votre signalement ${updated.code} (${what}) est pris en charge.`;
        await notify(updated.telephone, sms);
        return json({ signalement: view(updated), sms });
      }

      if (req.method === "POST" && path === "/api/ask") {
        const body = (await req.json()) as { question?: string };
        const question = String(body.question ?? "").trim().slice(0, 500);
        if (!question) return json({ error: "empty question" }, 400);
        return json(await assistant.ask(question));
      }

      return json({ error: "not found" }, 404);
    } catch (err) {
      return json({ error: err instanceof Error ? err.message : String(err) }, 500);
    }
  };
}
