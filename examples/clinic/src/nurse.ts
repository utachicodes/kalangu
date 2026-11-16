/**
 * A stand-in for a real model: canned answers after a fixed delay. The
 * delay (6 s by default) is longer than the agent's 4 s deadline, so the
 * demo always shows the "we'll text you" path, with no API key needed.
 *
 * To use a real model, replace this with any object your handlers call;
 * Kalangu only passes it through as `ctx.model`.
 */

export interface NurseModel {
  answer(question: string, locale: string): Promise<string>;
}

export interface FakeNurseOptions {
  delayMs?: number;
}

const ANSWERS: Array<{ match: RegExp; en: string; fr: string }> = [
  {
    match: /sunday|dimanche/i,
    en: "The clinic is closed on Sundays. For emergencies, go to the district hospital.",
    fr: "La clinique est fermée le dimanche. En cas d'urgence, allez à l'hôpital de district.",
  },
  {
    match: /fever|fièvre|fievre|temperature/i,
    en: "A fever over 38 C for more than two days needs a visit. Drink water and rest until then.",
    fr: "Une fièvre de plus de 38 C pendant plus de deux jours demande une visite. Buvez de l'eau et reposez-vous.",
  },
  {
    match: /vaccin/i,
    en: "Vaccinations are on Tuesday and Thursday mornings. Bring the child's health card.",
    fr: "Les vaccinations ont lieu le mardi et le jeudi matin. Apportez le carnet de santé de l'enfant.",
  },
];

const FALLBACK = {
  en: "Thank you. A nurse will look at your question and call you back today.",
  fr: "Merci. Une infirmière va étudier votre question et vous rappeler aujourd'hui.",
};

export function fakeNurse(options: FakeNurseOptions = {}): NurseModel {
  const delayMs = options.delayMs ?? 6000;
  return {
    async answer(question, locale) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      const lang = locale === "fr" ? "fr" : "en";
      const hit = ANSWERS.find((a) => a.match.test(question));
      return hit ? hit[lang] : FALLBACK[lang];
    },
  };
}
