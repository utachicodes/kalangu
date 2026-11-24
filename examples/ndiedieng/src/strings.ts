/**
 * Every string a village chief sees, in French and Wolof, in one place so a
 * speaker can review them together (wolof-review.csv is generated from this
 * file; `pnpm --filter @kalangu/example-ndiedieng wolof:sheet`).
 *
 * The Wolof is a DRAFT, not reviewed by a speaker yet: it must be checked
 * before the field tests. What the Mairie sees on its dashboard stays in
 * French.
 *
 * A `{name}` in a string is filled in when it is sent; keep each one when
 * correcting a translation.
 */

import { fr as KALANGU_FR, type MessageKey, type Messages } from "@kalangu/core";
import type { Categorie, Statut, Urgence } from "./db.js";

export type Lang = "fr" | "wo";

/** The chief's language from a Kalangu locale: Wolof, or French for anything else. */
export const langOf = (locale: string | null | undefined): Lang => (locale === "wo" ? "wo" : "fr");

export const REVIEWED = false;

interface Pair {
  readonly fr: string;
  readonly wo: string;
}

/** The agent's menus, questions and replies. */
export const TEXT = {
  "menu.title": { fr: "Mairie de Ndiédieng", wo: "Meeri Ndiédieng" },
  "menu.breakdown": { fr: "Signaler une panne", wo: "Yégle lu yàqu" },
  "menu.birth": { fr: "Déclarer une naissance", wo: "Yégle juddu" },
  "menu.death": { fr: "Déclarer un décès", wo: "Yégle ku faatu" },
  "menu.follow": { fr: "Suivre un signalement", wo: "Topp sa yégle" },
  "menu.message": { fr: "Écrire un message", wo: "Bind bataaxal" },
  "menu.language": { fr: "Langue / Làkk", wo: "Làkk / Langue" },

  "breakdown.type": { fr: "Type d'équipement ?", wo: "Ci ban wàll?" },
  "breakdown.water": { fr: "Eau", wo: "Ndox" },
  "breakdown.health": { fr: "Santé", wo: "Wér-gi-yaram" },
  "breakdown.school": { fr: "École", wo: "Lekool" },
  "breakdown.energy": { fr: "Énergie (lampadaire)", wo: "Mbëj (lampu mbedd)" },
  "breakdown.road": { fr: "Piste coupée", wo: "Yoon wu dagg" },
  "breakdown.which": { fr: "Quel équipement ?", wo: "Lan moo yàqu?" },
  "breakdown.urgency": { fr: "Urgence ?", wo: "Ndax dafa yàkkamti?" },
  "breakdown.urgent": { fr: "Urgent : service coupé", wo: "Dafa yàkkamti: dafa dog" },
  "breakdown.annoying": { fr: "Gênant, marche encore", wo: "Dafa sonal, waaye mu ngi dox" },
  "breakdown.canWait": { fr: "Peut attendre", wo: "Mën na xaar" },
  "breakdown.done": {
    fr: "Signalement {code} enregistré : {what}, {village}, urgence {urgency}. Un SMS vous dira quand il est traité.",
    wo: "Yégle {code} bind nañu ko: {what}, {village}, {urgency}. Dinga jot SMS su ñu ko defaree.",
  },

  "civil.birthName": { fr: "Prénom et nom de l'enfant ?", wo: "Turu xale bi ak santam?" },
  "civil.deathName": { fr: "Prénom et nom du défunt ?", wo: "Turu ki faatu ak santam?" },
  "civil.birthDate": { fr: "Date de naissance ? (JJ/MM/AAAA)", wo: "Ban bis la juddu? (misaal: 14/11/2026)" },
  "civil.deathDate": { fr: "Date du décès ? (JJ/MM/AAAA)", wo: "Ban bis la faatu? (misaal: 14/11/2026)" },
  "civil.badDate": { fr: "Date non valide.", wo: "Bis bi dëggul." },
  "civil.birthDone": {
    fr: "Naissance pré-déclarée sous le numéro {code}. L'officier d'état civil vous contactera pour l'acte.",
    wo: "Juddu bi, bind nañu ko ak limu {code}. Meeri bi dina la woo ngir kayit bi.",
  },
  "civil.deathDone": {
    fr: "Décès pré-déclaré sous le numéro {code}. L'officier d'état civil vous contactera pour l'acte.",
    wo: "Yégle bi, bind nañu ko ak limu {code}. Meeri bi dina la woo ngir kayit bi.",
  },

  "follow.ask": { fr: "Numéro de suivi ? (ex. S-0042)", wo: "Limu yégle bi? (misaal: S-0042)" },
  "follow.unknown": {
    fr: "Numéro inconnu pour votre village. Vérifiez le numéro reçu par SMS.",
    wo: "Lim bii nekkul ci sa dëkk. Seetal lim bi nga jot ci SMS bi.",
  },
  "follow.status": { fr: "{code} ({what}) : {status}.", wo: "{code} ({what}): {status}." },

  "message.ask": { fr: "Décrivez le problème ou la déclaration :", wo: "Bindal jafe-jafe bi walla li ngay yégle:" },
  "message.toCheck": {
    fr: "Message reçu ({code}). La Mairie va le vérifier et vous répondra par SMS.",
    wo: "Bataaxal bi agsi na ({code}). Meeri bi dina ko seet te tontu la ci SMS.",
  },
  "message.sorted": {
    fr: "Message reçu ({code}) : {what}, urgence {urgency}. Merci.",
    wo: "Bataaxal bi agsi na ({code}): {what}, {urgency}. Jërëjëf.",
  },

  notRegistered: {
    fr: "Ce numéro n'est pas enregistré comme chef de village. Contactez la Mairie pour l'ajouter.",
    wo: "Nimero bii bindeesu ko ci njiiti dëkk yi. Jokkool ak Meeri bi ngir ñu yokk ko.",
  },

  "sms.created": {
    fr: "Mairie de Ndiédieng : nous avons enregistré le signalement {code} ({what}) pour votre village.",
    wo: "Meeri Ndiédieng: bind nañu yégle {code} ({what}) ngir sa dëkk.",
  },
  "sms.inProgress": {
    fr: "Mairie de Ndiédieng : votre signalement {code} ({what}) est pris en charge.",
    wo: "Meeri Ndiédieng: sa yégle {code} ({what}), ñu ngi ci liggéey.",
  },
  "sms.resolved": {
    fr: "Mairie de Ndiédieng : votre signalement {code} ({what}) est résolu. Merci de l'avoir signalé.",
    wo: "Meeri Ndiédieng: sa yégle {code} ({what}), defar nañu ko. Jërëjëf ci yégle bi.",
  },
} as const satisfies Record<string, Pair>;

