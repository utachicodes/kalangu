import { afterEach, describe, expect, it } from "vitest";
import { silentLogger } from "@kalangu/core";
import { createNdiediengAgent } from "../src/agent.js";
import { createApp, maskPhone } from "../src/app.js";
import { ruleAssistant } from "../src/assistant.js";
import { keywordClassifier } from "../src/classify.js";
import { chefPhone } from "../src/data.js";
import type { Commune } from "../src/db.js";
import { openCommune } from "../src/nodeSql.js";

const open: Commune[] = [];
afterEach(() => open.splice(0).forEach((c) => c.close()));

function setup() {
  const commune = openCommune({ history: false });
  open.push(commune);
  const agent = createNdiediengAgent({ commune, classifier: keywordClassifier(), channels: [], logger: silentLogger });
  const app = createApp({ commune, agent, assistant: ruleAssistant(commune), classifier: keywordClassifier(), mode: "test" });
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await app(new Request(`http://localhost${path}`, { method, ...(body ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } } : {}) }));
    // The API's JSON, read loosely: the assertions below say what each response holds.
    const read: any = res.headers.get("content-type")?.includes("json") ? await res.json() : await res.text();
    return { status: res.status, body: read };
  };
  const phone = (action: string, text = "", telephone = chefPhone(12)) => call("POST", "/api/phone", { telephone, action, text });
  return { commune, call, phone };
}

