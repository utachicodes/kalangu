/**
 * Everything the prototype asks Gemini, in one place and with no other
 * dependency, so the same prompts serve the Node server (with the key in its
 * environment) and the website (through a small serverless function that
 * holds the key; the browser never sees it).
 *
 * A caller names a task and gives its inputs; the prompts, the answer's JSON
 * shape and the size limits are fixed here. The serverless function accepts
 * nothing else, so it cannot be used as an open Gemini proxy.
 */

import { SCHEMA } from "./schema.js";

export const CATEGORIES = ["eau", "sante", "ecole", "energie", "piste", "naissance", "deces", "autre"] as const;
export const NATURE_LIST = ["forage", "borne-fontaine", "poste de sante", "case de sante", "salle de classe", "latrines", "lampadaire solaire", "piste"];

/** The languages the assistant answers in: French, and Wolof when asked in Wolof. */
export type Langue = "fr" | "wo";
export const LANGUES: readonly Langue[] = ["fr", "wo"];
const langueOf = (v: unknown): Langue | null | undefined => (v === undefined ? undefined : LANGUES.includes(v as Langue) ? (v as Langue) : null);

/** How to write in each language, for the prompts. */
const WRITE_IN: Record<Langue, string> = {
  fr: "en français correct, avec tous les accents",
  wo: "en wolof du Sénégal, écrit en alphabet latin (orthographe officielle : ë, ñ, ŋ, à, é, ó), avec des phrases simples ; garde les chiffres en chiffres, les codes (S-0042) et les noms de villages tels quels",
};

export type GeminiTask =
  /** A question from the Mairie, to a read-only query (or a direct reply when no data is needed). */
  | { task: "plan"; question: string }
  /** The question, the query and its rows, to one or two sentences. */
  | { task: "answer"; question: string; sql: string; rows: unknown[]; langue?: Langue }
  /** A free SMS or voice message from a chief, to a category and an urgency. */
  | { task: "classify"; text: string }
  /** An answer, read aloud by Gemini's speech model: `{ mimeType, data }` (base64 audio). */
  | { task: "speak"; text: string; langue?: Langue }
  /** A recorded question (base64 WAV), to `{ texte }`: French or Wolof, word for word. */
  | { task: "transcribe"; audio: string; mimeType: string };

/** Runs a task, wherever the key is. Resolves to the model's JSON answer. */
export type GeminiCall = (task: GeminiTask) => Promise<unknown>;

const LIMITS = { question: 500, sql: 2000, text: 500, rowsJson: 20_000, speech: 700, audioBase64: 1_400_000 };
const AUDIO_TYPES = ["audio/wav", "audio/x-wav"];

interface Prompt {
  system: string;
  user: string;
  schema: object;
  timeoutMs: number;
  /** "audio": the speech model, which answers with sound instead of JSON. */
  kind?: "json" | "audio";
  /** Sound sent with the prompt, for transcription. */
  attachment?: { mimeType: string; data: string };
}

