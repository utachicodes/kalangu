# Kalangu — 0.3 languages design

Status: **draft for review. No language code exists, and none should be
written until this document is reviewed.**
Date: 2026-11-16. Scope: version 0.3 only: language detection, per-language
model routing, and community-contributed translations. Payments (0.2),
WhatsApp (0.4) and voice are out of scope.

---

## 1. What 0.3 is

An agent that detects the user's language and routes each turn to a model
that speaks it, with translations contributed by the community:

> A user dials the clinic line and types their question in Wolof. The agent
> detects Wolof, sends the question to the Wolof-speaking model, and replies
> in Wolof. The same agent answers in English, French, Hausa or Swahili
> without being rebuilt — each language is just another locale file and, if
> the developer wants it, another model.

Three properties matter more than features:

1. **Never guess silently.** Detection returns a language *and* a confidence.
   Below a threshold, the agent asks (once) instead of answering in the wrong
   language.
2. **One model per language is optional.** A single multilingual model is the
   default; per-language routing is an opt-in for developers who need it.
3. **Community translations are first-class.** Anyone can add a locale file
   (Wolof, Hausa, Swahili first) without touching code, and the toolkit
   validates and ships it.

---

## 2. Language detection

### 2.1 What detection returns

```ts
interface DetectedLanguage {
  code: string;        // BCP 47, e.g. "wo", "ha", "sw", "en", "fr"
  confidence: number;  // 0 to 1
}
```

The detector is a pluggable port, like `ModelPort`:

```ts
interface LanguageDetector {
  detect(text: string): Promise<DetectedLanguage>;
}
```

`createAgent` accepts `language?: { detector: LanguageDetector; threshold: number }`.
Default threshold: 0.7. Below it, the agent replies with a short localized
prompt asking the user to pick a language from a numbered menu (the existing
`choose` step), and the choice persists in the session.

### 2.2 Candidate: CommonLingua

The TODO evaluates **CommonLingua** (61 languages, ~2 million parameters) for
detection. It is small enough to bundle with the agent, runs in the same
process, and covers the target languages (Wolof, Hausa, Swahili, English,
French among them). Before 0.3 ships, someone needs to:

- Check its license permits bundling and shipping.
- Measure its accuracy on real user inputs (short, keypad-typed, often
  code-mixed: "clinic open Sunday?" in English/Wolof/French mix).
- Measure its latency against the 10 s USSD response bound (detection runs on
  the fast path, before the model, so it must be fast — well under a second).

If CommonLingua doesn't pass, the fallback is a small heuristic detector
(common greetings and keywords per language) or an API call to a detection
service — both are pluggable through the same `LanguageDetector` port.

### 2.3 When detection runs

- On the **first input** of a session or conversation (empty or no stored
  locale), before the model is called.
- The result is stored in the session record (`locale`) and reused for the
  lifetime of the conversation, so detection runs once per user, not once per
  turn.
- A user can change language at any time through the existing "Language"
  menu option, which overrides the detected value.

---

## 3. Per-language model routing

### 3.1 Default: one model

The developer's `model` (a `ModelPort`) handles every language. This is the
simplest option and works when the model is multilingual. Nothing in core
changes — the `locale` is already on `TurnContext` and handlers can read it.

### 3.2 Opt-in: a model per language

For developers who want a dedicated model per language:

```ts
createAgent({
  model: {
    en: englishModel,
    fr: frenchModel,
    wo: wolofModel,
    ha: hausaModel,
    sw: swahiliModel,
  },
  language: {
    detector: commonLingua(),
    threshold: 0.7,
  },
});
```

The model port becomes a map `{ [locale]: ModelPort }`. The engine looks up
`ctx.locale` and calls the matching model, falling back to a default model
(or the single model) when no match exists. If a model for the detected
language is missing, the agent logs a warning and uses the default rather
than failing the turn.

### 3.3 What the model receives

The model gets the user's input *in the language they typed*, plus `ctx.locale`
and `ctx.t` so it can reply in the same language. The developer's handler is
responsible for language consistency — core provides the locale, not a
translation of the model's output.

---

## 4. Community translations

### 4.1 Locale files

Fixed strings live in TypeScript modules (v0.1 §14, item 9), one per locale:

