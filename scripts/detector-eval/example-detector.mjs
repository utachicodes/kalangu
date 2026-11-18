/**
 * A toy detector for trying scripts/eval-detector.mjs: it counts common
 * English and French words. It is here to show the shape a detector must
 * have, not to be used. A real one is a model such as CommonLingua run as a
 * service (docs/languages-design.md §6).
 *
 * The shape: detect(text, { candidates }) resolves to { code, confidence }
 * with code one of the candidates and confidence from 0 to 1, or null.
 */

const WORDS = {
  en: ["the", "is", "are", "you", "i", "my", "to", "and", "what", "when", "open", "please", "how", "do", "can", "where", "hello", "today", "tomorrow", "child"],
  fr: ["le", "la", "les", "est", "vous", "je", "mon", "ma", "et", "quand", "ouvert", "bonjour", "comment", "où", "demain", "aujourd'hui", "enfant", "pour", "une", "un"],
};

export default {
  async detect(text, { candidates }) {
    const tokens = text.toLowerCase().split(/[^\p{L}']+/u).filter(Boolean);
    const scores = Object.entries(WORDS)
      .filter(([code]) => candidates.includes(code))
      .map(([code, words]) => ({ code, hits: tokens.filter((t) => words.includes(t)).length }))
      .sort((a, b) => b.hits - a.hits);
    const total = scores.reduce((sum, s) => sum + s.hits, 0);
    if (total === 0 || !scores[0]) return null;
    return { code: scores[0].code, confidence: scores[0].hits / total };
  },
};