/** The prompt for a task, or an error message when the input is not acceptable. */
export function promptFor(input: unknown): Prompt | string {
  const t = input as Partial<Record<string, unknown>> | null;
  const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() && v.length <= max ? v.trim() : null);
  if (!t || typeof t !== "object") return "a task is required";
  if (t["task"] === "plan") {
    const question = str(t["question"], LIMITS.question);
    if (!question) return "question is missing or too long";
    return {
      system:
        "Tu es l'assistant de la Mairie de Ndiédieng (Sénégal). La question peut être en français ou en wolof : " +
        "indique sa langue dans langue (fr ou wo) et, si tu écris une réponse, écris-la dans cette même langue.\n" +
        "Si la question porte sur les donnees de la commune, ecris UNE requete SQLite SELECT, en lecture seule, qui y repond, " +
        "avec uniquement ces tables (les valeurs texte sont en minuscules, sans accents) :\n" +
        SCHEMA +
        "\nValeurs exactes (respecte-les, espaces compris) : equipements.etat = 'fonctionnel' ou 'en panne' ; " +
        "equipements.type = 'eau', 'sante', 'ecole', 'energie', 'piste' ; equipements.nature = " + NATURE_LIST.map((n) => `'${n}'`).join(", ") + " ; " +
        "signalements.categorie = " + CATEGORIES.map((c) => `'${c}'`).join(", ") + " ; signalements.statut = 'nouveau', 'a_verifier', 'en_cours', 'resolu' ; " +
        "signalements.urgence = 'haute', 'moyenne', 'basse' ; signalements.canal = 'ussd', 'sms', 'vocal', 'mairie' ; fiches.etat = 'a jour' ou 'a mettre a jour'.\n" +
        "Une panne en cours = un équipement dont etat = 'en panne', ou un signalement de catégorie eau, sante, ecole, energie ou piste dont statut != 'resolu'. " +
        "Date du jour : date('now'). Limite a 200 lignes. Donne aux colonnes des noms clairs en francais. Mets alors reponse = \"\".\n" +
        "Si c'est une salutation, un remerciement ou une question sur toi, laisse sql = \"\" et ecris une reponse courte et chaleureuse " +
        "qui propose un exemple de question (pannes, signalements urgents, naissances, population).\n" +
        "Si les donnees ne permettent pas de repondre, laisse sql = \"\" et explique-le en une phrase dans reponse.",
      user: question,
      schema: {
        type: "object",
        properties: { langue: { type: "string", enum: [...LANGUES] }, sql: { type: "string" }, reponse: { type: "string" } },
        required: ["langue", "sql", "reponse"],
      },
      timeoutMs: 15_000,
    };
  }
  if (t["task"] === "answer") {
    const question = str(t["question"], LIMITS.question);
    const sql = str(t["sql"], LIMITS.sql);
    const rows = Array.isArray(t["rows"]) ? JSON.stringify(t["rows"].slice(0, 50)) : null;
    const langue = langueOf(t["langue"]);
    if (!question || !sql || !rows || rows.length > LIMITS.rowsJson) return "question, sql and rows are required, within limits";
    if (langue === null) return "langue must be fr or wo";
    return {
      system:
        `Tu réponds à la Mairie de Ndiédieng ${WRITE_IN[langue ?? "fr"]}, en une ou deux phrases claires, uniquement à partir des résultats fournis. ` +
        "Réponds directement, sans formule d'adresse (pas de « Monsieur le Maire »). " +
        "N'invente aucun chiffre. Cite les villages ou codes utiles. Si les resultats sont vides, dis-le simplement.",
      user: `Question : ${question}\nRequete : ${sql}\nResultats (JSON, au plus 50 lignes) : ${rows}`,
      schema: { type: "object", properties: { reponse: { type: "string" } }, required: ["reponse"] },
      timeoutMs: 15_000,
    };
  }
  if (t["task"] === "classify") {
    const text = str(t["text"], LIMITS.text);
    if (!text) return "text is missing or too long";
    return {
      system:
        "Tu classes les messages SMS envoyes par les chefs de village de la commune de Ndiedieng (Senegal) a la Mairie. " +
        "Le message peut etre en francais ou en wolof, avec des fautes. Categories : eau (forage, borne-fontaine), sante (poste ou case de sante), " +
        "ecole (salle de classe, latrines), energie (lampadaire solaire), piste (piste coupee, pont), naissance, deces, autre. " +
        "Urgence haute si un service essentiel est coupe pour beaucoup de gens ou s'il y a un danger. " +
        "confiance : ta certitude entre 0 et 1 ; sois honnete quand le message est ambigu.",
      user: text,
      schema: {
        type: "object",
        properties: {
          categorie: { type: "string", enum: [...CATEGORIES] },
          nature: { type: "string", enum: [...NATURE_LIST, "aucune"] },
          urgence: { type: "string", enum: ["haute", "moyenne", "basse"] },
          confiance: { type: "number" },
        },
        required: ["categorie", "nature", "urgence", "confiance"],
      },
      timeoutMs: 8000,
    };
  }
  if (t["task"] === "transcribe") {
    const audio = t["audio"];
    const mimeType = t["mimeType"];
    if (typeof audio !== "string" || !audio || audio.length > LIMITS.audioBase64 || !/^[A-Za-z0-9+/=]+$/.test(audio)) return "audio is missing or too long";
    if (typeof mimeType !== "string" || !AUDIO_TYPES.includes(mimeType)) return "audio must be WAV";
    return {
      system:
        "Tu transcris une question posée à voix haute à l'assistant de la Mairie de Ndiédieng (Sénégal). " +
        "Elle peut être en français ou en wolof. Écris exactement ce qui est dit, dans la langue parlée (le wolof en alphabet latin, orthographe officielle), avec la ponctuation, sans rien ajouter ni répondre, et indique la langue (fr ou wo). " +
        "Si on n'entend rien d'intelligible, renvoie texte = \"\".",
      user: "Transcris cet enregistrement.",
      schema: { type: "object", properties: { texte: { type: "string" }, langue: { type: "string", enum: [...LANGUES] } }, required: ["texte", "langue"] },
      timeoutMs: 20_000,
      attachment: { mimeType: "audio/wav", data: audio },
    };
  }
  if (t["task"] === "speak") {
    const text = str(t["text"], LIMITS.speech);
    const langue = langueOf(t["langue"]);
    if (!text) return "text is missing or too long";
    if (langue === null) return "langue must be fr or wo";
    return {
      kind: "audio",
      system: "",
      // Only the words to say. A spoken style instruction ("read this warmly:")
      // was read aloud along with the answer, so the speech model gets the
      // text alone and takes the language from it.
      user: text,
      schema: {},
      timeoutMs: 20_000,
    };
  }
  return "unknown task";
}

