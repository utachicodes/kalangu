import { afterEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { checkQuery, geminiAssistant, ruleAssistant } from "../src/assistant.js";
import type { Commune } from "../src/db.js";
import { openCommune } from "../src/nodeSql.js";

const open: Commune[] = [];
afterEach(() => open.splice(0).forEach((c) => c.close()));
const commune = () => {
  const c = openCommune();
  open.push(c);
  return c;
};

describe("the fictitious territory", () => {
  it("has the commune's sizes: 58 villages, 200 equipments, 499 records", () => {
    const c = commune();
    const db = new DatabaseSync(c.path, { readOnly: true });
    const count = (t: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
    expect([count("villages"), count("chefs"), count("equipements"), count("fiches")]).toEqual([58, 58, 200, 499]);
    db.close();
  });
});

describe("checkQuery", () => {
  it("lets one SELECT through and nothing that writes", () => {
    expect(checkQuery("SELECT * FROM villages;")).toBeNull();
    expect(checkQuery("WITH x AS (SELECT 1) SELECT * FROM x")).toBeNull();
    expect(checkQuery("DELETE FROM villages")).toMatch(/only a SELECT/);
    expect(checkQuery("SELECT 1; DROP TABLE villages")).toMatch(/one statement/);
    expect(checkQuery("SELECT * FROM villages WHERE 1 = (SELECT 1) UNION SELECT load_extension('x')")).toMatch(/forbidden/);
  });

  it("runs on a connection that cannot write even if a query got through", () => {
    const c = commune();
    const ro = new DatabaseSync(c.path, { readOnly: true });
    expect(() => ro.exec("DELETE FROM villages")).toThrow();
    ro.close();
  });
});

describe("rule assistant", () => {
  it.each([
    ["Quels forages sont en panne ?", /forage\(s\) en panne/, "village"],
    ["Quels villages ont le plus de pannes ?", /Villages avec le plus de pannes/, "pannes"],
    ["Combien de naissances ce mois-ci ?", /naissance/, null],
    ["Quels signalements urgents sont en attente ?", /urgent/, "code"],
    ["Combien de fiches sont à mettre à jour ?", /499 fiches territoriales/, "fiches"],
    ["Combien d'équipements ?", /200 équipements inventoriés/, "equipements"],
  ])("answers %j from the data, with its query", async (question, answer, column) => {
    const a = await ruleAssistant(commune()).ask(question);
    expect(a.answer).toMatch(answer);
    expect(a.sql).toMatch(/^SELECT/);
    if (column) expect(a.columns).toContain(column);
  });

  it("says what it can answer when it does not recognise a question", async () => {
    const a = await ruleAssistant(commune()).ask("Quel temps fera-t-il demain ?");
    expect(a.sql).toBeNull();
    expect(a.answer).toMatch(/questions courantes/);
  });
});

describe("Gemini assistant", () => {
  /** A fake Gemini that writes `sql`, then answers from the rows it is given. */
  function fakeGemini(sql: string) {
    const prompts: string[] = [];
    const fetch = (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { contents: Array<{ parts: Array<{ text: string }> }> };
      const text = body.contents[0]!.parts[0]!.text;
      prompts.push(text);
      const out = text.startsWith("Question :") ? { reponse: `Réponse tirée de ${text.match(/Resultats .*: (.*)$/s)![1]!.length} caractères de résultats.` } : { sql };
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(out) }] } }] }));
    }) as unknown as typeof globalThis.fetch;
    return { fetch, prompts };
  }

  it("runs the query it wrote, read-only, and answers from the rows", async () => {
    const g = fakeGemini("SELECT COUNT(*) AS n FROM villages");
    const a = await geminiAssistant(commune(), { apiKey: "k", fetch: g.fetch }).ask("Combien de villages ?");
    expect(a).toMatchObject({ sql: "SELECT COUNT(*) AS n FROM villages", columns: ["n"], rows: [{ n: 58 }], par: "gemini" });
    expect(g.prompts[1]).toContain('[{"n":58}]');
  });

  it("refuses a query that writes, falling back to the rules", async () => {
    const c = commune();
    const g = fakeGemini("DELETE FROM signalements");
    const a = await geminiAssistant(c, { apiKey: "k", fetch: g.fetch }).ask("Combien de fiches ?");
    expect(a.par).toBe("regles");
    expect(a.answer).toMatch(/Gemini indisponible : only a SELECT can run/);
    expect(c.signalements().length).toBeGreaterThan(0);
  });
});
