import { afterEach, describe, expect, it } from "vitest";
import { freshRecord, memoryStore, silentLogger } from "@kalangu/core";
import { createPhone } from "@kalangu/sim";
import { createNdiediengAgent, NOT_REGISTERED, parseDate } from "../src/agent.js";
import { TEXT } from "../src/strings.js";
import { keywordClassifier } from "../src/classify.js";
import { chefPhone } from "../src/data.js";
import type { Commune } from "../src/db.js";
import { openCommune } from "../src/nodeSql.js";

const open: Commune[] = [];
afterEach(() => open.splice(0).forEach((c) => c.close()));

/** USSD shows no accents: what a keypad phone displays for a string. */
const plain = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "");

/** A chief's phone; `chosen` is the language they already picked, or null for a first contact. */
async function setup(phone = chefPhone(7), chosen: "fr" | "wo" | null = "fr") {
  const commune = openCommune({ history: false });
  open.push(commune);
  const sessionStore = memoryStore();
  if (chosen) await sessionStore.save({ ...freshRecord(phone, chosen, Date.now()), languageChosen: true });
  const agent = createNdiediengAgent({ commune, classifier: keywordClassifier(), channels: [], logger: silentLogger, sessionStore });
  return { commune, agent, phone: createPhone(agent, { phone, code: "*123#", sender: "MAIRIE" }) };
}

describe("the village chiefs' agent", () => {
  it("shows the menu within one USSD screen, without accents", async () => {
    const { phone } = await setup();
    const screen = await phone.dial("*123#");
    expect(screen.text).toBe(
      "Mairie de Ndiedieng\n1. Signaler une panne\n2. Declarer une naissance\n3. Declarer un deces\n4. Suivre un signalement\n5. Ecrire un message\n6. Langue / Lakk",
    );
    expect(screen.text.length).toBeLessThanOrEqual(160);
  });

  it("records a broken borehole in three choices, with the village from the number", async () => {
    const { phone, commune } = await setup();
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
    const { phone, commune } = await setup();
    const done = await phone.dial("*123*1*4*3#"); // panne, energie, peut attendre
    expect(done.text).toMatch(/lampadaire solaire, Village 07, urgence basse/);
    expect(commune.signalements()).toHaveLength(1);
  });

  it("pre-declares a birth, asking again for an invalid date", async () => {
    const { phone, commune } = await setup();
    await phone.dial("*123#");
    await phone.press("2");
    await phone.press("Awa Diop");
    expect((await phone.press("31/02/2026")).text).toMatch(/^Date non valide/);
    const done = await phone.press("14/11/2026");
    expect(done.text).toMatch(/^Naissance pre-declaree sous le numero S-0001/);
    expect(commune.signalement("S-0001")).toMatchObject({ categorie: "naissance", description: "Naissance de Awa Diop, le 2026-11-14" });
  });

  it("follows a report of the same village only", async () => {
    const { phone, commune } = await setup();
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
    const { phone, commune } = await setup();
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
    const { phone, commune } = await setup("+221000000999");
    const done = await phone.dial("*123*1*1*1*1#");
    expect(done.text).toBe(plain(NOT_REGISTERED));
    expect(commune.signalements()).toHaveLength(0);
  });
});

describe("Wolof", () => {
  it("asks a new number its language first, French first in Senegal", async () => {
    const { phone } = await setup(chefPhone(7), null);
    expect((await phone.dial("*123#")).text).toBe("Langue / Lakk\n1. Francais\n2. Wolof");
    expect((await phone.press("2")).text).toMatch(/^Meeri Ndiedieng\n1\. Yegle lu yaqu\n/);
    // Remembered: the next call goes straight to the menu.
    phone.hangUp();
    expect((await phone.dial("*123#")).text).toMatch(/^Meeri Ndiedieng/);
  });

  it("asks the language before following a dial string on a first call", async () => {
    const { phone, commune } = await setup(chefPhone(7), null);
    expect((await phone.dial("*123*1*4*3#")).text).toMatch(/^Langue/);
    expect(commune.signalements()).toHaveLength(0);
  });

  it("records a breakdown in Wolof, every screen on one USSD page", async () => {
    const { phone, commune } = await setup(chefPhone(7), "wo");
    const screens = [await phone.dial("*123#"), await phone.press("1"), await phone.press("1"), await phone.press("1")];
    for (const s of screens) expect(s.text.length).toBeLessThanOrEqual(160);
    expect(screens[3]!.text).toBe(plain(`${TEXT["breakdown.urgency"].wo}\n1. ${TEXT["breakdown.urgent"].wo}\n2. ${TEXT["breakdown.annoying"].wo}\n3. ${TEXT["breakdown.canWait"].wo}`));
    const done = await phone.press("1");
    expect(done.text).toBe("Yegle S-0001 bind nanu ko: forage, Village 07, yakkamti na. Dinga jot SMS su nu ko defaree.");
    // The Mairie's record stays in French.
    expect(commune.signalement("S-0001")).toMatchObject({ categorie: "eau", urgence: "haute", description: "forage en panne" });
  });

  it("declares a birth and follows a report in Wolof", async () => {
    const { phone } = await setup(chefPhone(7), "wo");
    await phone.dial("*123#");
    expect((await phone.press("2")).text).toBe(plain(TEXT["civil.birthName"].wo));
    await phone.press("Awa Diop");
    expect((await phone.press("demain")).text).toMatch(/^Bis bi deggul\. Ban bis la juddu\?/);
    expect((await phone.press("14/11/2026")).text).toMatch(/^Juddu bi, bind nanu ko ak limu S-0001\. Meeri bi dina la woo/);
    await phone.dial("*123#");
    await phone.press("4");
    expect((await phone.press("S-0001")).text).toBe("S-0001 (juddu): agsi na.");
  });

  it("answers a free SMS in Wolof, accents kept", async () => {
    const { phone } = await setup(chefPhone(7), "wo");
    await phone.sendSms("salaam");
    await phone.sendSms("5");
    await phone.sendSms("forage bi dafa yàqu, amul ndox");
    expect(phone.inbox.at(-1)!.text).toMatch(/^Bataaxal bi agsi na \(S-0001\): ndox, forage, .*Jërëjëf\.$/);
  });

  it("lets a chief switch language from the menu", async () => {
    const { phone, agent } = await setup(chefPhone(7), "fr");
    await phone.dial("*123#");
    await phone.press("6");
    await phone.press("2");
    expect(await agent.languageOf(chefPhone(7))).toBe("wo");
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
