import { afterEach, describe, expect, it } from "vitest";
import { silentLogger } from "@kalangu/core";
import { createPhone } from "@kalangu/sim";
import { createNdiediengAgent, NOT_REGISTERED, parseDate } from "../src/agent.js";
import { keywordClassifier } from "../src/classify.js";
import { chefPhone } from "../src/data.js";
import { openCommune, type Commune } from "../src/db.js";

const open: Commune[] = [];
afterEach(() => open.splice(0).forEach((c) => c.close()));

function setup(phone = chefPhone(7)) {
  const commune = openCommune({ history: false });
  open.push(commune);
  const agent = createNdiediengAgent({ commune, classifier: keywordClassifier(), channels: [], logger: silentLogger });
  return { commune, phone: createPhone(agent, { phone, code: "*123#", sender: "MAIRIE" }) };
}

describe("the village chiefs' agent", () => {
  it("shows the menu within one USSD screen, without accents", async () => {
    const { phone } = setup();
    const screen = await phone.dial("*123#");
    expect(screen.text).toBe(
      "Mairie de Ndiedieng\n1. Signaler une panne\n2. Declarer une naissance\n3. Declarer un deces\n4. Suivre un signalement\n5. Ecrire un message",
    );
    expect(screen.text.length).toBeLessThanOrEqual(160);
  });

  it("records a broken borehole in three choices, with the village from the number", async () => {
    const { phone, commune } = setup();
    await phone.dial("*123#");
    await phone.press("1"); // Signaler une panne
    await phone.press("1"); // Eau
    await phone.press("1"); // Forage
    const done = await phone.press("1"); // Urgent
    expect(done.end).toBe(true);
    expect(done.text).toMatch(/^Signalement S-0001 enregistre : forage, Village 07, urgence haute\./);
    const s = commune.signalement("S-0001")!;
    expect(s).toMatchObject({ village: "Village 07", categorie: "eau", urgence: "haute", canal: "ussd", statut: "nouveau" });
    expect(s.equipement).toMatch(/^forage 1, Village 07$/);
  });

  it("also works from a dial string carrying the choices", async () => {
    const { phone, commune } = setup();
    const done = await phone.dial("*123*1*4*3#"); // panne, energie, peut attendre
    expect(done.text).toMatch(/lampadaire solaire, Village 07, urgence basse/);
    expect(commune.signalements()).toHaveLength(1);
  });

  it("pre-declares a birth, asking again for an invalid date", async () => {
    const { phone, commune } = setup();
    await phone.dial("*123#");
    await phone.press("2");
    await phone.press("Awa Diop");
    expect((await phone.press("31/02/2026")).text).toMatch(/^Date non valide/);
    const done = await phone.press("14/11/2026");
    expect(done.text).toMatch(/^Naissance pre-declare\(e\) sous le numero S-0001/);
    expect(commune.signalement("S-0001")).toMatchObject({ categorie: "naissance", description: "Naissance de Awa Diop, le 2026-11-14" });
  });

  it("follows a report of the same village only", async () => {
    const { phone, commune } = setup();
    commune.addSignalement({ villageId: 7, telephone: chefPhone(7), categorie: "eau", urgence: "haute", description: "x", canal: "ussd" });
    commune.addSignalement({ villageId: 9, telephone: chefPhone(9), categorie: "eau", urgence: "haute", description: "y", canal: "ussd" });
    await phone.dial("*123#");
    await phone.press("4");
    expect((await phone.press("s0001")).text).toBe("S-0001 (eau) : recu.");
    await phone.dial("*123#");
    await phone.press("4");
    expect((await phone.press("S-0002")).text).toMatch(/^Numero inconnu pour votre village/);
  });

  it("sorts a free SMS, and sends an unclear one to be checked", async () => {
    const { phone, commune } = setup();
    await phone.sendSms("bonjour");
    await phone.sendSms("5");
    await phone.sendSms("Le forage est en panne depuis hier, plus d'eau au village");
    expect(phone.inbox.at(-1)!.text).toBe("Message reçu (S-0001) : eau, forage, urgence haute. Merci.");
    await phone.sendSms("menu");
    await phone.sendSms("5");
    await phone.sendSms("Il faut venir voir");
    expect(phone.inbox.at(-1)!.text).toMatch(/^Message reçu \(S-0002\)\. La Mairie va le vérifier/);
    expect(commune.signalement("S-0002")?.statut).toBe("a_verifier");
  });

  it("refuses a number that is not a registered chief's", async () => {
    const { phone, commune } = setup("+221000000999");
    const done = await phone.dial("*123*1*1*1*1#");
    expect(done.text).toBe(NOT_REGISTERED.normalize("NFD").replace(/\p{M}/gu, ""));
    expect(commune.signalements()).toHaveLength(0);
  });
});

describe("parseDate", () => {
  it("accepts real past dates only", () => {
    const today = new Date("2026-11-20T12:00:00Z");
    expect(parseDate("14/11/2026", today)).toBe("2026-11-14");
    expect(parseDate("1-2-2020", today)).toBe("2020-02-01");
    expect(parseDate("31/02/2026", today)).toBeNull();
    expect(parseDate("01/12/2026", today)).toBeNull();
    expect(parseDate("demain", today)).toBeNull();
  });
});