describe("the demo app", () => {
  it("takes a report from the phone to the dashboard, and the Mairie's answer back by SMS", async () => {
    const t = setup();
    expect((await t.phone("dial", "*123#")).body.screen.text).toMatch(/^Mairie de Ndiedieng/);
    await t.phone("press", "1");
    await t.phone("press", "1");
    await t.phone("press", "1");
    const done = await t.phone("press", "1");
    expect(done.body.screen).toMatchObject({ end: true });
    expect(done.body.inSession).toBe(false);

    const list = (await t.call("GET", "/api/signalements")).body;
    expect(list.counts).toMatchObject({ nouveau: 1, haute: 1 });
    expect(list.signalements[0]).toMatchObject({ code: "S-0001", village: "Village 12", categorie: "eau", urgence: "haute", canal: "ussd" });
    expect(list.signalements[0].telephone).toBe(maskPhone(chefPhone(12)));
    expect(JSON.stringify(list)).not.toContain(chefPhone(12));

    const resolved = (await t.call("POST", "/api/signalements/S-0001/resoudre")).body;
    expect(resolved.signalement.statut).toBe("resolu");
    const inbox = (await t.phone("inbox")).body.inbox;
    expect(inbox.at(-1)).toMatchObject({ from: "MAIRIE", text: "Mairie de Ndiédieng : votre signalement S-0001 (forage 1) est résolu. Merci de l'avoir signalé." });
    expect(t.commune.counts().resolu).toBe(1);
  });

  it("lets the Mairie correct an unclear SMS, and tells the chief", async () => {
    const t = setup();
    await t.phone("sms", "bonjour");
    await t.phone("sms", "5");
    await t.phone("sms", "venez vite svp");
    const pending = (await t.call("GET", "/api/signalements?statut=a_verifier")).body.signalements;
    expect(pending).toHaveLength(1);
    const res = await t.call("POST", `/api/signalements/${pending[0].code}/verifier`, { categorie: "piste", urgence: "haute" });
    expect(res.body.signalement).toMatchObject({ statut: "en_cours", categorie: "piste", urgence: "haute" });
    expect((await t.phone("inbox")).body.inbox.at(-1).text).toMatch(/est pris en charge\.$/);
    expect((await t.call("POST", `/api/signalements/${pending[0].code}/verifier`, { categorie: "meteo" })).status).toBe(400);
  });

  it("answers the assistant's questions", async () => {
    const t = setup();
    const a = (await t.call("POST", "/api/ask", { question: "Combien de fiches sont à mettre à jour ?" })).body;
    expect(a.answer).toMatch(/499 fiches/);
    expect((await t.call("POST", "/api/ask", { question: " " })).status).toBe(400);
  });

  it("refuses bad requests plainly", async () => {
    const t = setup();
    expect((await t.phone("press", "1")).status).toBe(409); // no session yet
    expect((await t.phone("fly")).status).toBe(400);
    expect((await t.call("POST", "/api/signalements/S-9999/resoudre")).status).toBe(404);
    expect((await t.call("GET", "/nope")).status).toBe(404);
  });

  it("records a transcribed voice message and confirms it by SMS", async () => {
    const t = setup();
    const res = (await t.phone("vocal", "Le lampadaire solaire de la place ne s'allume plus")).body;
    expect(res.inbox.at(-1).text).toMatch(/^Message reçu \(S-0001\) : énergie, lampadaire solaire/);
    expect(t.commune.signalement("S-0001")).toMatchObject({ canal: "vocal", categorie: "energie" });
    expect((await t.phone("vocal", "  ")).status).toBe(400);
    const stranger = (await t.phone("vocal", "forage en panne", "+221000000999")).body;
    expect(stranger.inbox.at(-1).text).toMatch(/n'est pas enregistré/);
  });

  it("says which mode it runs in", async () => {
    expect((await setup().call("GET", "/api/info")).body).toEqual({ mode: "test", code: "*123#" });
  });
});

describe("the Mairie's create, read, update and delete", () => {
  it("creates a report for a village, telling its chief", async () => {
    const t = setup();
    const equip = (await t.call("GET", "/api/equipements?village=12")).body[0];
    const res = await t.call("POST", "/api/signalements", { villageId: 12, categorie: equip.type, urgence: "haute", description: "Signalé par téléphone", equipementId: equip.id });
    expect(res.status).toBe(201);
    expect(res.body.signalement).toMatchObject({ code: "S-0001", village: "Village 12", canal: "mairie", statut: "nouveau", equipementId: equip.id });
    expect((await t.phone("inbox")).body.inbox.at(-1).text).toMatch(/nous avons enregistré le signalement S-0001/);
    expect((await t.call("GET", "/api/villages")).body).toHaveLength(58);
  });

  it("refuses a create with a missing field, an unknown village or another village's equipment", async () => {
    const t = setup();
    expect((await t.call("POST", "/api/signalements", { villageId: 12, categorie: "eau", urgence: "haute" })).body.error).toMatch(/nécessaires/);
    expect((await t.call("POST", "/api/signalements", { villageId: 99, categorie: "eau", urgence: "haute", description: "x" })).body.error).toBe("Village inconnu.");
    const other = (await t.call("GET", "/api/equipements?village=3")).body[0];
    expect((await t.call("POST", "/api/signalements", { villageId: 12, categorie: "eau", urgence: "haute", description: "x", equipementId: other.id })).status).toBe(400);
  });

  it("updates a report, and tells the chief only when its status moves on", async () => {
    const t = setup();
    await t.call("POST", "/api/signalements", { villageId: 12, categorie: "eau", urgence: "moyenne", description: "Fuite", notify: false });
    const before = (await t.phone("inbox")).body.inbox.length;
    const edit = await t.call("PATCH", "/api/signalements/S-0001", { urgence: "haute", description: "Grosse fuite" });
    expect(edit.body).toMatchObject({ signalement: { urgence: "haute", description: "Grosse fuite" }, sms: null });
    expect((await t.phone("inbox")).body.inbox.length).toBe(before);
    const done = await t.call("PATCH", "/api/signalements/S-0001", { statut: "resolu" });
    expect(done.body.sms).toMatch(/est résolu/);
    expect(done.body.signalement.resoluLe).toBeTruthy();
    expect((await t.call("PATCH", "/api/signalements/S-0001", { urgence: "extreme" })).body.error).toBe("Urgence inconnue.");
    expect((await t.call("PATCH", "/api/signalements/S-0001", { description: "  " })).status).toBe(400);
  });

  it("deletes a report, and an equipment with no open report works again", async () => {
    const t = setup();
    const equip = (await t.call("GET", "/api/equipements?village=12")).body[0];
    await t.call("POST", "/api/signalements", { villageId: 12, categorie: equip.type, urgence: "haute", description: "x", equipementId: equip.id, notify: false });
    const broken = () => (t.commune.readOnly(`SELECT etat FROM equipements WHERE id = ${Number(equip.id)}`).rows[0] as { etat: string }).etat;
    expect(broken()).toBe("en panne");
    expect((await t.call("DELETE", "/api/signalements/S-0001")).body).toMatchObject({ deleted: "S-0001" });
    expect(t.commune.signalement("S-0001")).toBeNull();
    expect(broken()).toBe("fonctionnel");
    expect((await t.call("DELETE", "/api/signalements/S-0001")).status).toBe(404);
    expect((await t.call("GET", "/api/signalements/S-0001")).status).toBe(404);
  });

  it("reopening a resolved report marks its equipment broken again", async () => {
    const t = setup();
    const equip = (await t.call("GET", "/api/equipements?village=12")).body[0];
    await t.call("POST", "/api/signalements", { villageId: 12, categorie: equip.type, urgence: "haute", description: "x", equipementId: equip.id, notify: false });
    await t.call("PATCH", "/api/signalements/S-0001", { statut: "resolu" });
    const etat = () => (t.commune.readOnly(`SELECT etat FROM equipements WHERE id = ${Number(equip.id)}`).rows[0] as { etat: string }).etat;
    expect(etat()).toBe("fonctionnel");
    await t.call("PATCH", "/api/signalements/S-0001", { statut: "en_cours" });
    expect(etat()).toBe("en panne");
  });
});

describe("a saved demo", () => {
  it("reopens a commune's database as it was, without seeding it again", () => {
    const first = openCommune({ history: false });
    const created = first.addSignalement({ villageId: 3, telephone: chefPhone(3), categorie: "eau", urgence: "haute", description: "fuite", canal: "mairie" });
    first.close();
    const again = openCommune({ path: first.path, existing: true });
    open.push(again);
    expect(again.villages()).toHaveLength(58);
    expect(again.signalement(created.code)).toMatchObject({ description: "fuite" });
    expect(again.counts().nouveau).toBe(1);
  });

  it("delivers saved inboxes and keeps each phone's inbox live in the map", async () => {
    const commune = openCommune({ history: false });
    open.push(commune);
    const tel = chefPhone(5);
    const inboxes = new Map([[tel, [{ from: "MAIRIE", text: "déjà là", at: new Date("2026-01-01") }]]]);
    const app = createApp({ commune, agent: createNdiediengAgent({ commune, classifier: keywordClassifier(), channels: [], logger: silentLogger }), assistant: ruleAssistant(commune), classifier: keywordClassifier(), mode: "test", inboxes });
    const res = await app(new Request("http://localhost/api/phone", { method: "POST", body: JSON.stringify({ telephone: tel, action: "sms", text: "bonjour" }) }));
    const body = (await res.json()) as { inbox: Array<{ text: string }> };
    expect(body.inbox[0]!.text).toBe("déjà là");
    expect(inboxes.get(tel)!.length).toBe(body.inbox.length);
    expect(body.inbox.length).toBeGreaterThan(1);
  });
});

describe("undoing a delete", () => {
  it("puts the report back under its own code, equipment state included", async () => {
    const t = setup();
    const created = (await t.call("POST", "/api/signalements", { villageId: 4, categorie: "eau", urgence: "haute", description: "fuite au forage", notify: false })).body.signalement;
    await t.call("POST", "/api/signalements", { villageId: 6, categorie: "piste", urgence: "basse", description: "nid de poule", notify: false });
    const before = (await t.call("GET", `/api/signalements/${created.code}`)).body;

    const del = await t.call("DELETE", `/api/signalements/${created.code}`);
    expect(del.body).toEqual({ deleted: created.code, undo: `/api/signalements/${created.code}/restaurer` });
    expect((await t.call("GET", `/api/signalements/${created.code}`)).status).toBe(404);

    const back = await t.call("POST", del.body.undo);
    expect(back.status).toBe(200);
    expect(back.body.signalement).toEqual(before);
    // Once only.
    expect((await t.call("POST", del.body.undo)).status).toBe(404);
  });

  it("refuses when the code was given to a new report meanwhile", async () => {
    const t = setup();
    const last = (await t.call("POST", "/api/signalements", { villageId: 4, categorie: "eau", urgence: "haute", description: "fuite", notify: false })).body.signalement;
    const del = await t.call("DELETE", `/api/signalements/${last.code}`);
    const reused = (await t.call("POST", "/api/signalements", { villageId: 5, categorie: "sante", urgence: "moyenne", description: "porte cassée", notify: false })).body.signalement;
    expect(reused.code).toBe(last.code);
    const back = await t.call("POST", del.body.undo);
    expect(back.status).toBe(409);
    expect((await t.call("GET", `/api/signalements/${last.code}`)).body.description).toBe("porte cassée");
  });
});
