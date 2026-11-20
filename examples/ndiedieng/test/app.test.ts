import { afterEach, describe, expect, it } from "vitest";
import { silentLogger } from "@kalangu/core";
import { createNdiediengAgent } from "../src/agent.js";
import { createApp, maskPhone } from "../src/app.js";
import { ruleAssistant } from "../src/assistant.js";
import { keywordClassifier } from "../src/classify.js";
import { chefPhone } from "../src/data.js";
import { openCommune, type Commune } from "../src/db.js";

const open: Commune[] = [];
afterEach(() => open.splice(0).forEach((c) => c.close()));

function setup() {
  const commune = openCommune({ history: false });
  open.push(commune);
  const agent = createNdiediengAgent({ commune, classifier: keywordClassifier(), channels: [], logger: silentLogger });
  const app = createApp({ commune, agent, assistant: ruleAssistant(commune), mode: "test" });
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

  it("serves the page with no data in its HTML", async () => {
    const t = setup();
    const page = (await t.call("GET", "/")).body as string;
    expect(page).toMatch(/^<!doctype html>/);
    expect(page).toContain("Données fictives");
    expect(page).not.toContain(chefPhone(1));
    expect(page).not.toMatch(/innerHTML/);
  });
});