export const DEFAULT_MODEL = "gemini-3.5-flash-lite";
export const DEFAULT_SPEECH_MODEL = "gemini-3.8-flash-lite-tts";
/** One of Gemini's prebuilt voices: firm and clear. */
export const DEFAULT_VOICE = "Kore";

interface GenerateOptions {
  apiKey: string;
  model: string;
  speechModel?: string;
  voice?: string;
  fetch?: typeof fetch;
}

/** One call to Gemini with a prompt: the JSON it answers, or for speech `{ mimeType, data }`. */
export async function generate(options: GenerateOptions, prompt: Prompt): Promise<unknown> {
  const doFetch = options.fetch ?? fetch;
  const audio = prompt.kind === "audio";
  const model = audio ? (options.speechModel ?? DEFAULT_SPEECH_MODEL) : options.model;
  const res = await doFetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": options.apiKey },
    body: JSON.stringify(
      audio
        ? {
            contents: [{ role: "user", parts: [{ text: prompt.user }] }],
            generationConfig: {
              responseModalities: ["AUDIO"],
              speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: options.voice ?? DEFAULT_VOICE } } },
            },
          }
        : {
            systemInstruction: { parts: [{ text: prompt.system }] },
            contents: [{ role: "user", parts: [...(prompt.attachment ? [{ inlineData: prompt.attachment }] : []), { text: prompt.user }] }],
            generationConfig: { responseMimeType: "application/json", responseJsonSchema: prompt.schema },
          },
    ),
    signal: AbortSignal.timeout(prompt.timeoutMs),
  });
  if (!res.ok) throw new Error(`Gemini answered ${res.status}`);
  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean; inlineData?: { mimeType?: string; data?: string } }> } }>;
  };
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  if (audio) {
    const sound = parts.find((p) => p.inlineData?.data)?.inlineData;
    if (!sound?.data) throw new Error("Gemini returned no audio");
    return { mimeType: sound.mimeType ?? "audio/wav", data: sound.data };
  }
  return JSON.parse(parts.filter((p) => !p.thought).map((p) => p.text ?? "").join(""));
}

/** Gemini called from here, with the key: the Node server. */
export function directGemini(options: { apiKey: string; model?: string; speechModel?: string; fetch?: typeof fetch }): GeminiCall {
  const config: GenerateOptions = {
    apiKey: options.apiKey,
    model: options.model ?? DEFAULT_MODEL,
    ...(options.speechModel ? { speechModel: options.speechModel } : {}),
    ...(options.fetch ? { fetch: options.fetch } : {}),
  };
  return async (task) => {
    const prompt = promptFor(task);
    if (typeof prompt === "string") throw new Error(prompt);
    return generate(config, prompt);
  };
}

/** Gemini through the website's serverless function, which holds the key. */
export function remoteGemini(url: string, doFetch: typeof fetch = fetch): GeminiCall {
  return async (task) => {
    const res = await doFetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(task),
      signal: AbortSignal.timeout(20_000),
    });
    const body = (await res.json().catch(() => ({}))) as { result?: unknown; error?: string };
    if (!res.ok || body.result === undefined) throw new Error(body.error ?? `the assistant service answered ${res.status}`);
    return body.result;
  };
}
