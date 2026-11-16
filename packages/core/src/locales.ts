/**
 * Fixed strings the toolkit itself shows to users (docs/design.md §4.7).
 * Agent content (menu titles, answers) belongs to the developer; these are
 * the strings Kalangu adds around it.
 */

export type MessageKey =
  | "common.more"
  | "common.back"
  | "common.yes"
  | "common.no"
  | "common.deferredNotice"
  | "common.invalidChoice"
  | "common.invalidNumber"
  | "common.typeAnswer"
  | "common.replyYesNo"
  | "common.error";

export type Messages = Readonly<Record<MessageKey, string>>;

export const en: Messages = {
  "common.more": "More",
  "common.back": "Back",
  "common.yes": "Yes",
  "common.no": "No",
  "common.deferredNotice": "We are working on your question. You will receive an SMS shortly.",
  "common.invalidChoice": "Invalid choice. Try again.",
  "common.invalidNumber": "Please enter a number.",
  "common.typeAnswer": "Please type an answer.",
  "common.replyYesNo": "Reply {yes} or {no}",
  "common.error": "Sorry, something went wrong. Please try again later.",
};

export const fr: Messages = {
  "common.more": "Suite",
  "common.back": "Retour",
  "common.yes": "Oui",
  "common.no": "Non",
  "common.deferredNotice": "Nous traitons votre question. Vous recevrez un SMS sous peu.",
  "common.invalidChoice": "Choix invalide. Réessayez.",
  "common.invalidNumber": "Veuillez saisir un nombre.",
  "common.typeAnswer": "Veuillez saisir une réponse.",
  "common.replyYesNo": "Répondez {yes} ou {no}",
  "common.error": "Désolé, une erreur est survenue. Veuillez réessayer plus tard.",
};

export const BUILTIN_MESSAGES: Readonly<Record<string, Messages>> = { en, fr };

export type Translate = (key: MessageKey, vars?: Readonly<Record<string, string>>) => string;

/** Developer text that may vary by locale: a plain string or `{ en: "...", fr: "..." }`. */
export type Text = string | Readonly<Record<string, string>>;

export interface Catalog {
  readonly defaultLocale: string;
  has(locale: string): boolean;
  translator(locale: string): Translate;
  localize(text: Text, locale: string): string;
}

/**
 * Builds the catalog from the built-in locales plus developer overrides.
 * A missing key falls back to the default locale, then to English.
 */
export function createCatalog(
  defaultLocale = "en",
  overrides: Readonly<Record<string, Partial<Messages>>> = {},
): Catalog {
  const merged: Record<string, Partial<Messages>> = {};
  for (const [locale, messages] of Object.entries(BUILTIN_MESSAGES)) merged[locale] = { ...messages };
  for (const [locale, messages] of Object.entries(overrides)) merged[locale] = { ...merged[locale], ...messages };

  if (!merged[defaultLocale]) {
    throw new RangeError(
      `Default locale ${JSON.stringify(defaultLocale)} has no messages; pass them in \`messages\`.`,
    );
  }

  const lookup = (locale: string, key: MessageKey): string =>
    merged[locale]?.[key] ?? merged[defaultLocale]?.[key] ?? en[key];

  return {
    defaultLocale,
    has: (locale) => locale in merged,
    translator: (locale) => (key, vars) => interpolate(lookup(locale, key), vars),
    localize: (text, locale) => {
      if (typeof text === "string") return text;
      const value = text[locale] ?? text[defaultLocale] ?? Object.values(text)[0];
      if (value === undefined) throw new TypeError("Localized text has no translations");
      return value;
    },
  };
}

function interpolate(template: string, vars?: Readonly<Record<string, string>>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => vars[name] ?? match);
}
