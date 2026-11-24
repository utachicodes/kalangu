/**
 * Languages the user can choose between (docs/languages-design.md §4).
 *
 * The cheapest reliable signal of a user's language on a keypad is their own
 * choice, so the engine asks once and remembers it. The phone number's
 * country code only decides the order of the menu: a prior, never a guess
 * about the person.
 */

export interface Language {
  /** The locale code, e.g. "wo". Must have messages: built in, or passed to `createAgent({ messages })`. */
  readonly code: string;
  /** The language's own name, in that language ("Français", "Wolof"): a user who cannot read the menu cannot choose from it. */
  readonly name: string;
}

/** Calling code (digits, no "+") to the locales to list first, most likely first. */
export type LanguagePriors = Readonly<Record<string, readonly string[]>>;

/**
 * Starting points for the first markets, only ever used to order a menu that
 * lists every supported language anyway. They are broad on purpose, easy to
 * correct, and replaceable: pass your own `priors`.
 */
export const DEFAULT_LANGUAGE_PRIORS: LanguagePriors = {
  "220": ["en", "wo"], // Gambia
  "221": ["fr", "wo", "en"], // Senegal
  "223": ["fr", "bm"], // Mali
  "224": ["fr"], // Guinea
  "225": ["fr"], // Côte d'Ivoire
  "226": ["fr"], // Burkina Faso
  "227": ["fr", "ha"], // Niger
  "228": ["fr"], // Togo
  "229": ["fr"], // Benin
  "233": ["en"], // Ghana
  "234": ["en", "ha"], // Nigeria
  "243": ["fr", "sw"], // DR Congo
  "254": ["sw", "en"], // Kenya
  "255": ["sw", "en"], // Tanzania
  "256": ["en", "sw"], // Uganda
};

/**
 * The longest calling code in `priors` that the number starts with, or null.
 * Only an E.164 number (digits, with an optional leading "+") has one: a
 * business-scoped WhatsApp id does not, and gets none.
 */
export function callingCodeOf(phone: string, priors: LanguagePriors): string | null {
  const digits = phone.startsWith("+") ? phone.slice(1) : phone;
  if (!/^\d+$/.test(digits)) return null;
  let best: string | null = null;
  for (const code of Object.keys(priors)) {
    if (digits.startsWith(code) && (best === null || code.length > best.length)) best = code;
  }
  return best;
}

/**
 * `languages` with the ones likely for this number first, in the prior's
 * order, then the rest in the order given. Every language appears exactly
 * once, so the prior can reorder the menu but never hide a choice.
 */
export function orderLanguages(
  languages: readonly Language[],
  phone: string,
  priors: LanguagePriors = DEFAULT_LANGUAGE_PRIORS,
): Language[] {
  const code = callingCodeOf(phone, priors);
  const likely = code === null ? [] : (priors[code] ?? []);
  const first: Language[] = [];
  for (const wanted of likely) {
    const language = languages.find((l) => l.code === wanted);
    if (language && !first.includes(language)) first.push(language);
  }
  return [...first, ...languages.filter((l) => !first.includes(l))];
}

/** What a detector thinks the text is written in. */
export interface DetectedLanguage {
  /** A locale code from the candidates it was given. */
  readonly code: string;
  /** How sure it is, 0 to 1. What this means differs between detectors: measure before choosing a threshold. */
  readonly confidence: number;
}

/**
 * A language detector (docs/languages-design.md §5). Kalangu ships none:
 * wrap a service, a model or a heuristic. It must answer from `candidates`
 * (the agent's languages) or return null; anything else is ignored.
 */
export interface LanguageDetector {
  detect(text: string, options: { readonly candidates: readonly string[] }): Promise<DetectedLanguage | null>;
}

/** Detection as a hint: offers to switch language, never switches silently. */
export interface LanguageDetection {
  readonly detector: LanguageDetector;
  /** Minimum confidence to offer a switch. Required: no default until one is measured. */
  readonly threshold: number;
  /** Shorter typed answers are never sent to the detector. Required, for the same reason. */
  readonly minChars: number;
  /** Give up on a slow detector after this long and carry on without it. Default 1000 ms. */
  readonly timeoutMs?: number;
}

export const DEFAULT_DETECTION_TIMEOUT_MS = 1000;
