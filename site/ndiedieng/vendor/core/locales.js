/**
 * Fixed strings the toolkit itself shows to users (docs/design.md §4.7).
 * Agent content (menu titles, answers) belongs to the developer; these are
 * the strings Kalangu adds around it.
 */
export const en = {
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
    "common.expiredChoice": "That choice has expired.",
    "common.language": "Language",
    "common.suggestLanguage": "Continue in {language}?",
    "payments.confirm": "Pay {amount} {currency} to {payee} for {reason}?",
    "payments.confirmNoReason": "Pay {amount} {currency} to {payee}?",
    "payments.pinPrompt": "You will receive a prompt to enter your PIN.",
    "payments.refused": "Sorry, this payment cannot be made. {why}",
    "payments.notStarted": "Sorry, the payment could not be started. Nothing was charged.",
    "payments.failed": "The payment was not completed. Nothing was charged.",
    "payments.unresolved": "We could not confirm your payment. Please contact {payee} before paying again.",
    "payments.receipt": "Receipt: {amount} {currency} paid to {payee}. Ref {ref}.",
    "payments.alreadyStarted": "Your payment is already being processed.",
    "payments.unavailable": "Payments are unavailable right now. Nothing was charged. Please try again later.",
    "payments.paid": "Payment received. Thank you.",
    "payments.refusal.currency": "Payments in {currency} are not accepted.",
    "payments.refusal.per-payment": "This payment is above the allowed limit.",
    "payments.refusal.per-day": "You have reached the daily payment limit.",
    "payments.refusal.pending-limit": "You already have a payment in progress. Finish it first.",
    "payments.refusal.provider-closed": "Payments with your operator are unavailable right now. Please try later.",
    "payments.refusal.amount-bounds": "This amount is not supported by your operator.",
    "payments.refusal.decimals": "This amount is not supported by your operator.",
    "payments.refusal.unknown-operator": "We could not identify your mobile money operator.",
};
export const fr = {
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
    "common.expiredChoice": "Ce choix a expiré.",
    "common.language": "Langue",
    "common.suggestLanguage": "Continuer en {language} ?",
    "payments.confirm": "Payer {amount} {currency} à {payee} pour {reason} ?",
    "payments.confirmNoReason": "Payer {amount} {currency} à {payee} ?",
    "payments.pinPrompt": "Vous allez recevoir une demande de saisie de votre code PIN.",
    "payments.refused": "Désolé, ce paiement ne peut pas être effectué. {why}",
    "payments.notStarted": "Désolé, le paiement n'a pas pu démarrer. Rien n'a été débité.",
    "payments.failed": "Le paiement n'a pas abouti. Rien n'a été débité.",
    "payments.unresolved": "Nous n'avons pas pu confirmer votre paiement. Contactez {payee} avant de payer à nouveau.",
    "payments.receipt": "Reçu : {amount} {currency} payé à {payee}. Réf {ref}.",
    "payments.alreadyStarted": "Votre paiement est déjà en cours de traitement.",
    "payments.unavailable": "Les paiements sont indisponibles pour le moment. Rien n'a été débité. Réessayez plus tard.",
    "payments.paid": "Paiement reçu. Merci.",
    "payments.refusal.currency": "Les paiements en {currency} ne sont pas acceptés.",
    "payments.refusal.per-payment": "Ce paiement dépasse la limite autorisée.",
    "payments.refusal.per-day": "Vous avez atteint la limite de paiement journalière.",
    "payments.refusal.pending-limit": "Vous avez déjà un paiement en cours. Attendez sa fin.",
    "payments.refusal.provider-closed": "Les paiements avec votre opérateur sont indisponibles pour le moment. Réessayez plus tard.",
    "payments.refusal.amount-bounds": "Ce montant n'est pas pris en charge par votre opérateur.",
    "payments.refusal.decimals": "Ce montant n'est pas pris en charge par votre opérateur.",
    "payments.refusal.unknown-operator": "Nous n'avons pas pu identifier votre opérateur de mobile money.",
};
export const BUILTIN_MESSAGES = { en, fr };
/**
 * Builds the catalog from the built-in locales plus developer overrides.
 * A missing key falls back to the default locale, then to English.
 */
export function createCatalog(defaultLocale = "en", overrides = {}) {
    const merged = {};
    for (const [locale, messages] of Object.entries(BUILTIN_MESSAGES))
        merged[locale] = { ...messages };
    for (const [locale, messages] of Object.entries(overrides))
        merged[locale] = { ...merged[locale], ...messages };
    if (!merged[defaultLocale]) {
        throw new RangeError(`Default locale ${JSON.stringify(defaultLocale)} has no messages; pass them in \`messages\`.`);
    }
    const lookup = (locale, key) => merged[locale]?.[key] ?? merged[defaultLocale]?.[key] ?? en[key];
    return {
        defaultLocale,
        has: (locale) => locale in merged,
        translator: (locale) => (key, vars) => interpolate(lookup(locale, key), vars),
        localize: (text, locale) => {
            if (typeof text === "string")
                return text;
            const value = text[locale] ?? text[defaultLocale] ?? Object.values(text)[0];
            if (value === undefined)
                throw new TypeError("Localized text has no translations");
            return value;
        },
    };
}
function interpolate(template, vars) {
    if (!vars)
        return template;
    return template.replace(/\{(\w+)\}/g, (match, name) => vars[name] ?? match);
}