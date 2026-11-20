import { afterEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { checkQuery, geminiAssistant, ruleAssistant } from "../src/assistant.js";
import { promptFor } from "../src/gemini.js";
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
    expect(a.answer).toMatch(/Je ne sais pas encore/);
    expect(a.suggestions).toHaveLength(4);
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
    expect(a.answer).toMatch(/fiches territoriales/);
    expect(c.signalements().length).toBeGreaterThan(0);
  });

  it("answers a greeting itself, without a query", async () => {
    const call = async () => ({ sql: "", reponse: "Bonjour ! Demandez-moi par exemple quels forages sont en panne." });
    const a = await geminiAssistant(commune(), { call }).ask("Hello");
    expect(a).toMatchObject({ sql: null, par: "gemini", answer: "Bonjour ! Demandez-moi par exemple quels forages sont en panne." });
  });

  it("goes through any caller, such as the website's function", async () => {
    const tasks: string[] = [];
    const call = async (t: { task: string }) => {
      tasks.push(t.task);
      return t.task === "plan" ? { sql: "SELECT COUNT(*) AS n FROM villages", reponse: "" } : { reponse: "58 villages." };
    };
    const a = await geminiAssistant(commune(), { call }).ask("Combien de villages ?");
    expect(tasks).toEqual(["plan", "answer"]);
    expect(a).toMatchObject({ answer: "58 villages.", rows: [{ n: 58 }] });
  });
});

describe("answering in the question's language", () => {
  it("passes Wolof from the question to the answer", async () => {
    const tasks: any[] = [];
    const call = async (t: any) => {
      tasks.push(t);
      return t.task === "plan" ? { langue: "wo", sql: "SELECT COUNT(*) AS n FROM villages", reponse: "" } : { reponse: "58 dëkk ñoo am." };
    };
    const a = await geminiAssistant(commune(), { call }).ask("Ñaata dëkk ñoo am ?");
    expect(tasks[1]).toMatchObject({ task: "answer", langue: "wo" });
    expect(a).toMatchObject({ langue: "wo", answer: "58 dëkk ñoo am." });
  });

  it("asks for Wolof in the prompts, and refuses another language", () => {
    const answer = promptFor({ task: "answer", question: "q", sql: "SELECT 1", rows: [], langue: "wo" });
    expect(typeof answer === "object" && answer.system).toMatch(/en wolof du Sénégal/);
    const spoken = promptFor({ task: "speak", text: "Jërëjëf", langue: "wo" });
    expect(typeof spoken === "object" && spoken.user).toMatch(/^Lis ceci en wolof/);
    expect(promptFor({ task: "speak", text: "Hello", langue: "en" })).toBe("langue must be fr or wo");
    expect(promptFor({ task: "answer", question: "q", sql: "SELECT 1", rows: [] })).toMatchObject({ system: expect.stringMatching(/en français correct/) });
  });
});

describe("rule assistant small talk", () => {
  it("greets back, thanks back, and offers questions", async () => {
    const r = ruleAssistant(commune());
    const hi = await r.ask("Hello");
    expect(hi.answer).toMatch(/^Bonjour !/);
    expect(hi.suggestions).toHaveLength(4);
    expect((await r.ask("Merci beaucoup")).answer).toMatch(/Avec plaisir/);
    expect((await r.ask("Bonjour, quels forages sont en panne depuis le mois dernier dans la commune ?")).sql).toMatch(/^SELECT/);
  });
});

describe("what the Gemini tasks accept", () => {
  it("builds a prompt only for a known task within limits", () => {
    expect(promptFor({ task: "plan", question: "Combien de villages ?" })).toMatchObject({ user: "Combien de villages ?" });
    expect(promptFor({ task: "write me a poem" })).toBe("unknown task");
    expect(promptFor({ task: "plan", question: "x".repeat(501) })).toMatch(/too long/);
    expect(promptFor({ task: "answer", question: "q", sql: "SELECT 1", rows: Array(10).fill({ t: "x".repeat(3000) }) })).toMatch(/within limits/);
    expect(promptFor(null)).toBe("a task is required");
  });
});