export type TextKey = keyof typeof TEXT;

/** A category, as a chief reads it in a reply. */
export const CATEGORY: Record<Categorie, Pair> = {
  eau: { fr: "eau", wo: "ndox" },
  sante: { fr: "santé", wo: "wér-gi-yaram" },
  ecole: { fr: "école", wo: "lekool" },
  energie: { fr: "énergie", wo: "mbëj" },
  piste: { fr: "piste", wo: "yoon" },
  naissance: { fr: "naissance", wo: "juddu" },
  deces: { fr: "décès", wo: "ku faatu" },
  autre: { fr: "autre", wo: "leneen" },
};

/** An urgency, as it follows "urgence" in French; whole in Wolof. */
export const URGENCY: Record<Urgence, Pair> = {
  haute: { fr: "haute", wo: "yàkkamti na" },
  moyenne: { fr: "moyenne", wo: "dafa sonal" },
  basse: { fr: "basse", wo: "mën na xaar" },
};

/** A report's status, as a chief following it reads it. */
export const STATUS: Record<Statut, Pair> = {
  nouveau: { fr: "reçu", wo: "agsi na" },
  a_verifier: { fr: "en vérification", wo: "ñu ngi koy seet" },
  en_cours: { fr: "en cours de traitement", wo: "ñu ngi ci liggéey" },
  resolu: { fr: "résolu", wo: "defar nañu ko" },
};

/**
 * The kinds of equipment (the `nature` the menus and the classifier give),
 * named for a chief. Their French names are also how equipment is stored, so
 * they stay as they are; an unknown one is shown as it came.
 */
export const EQUIPMENT: Record<string, Pair> = {
  forage: { fr: "forage", wo: "forage" },
  "borne-fontaine": { fr: "borne-fontaine", wo: "robine" },
  "poste de sante": { fr: "poste de santé", wo: "poste de santé" },
  "case de sante": { fr: "case de santé", wo: "case de santé" },
  "salle de classe": { fr: "salle de classe", wo: "néegu jàng" },
  latrines: { fr: "latrines", wo: "wanag" },
  "lampadaire solaire": { fr: "lampadaire solaire", wo: "lampu mbedd" },
  piste: { fr: "piste", wo: "yoon" },
};

/**
 * Kalangu's own fixed strings in Wolof (More, Back, invalid choice…), the
 * same as the common.* entries of locales/wo.draft.json: redrafted by hand,
 * not reviewed by a second speaker yet.
 * Corrections belong in both places.
 */
export const KALANGU_WO = {
  "common.more": "Li ci des",
  "common.back": "Dellu",
  "common.yes": "Waaw",
  "common.no": "Déedéet",
  "common.deferredNotice": "Ñu ngi seet sa laaj. Dinga jot SMS léegi.",
  "common.invalidChoice": "Tann bi baaxul. Jéemaatal.",
  "common.invalidNumber": "Bindal ab lim.",
  "common.typeAnswer": "Bindal sa tontu.",
  "common.replyYesNo": "Tontuwal {yes} walla {no}",
  "common.error": "Baal nu, am na jafe-jafe. Jéemaatal ci kanam.",
  "common.expiredChoice": "Tann boobu jeex na.",
  "common.language": "Làkk",
  "common.suggestLanguage": "Ndax nu wéy ci {language}?",
} as const satisfies Partial<Messages>;

/** `TEXT[key]` in `lang`, with each `{name}` replaced from `vars`. */
export function say(lang: Lang, key: TextKey, vars: Record<string, string> = {}): string {
  return fill(TEXT[key][lang], vars);
}

export function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => vars[name] ?? whole);
}

/** An equipment kind for a chief, or the kind itself when it has no entry. */
export const equipmentName = (nature: string, lang: Lang) => EQUIPMENT[nature]?.[lang] ?? nature;

/** The review sheet: one row per string, French | Wolof draft | correction. */
export function reviewSheet(): string {
  const rows: string[][] = [["key", "french", "wolof_draft", "correction", "notes"]];
  const add = (prefix: string, table: Record<string, Pair>) => {
    for (const [key, pair] of Object.entries(table)) rows.push([`${prefix}${key}`, pair.fr, pair.wo, "", ""]);
  };
  add("", TEXT);
  add("category.", CATEGORY);
  add("urgency.", URGENCY);
  add("status.", STATUS);
  add("equipment.", EQUIPMENT);
  // Kalangu's French ships with the toolkit; only the Wolof is drafted here.
  for (const [key, wo] of Object.entries(KALANGU_WO)) {
    rows.push([`kalangu.${key}`, KALANGU_FR[key as MessageKey], wo, "", "Kalangu's own string: also fix locales/wo.draft.json"]);
  }
  return rows.map((r) => r.map(csvCell).join(",")).join("\n") + "\n";
}

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