```ts
// src/locales/wo.ts
export const messages: Messages = {
  "common.more": "Suudu",
  "common.yes": "Hikka",
  "common.no": "Déedé",
  // …
};
```

Each locale file exports `messages: Messages` where `Messages` is
`Readonly<Record<MessageKey, string>>` and `MessageKey` is the closed union
of keys the toolkit itself renders (`common.more`, `common.yes`, `common.no`,
`common.deferredNotice`, `common.invalidChoice`, `common.invalidNumber`,
`common.typeAnswer`, `common.replyYesNo`, `common.error`).

Agent content (menu titles, questions, answers) is separate: it uses the
`Text` type (`string | { en: "...", fr: "..." }`) and developers add
translations inline, not in locale files.

### 4.2 Adding a new locale

1. Copy `src/locales/en.ts` to `src/locales/<code>.ts` (e.g. `wo.ts`).
2. Translate every key; do not add or remove keys.
3. Register it in `src/locales/index.ts` (or wherever `BUILTIN_MESSAGES` is
   assembled).
4. Add a test that loads the file and checks every key is a non-empty string.

### 4.3 Review and validation

- A maintainer reviews the translation for the target market (a Wolof speaker
  for Wolof, etc.), not just machine accuracy.
- The CI test that every locale has all keys prevents a partial file from
  shipping.
- Missing keys fall back to the default locale, then English — so a new
  locale can never break rendering.

### 4.4 First languages

Wolof, Hausa, Swahili — in that order — match the TODO. English and French
already ship (v0.1).

---

## 5. How detection, routing and translations fit together

```
first user input
  → detector (once) → locale + confidence
  → confidence below threshold? → ask language (choose menu), store choice
  → look up model for locale (per-language routing) or use default model
  → run handler with ctx.locale set
  → render turn for the channel, localised fixed strings from the locale file
```

The `choose` step already renders numbered menus per channel (USSD `CON`,
SMS numbered list), so the language-pick prompt reuses it with no new
renderer.

---

## 6. Packages

```
packages/core    LanguageDetector interface, detection result type,
                 createAgent `language` config, per-language model port,
                 locale files (en, fr, wo, ha, sw), locale-loading tests
```

Core keeps zero runtime dependencies. A detector implementation (CommonLingua
bundle or a heuristic) is optional and can live in the agent or a community
package; core only defines the port.

---

## 7. Out of scope for 0.3

Auto-detecting language from audio (voice), right-to-left script support,
text translation of agent content (the developer writes each language's
content), more than the first three community languages, and any detection
service that needs an API key.

---

## 8. Verify first (needs real or representative inputs)

1. **CommonLingua license** permits bundling and shipping.
2. **Accuracy** on short, keypad-typed, code-mixed inputs from the target
   markets (Wolof, Hausa, Swahili, English, French).
3. **Latency** on the detection fast path — well under the 10 s USSD bound,
   ideally under a second, since detection runs before the model.
4. Whether a **single multilingual model** is good enough for most
   developers, making per-language routing rarely needed.

---

## 9. Testing plan (priority order)

1. **Detector port**: a fake detector returns known languages; the agent uses
   the returned locale and stores it in the session.
2. **Threshold behaviour**: below-threshold detection shows the language-pick
   menu; above-threshold skips it.
3. **Per-language routing**: the engine calls the model matching `ctx.locale`,
   falls back to the default model when missing, and logs a warning.
4. **Locale files**: every shipped locale has all `MessageKey`s with non-empty
   strings; missing keys fall back to default locale, then English.
5. **Persistence**: the detected or chosen locale survives across turns in a
   session and on redial within the resume window.

---

## 10. Open questions

1. **Detection on the first input only, or re-evaluate when input language
   clearly changes?** Re-evaluating risks churn; once per conversation is
   simpler and the user can switch manually. Proposed: once per session.
2. **Default threshold (0.7)** — too high (asks too often) or too low (answers
   in the wrong language)? Needs real inputs to tune.
3. **Where the detector bundle lives** — core (zero dependencies) vs a
   separate `@kalangu/language-commonlingua` package. Proposed: separate,
   optional package.
4. **Per-language model map vs a single model that receives `locale`** — is
   the map worth the complexity? Proposed: opt-in map, single model default.
5. **Should community locale files live in this repo or a community repo?**
   Proposed: in this repo, with a CONTRIBUTING section for locales.
