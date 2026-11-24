import { afterEach, describe, expect, it } from "vitest";
import { memoryStore, silentLogger } from "@kalangu/core";
import { createPhone } from "@kalangu/sim";
import { createNdiediengAgent } from "../src/agent.js";
import { keywordClassifier } from "../src/classify.js";
import { chefPhone } from "../src/data.js";
import type { Commune } from "../src/db.js";
import { keepingLanguages, type ChosenLanguages } from "../src/keptLanguages.js";
import { openCommune } from "../src/nodeSql.js";

const open: Commune[] = [];
afterEach(() => open.splice(0).forEach((c) => c.close()));

/** A fresh agent and phone, as after a page load, restoring `chosen`. */
async function load(chosen: ChosenLanguages) {
  const commune = openCommune({ history: false });
  open.push(commune);
  const sessionStore = await keepingLanguages(memoryStore(), chosen);
  const agent = createNdiediengAgent({ commune, classifier: keywordClassifier(), channels: [], logger: silentLogger, sessionStore });
  return createPhone(agent, { phone: chefPhone(7), code: "*123#", sender: "MAIRIE" });
}

describe("the chiefs' languages across a reload", () => {
  it("are noted when chosen, and not asked again after a reload", async () => {
    const chosen: ChosenLanguages = new Map();
    const before = await load(chosen);
    expect((await before.dial("*123#")).text).toMatch(/^Langue/);
    expect(chosen.size).toBe(0); // shown, not chosen yet
    await before.press("2");
    expect([...chosen]).toEqual([[chefPhone(7), "wo"]]);

    const after = await load(new Map(chosen));
    expect((await after.dial("*123#")).text).toMatch(/^Meeri Ndiedieng\n/);
  });

  it("follow a switch from the menu", async () => {
    const chosen: ChosenLanguages = new Map([[chefPhone(7), "wo"]]);
    const phone = await load(chosen);
    await phone.dial("*123#");
    await phone.press("6");
    await phone.press("1"); // Français
    expect(chosen.get(chefPhone(7))).toBe("fr");
    expect((await (await load(new Map(chosen))).dial("*123#")).text).toMatch(/^Mairie de Ndiedieng\n/);
  });

  it("ask a number never seen", async () => {
    expect((await (await load(new Map([["+221000000001", "wo"]]))).dial("*123#")).text).toMatch(/^Langue/);
  });
});
