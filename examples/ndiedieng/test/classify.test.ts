import { describe, expect, it } from "vitest";
import { fold, geminiClassifier, keywordClassifier, REVIEW_BELOW } from "../src/classify.js";

const k = keywordClassifier();

describe("keyword classifier", () => {
  it.each([
    ["Le forage est en panne depuis hier", "eau", "forage", "haute"],
    ["la borne fontaine fuit", "eau", "borne-fontaine", "haute"],
    ["Le lampadaire solaire ne s'allume plus", "energie", "lampadaire solaire", "basse"],
    ["La piste est coupée par l'eau, on ne passe plus", "piste", "piste", "haute"],
    ["Il manque des médicaments au poste de santé", "sante", "poste de sante", "haute"],
    ["Le toit de l'école est tombé dans une classe", "ecole", "salle de classe", "basse"],
    ["Naissance d'un garçon ce matin", "naissance", null, "moyenne"],
  ])("sorts %j", async (text, categorie, nature, urgence) => {
    const c = await k.classify(text);
    expect(c).toMatchObject({ categorie, nature, urgence, par: "mots-cles" });
    expect(c.confiance).toBeGreaterThanOrEqual(REVIEW_BELOW);
  });

  it("sends an unclear message to be checked", async () => {
    const c = await k.classify("Il faut venir voir");
    expect(c.categorie).toBe("autre");
    expect(c.confiance).toBeLessThan(REVIEW_BELOW);
  });

  it("is doubtful when two kinds are named equally", async () => {
    const c = await k.classify("eau et electricite");
    expect(c.confiance).toBeLessThan(REVIEW_BELOW);
  });

  it("ignores accents, case and apostrophes", () => {
    expect(fold("Château d’Eau  ÉCOLE")).toBe("chateau d eau ecole");
  });
});

describe("Gemini classifier", () => {
  const reply = (body: unknown, status = 200) =>
    (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

  it("uses Gemini's fixed-shape answer, never sending the key in the URL", async () => {
    let seen: { url: string; key: string | null } | null = null;
    const fetch = (async (url: string, init: RequestInit) => {
      seen = { url, key: (init.headers as Record<string, string>)["x-goog-api-key"] ?? null };
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ categorie: "eau", nature: "forage", urgence: "haute", confiance: 0.92 }) }] } }] }));
    }) as unknown as typeof globalThis.fetch;
    const c = await geminiClassifier({ apiKey: "test-key", fetch, warn: () => {} }).classify("ndox mi dafa yaxu");
    expect(c).toEqual({ categorie: "eau", nature: "forage", urgence: "haute", confiance: 0.92, par: "gemini" });
    expect(seen!.url).not.toContain("test-key");
    expect(seen!.key).toBe("test-key");
  });

  it("falls back to the keywords when Gemini fails or answers nonsense", async () => {
    const warnings: string[] = [];
    const down = await geminiClassifier({ apiKey: "k", fetch: reply({ error: {} }, 500), warn: (m) => void warnings.push(m) }).classify("forage en panne");
    expect(down).toMatchObject({ categorie: "eau", par: "mots-cles" });
    const odd = await geminiClassifier({
      apiKey: "k",
      fetch: reply({ candidates: [{ content: { parts: [{ text: JSON.stringify({ categorie: "meteo", nature: "x", urgence: "haute", confiance: 1 }) }] } }] }),
      warn: (m) => void warnings.push(m),
    }).classify("forage en panne");
    expect(odd.par).toBe("mots-cles");
    expect(warnings).toHaveLength(2);
  });
});
