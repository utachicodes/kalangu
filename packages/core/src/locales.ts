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
  | "common.error"
  | "payments.confirm"
  | "payments.confirmNoReason"
  | "payments.pinPrompt"
  | "payments.refused"
  | "payments.notStarted"
  | "payments.failed"
  | "payments.unresolved"
  | "payments.receipt"
  | "payments.alreadyStarted"
  | "payments.refusal.currency"
  | "payments.refusal.per-payment"
  | "payments.refusal.per-day"
  | "payments.refusal.pending-limit"
  | "payments.refusal.provider-closed"
  | "payments.refusal.amount-bounds"
  | "payments.refusal.decimals"
  | "payments.refusal.unknown-operator";

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
  "payments.confirm": "Pay {amount} {currency} to {payee} for {reason}?",
  "payments.confirmNoReason": "Pay {amount} {currency} to {payee}?",
  "payments.pinPrompt": "You will receive a prompt to enter your PIN.",
  "payments.refused": "Sorry, this payment cannot be made. {why}",
  "payments.notStarted": "Sorry, the payment could not be started. Nothing was charged.",
  "payments.failed": "The payment was not completed. Nothing was charged.",
  "payments.unresolved": "We could not confirm your payment. Please contact {payee} before paying again.",
  "payments.receipt": "Receipt: {amount} {currency} paid to {payee}. Ref {ref}.",
  "payments.alreadyStarted": "Your payment is already being processed.",
  "payments.refusal.currency": "Payments in {currency} are not accepted.",
  "payments.refusal.per-payment": "This payment is above the allowed limit.",
  "payments.refusal.per-day": "You have reached the daily payment limit.",
  "payments.refusal.pending-limit": "You already have a payment in progress. Finish it first.",
  "payments.refusal.provider-closed": "Payments with your operator are unavailable right now. Please try later.",
  "payments.refusal.amount-bounds": "This amount is not supported by your operator.",
  "payments.refusal.decimals": "This amount is not supported by your operator.",
  "payments.refusal.unknown-operator": "We could not identify your mobile money operator.",
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
  "payments.confirm": "Payer {amount} {currency} à {payee} pour {reason} ?",
  "payments.confirmNoReason": "Payer {amount} {currency} à {payee} ?",
  "payments.pinPrompt": "Vous allez recevoir une demande de saisie de votre code PIN.",
  "payments.refused": "Désolé, ce paiement ne peut pas être effectué. {why}",
  "payments.notStarted": "Désolé, le paiement n'a pas pu démarrer. Rien n'a été débité.",
  "payments.failed": "Le paiement n'a pas abouti. Rien n'a été débité.",
  "payments.unresolved": "Nous n'avons pas pu confirmer votre paiement. Contactez {payee} avant de payer à nouveau.",
  "payments.receipt": "Reçu : {amount} {currency} payé à {payee}. Réf {ref}.",
  "payments.alreadyStarted": "Votre paiement est déjà en cours de traitement.",
  "payments.refusal.currency": "Les paiements en {currency} ne sont pas acceptés.",
  "payments.refusal.per-payment": "Ce paiement dépasse la limite autorisée.",
  "payments.refusal.per-day": "Vous avez atteint la limite de paiement journalière.",
  "payments.refusal.pending-limit": "Vous avez déjà un paiement en cours. Attendez sa fin.",
  "payments.refusal.provider-closed": "Les paiements avec votre opérateur sont indisponibles pour le moment. Réessayez plus tard.",
  "payments.refusal.amount-bounds": "Ce montant n'est pas pris en charge par votre opérateur.",
  "payments.refusal.decimals": "Ce montant n'est pas pris en charge par votre opérateur.",
  "payments.refusal.unknown-operator": "Nous n'avons pas pu identifier votre opérateur de mobile money.",
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
