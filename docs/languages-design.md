# Kalangu — 0.3 languages design

Status: **draft for review. No language code exists, and none should be
written until this document is reviewed.**
Date: 2026-11-17 (first draft 2026-11-16, revised after reading CommonLingua's
model card and checking the draft against the code). Scope: version 0.3 only:
choosing the user's language, optional detection as a hint, per-language
model routing, and community translations. Payments (0.2), WhatsApp (0.4) and
voice are out of scope.

---

## 1. What 0.3 is

An agent that speaks the user's language, with translations contributed by
the community:

> A user dials the clinic line from a Senegalese number and sees a language
> menu in the languages they are likely to read. They pick Wolof once. From
> then on, on USSD, SMS and later WhatsApp, the fixed text is Wolof and, if
> the developer wants it, a Wolof-capable model answers. The same agent
> serves English, French, Hausa or Swahili without being rebuilt: each
> language is a locale and, optionally, a model.

Four properties matter more than features:

1. **Never guess silently.** A wrong-language reply is worse than one extra
   question. Detection is a hint, never the only evidence.
2. **Ask once, remember.** On a keypad the cheapest reliable signal is the
   user's own choice, stored per phone number.
3. **One model per language is optional.** A single multilingual model is
   the default; routing per language is opt-in.
4. **Community translations are first-class,** and the toolkit checks them,
   because a translation that breaks a USSD screen or an SMS budget is a bug
   (§8).

---

## 2. Facts (read 17 Nov 2026)

### 2.1 CommonLingua

Sources: the GSMA press release of 28 April 2026 ("Pleias and GSMA launch
CommonLingua…") and the model card at `huggingface.co/PleIAs/CommonLingua`.
The accuracy figures are the developers' own; I found no independent
evaluation.

- A language identification model from Pleias and the GSMA: **334 languages
  in all, 61 of them African**, trained only on open-licensed and
  public-domain text from the Common Corpus project.
- **Size:** the card gives 2.35 million parameters; the press release says
  "2 million" and an 8 MB checkpoint. It reads UTF-8 bytes rather than using
  a language-specific tokenizer.
- **License:** the model card lists **apache-2.0** (the press release names
  none). The card does not include the license text.
- **Accuracy:** on the CommonLID benchmark (376k held-out **paragraphs**):
  77.63% strict accuracy, 82.92% "equivalence-class" accuracy, macro F1
  0.7879. The press release rounds this to "83% accuracy, F1 0.79".
  **Per-language accuracy is not stated.**
- **Speed:** about 20 texts per second on a CPU and up to 3,000 per second
  on one GPU (press release).
- **How it runs:** PyTorch, through a `predict.py` script that prints a code
  and a score (for example `fra 0.99`). The card does not say whether the
  score is a calibrated probability. **No ONNX or JavaScript build is
  mentioned.**
- **Its own warnings:** it was "not assessed on very short text segments and
  will likely perform less well than alternatives", and it is "intended for
  paragraph-level corpus curation". Nothing is said about code-mixed text.
- **Coverage of our languages:** French is shown working. **Wolof, Hausa and
  Swahili are not named on either page** (the press release mentions Swahili,
  Yoruba and Wolof only as examples of languages that need identifying). They
  are probably among the 61, but no source I read says so.

### 2.2 Other detectors

No source I found benchmarks any detector on **short keypad-typed text in
Wolof, Hausa and Swahili**. What exists:

- GlotLID's README warns that it was trained mainly on longer sentences and
  should not be used on very short ones.
- A third-party model card (self-reported, not a neutral benchmark) shows low
  accuracy for general-purpose detectors on 1–5 word inputs across 608
  languages: 21.8% and 48.6% for two of the models it compares. It does not
  separate out Wolof, Hausa or Swahili in what I read.
- Press coverage of CommonLingua says other detectors often label Swahili or
  Hausa as English or French. That is an announcement claim.

### 2.3 What I measured in this repo

Using the core's own `gsmClass` and `toUssdSafe`:

| Letter | Language | SMS | USSD output |
|---|---|---|---|
| `ë`, `ŋ`, `ó` | Wolof | outside GSM-7 | `e`, `ng`, `o` |
| `ñ`, `à`, `é` | Wolof | GSM-7 | `n`, `a`, `e` |
| `ɓ`, `ɗ`, `ƙ` | Hausa | outside GSM-7 | `b`, `d`, `k` |
| `ç`, `ê`, `ô` | French | outside GSM-7 | `c`, `e`, `o` |
| plain a–z | Swahili | GSM-7 | unchanged |

One character outside GSM-7 makes the whole SMS UCS-2: **70 characters per
segment instead of 160** (67 instead of 153 when joined), so the 4-segment
cap is 268 characters instead of 612. Wolof and Hausa text will usually be
UCS-2; Swahili will not. On USSD, everything is reduced to ASCII, so
**Hausa's `ɓ`/`b`, `ɗ`/`d` and `ƙ`/`k`, which are different sounds, become
the same letter.** That is a limit of the gateway's "no special characters"
rule (`design.md` §2), not something Kalangu can fix; it needs saying to
anyone translating for USSD.

---

## 3. What this changes in the first draft

The first draft was written before these facts. It said, and this revision
corrects:

1. **"CommonLingua is small enough to bundle and runs in the same
   process."** Not for a TypeScript package. It is PyTorch with a Python
   script, and the core has zero runtime dependencies. A detector has to run
   as a separate service, or someone has to port and validate an ONNX build
   (§6).
2. **Detection on the first input, with a 0.7 default threshold.** The first
   input on a keypad is a menu number or a few words, which is exactly the
   case CommonLingua says it was not assessed on. A numeric default would
   have been a guess dressed as a setting. Detection becomes a hint (§5) and
   there is no default threshold until one is measured.
3. **"Covers the target languages."** Unconfirmed for Wolof, Hausa and
   Swahili (§2.1).
4. **Community locale files in `src/locales/<code>.ts`.** That directory does
   not exist. Locales are objects in `packages/core/src/locales.ts`, and
   developers can already add one without touching the toolkit (§9).
5. **Nine message keys.** There are 30 now (payments, expired choice), and a
   few take `{placeholders}` that a translation must keep.
6. **Invented Wolof strings.** The first draft showed sample Wolof
   translations; I could not verify them and removed them. A Wolof speaker
   must supply real ones.

---

## 4. Choosing the language

**Ask first, remember, and let the number help.**

- **A language menu on first contact,** unless the session already has a
  locale. It is a normal `choose` step, so it renders on USSD, SMS and later
  WhatsApp with no new renderer. Each language is named **in that language**
  ("Français", "Wolof", "Kiswahili", "Hausa", "English"), because a user who
  cannot read the menu cannot choose from it.
- **The country prefix orders the menu and sets a default.** E.164 numbers
  carry a reliable country code. A developer maps country to a short list of
  likely locales (`+221` to French, Wolof, English; `+234` to English, Hausa,
  and so on), and the menu lists those first. This is a prior, not a
  detection, and costs nothing at runtime.
- **The choice persists.** Sessions are keyed by phone number and keep
  `locale` already, so one choice covers every channel and later dials.
- **Switching at any time** is the existing pattern (the clinic example's
  Language menu sets `ctx.locale`). The core exposes a ready-made
  `languageMenu()` step so developers do not rebuild it.
- **USSD cost:** one extra screen, once per phone number. That is the price
  of never answering in the wrong language, and it is paid once.

---

## 5. Detection, as a hint

Detection is optional and never the only way a language gets set.

```ts
interface LanguageDetector {
  detect(
    text: string,
    options: { candidates: readonly string[] },
  ): Promise<{ code: string; confidence: number } | null>;
}
```

- **`candidates` is the set of languages the agent supports,** and the
  detector must answer from it or return `null`. Choosing among five is far
  easier than among 334, and it prevents the worst failure: confidently
  naming a language the agent cannot speak.
- **A minimum length.** Below `minChars` (a developer setting, no default
  until measured) the engine does not call the detector. One or two words
  tell it nothing.
- **When it runs:** on **free text the user typed**: `ask` answers, and the
  messages on SMS and WhatsApp, which are longer than keypad input. Never on
  a menu number.
- **What it does with a result:** it never switches the language silently.
  It suggests: after a confident, long-enough result that differs from the
  stored locale, the agent offers the language menu once ("Reply in
  Kiswahili? 1. Yes 2. No"), and remembers a "No" for the session.
- **No default threshold.** `confidence` means different things in different
  detectors, and CommonLingua's score is not documented as calibrated. The
  threshold is required configuration, and the project ships a way to
  measure one (§12) rather than a number to trust.
- **Per turn or once?** Once per session is the proposal (§14, question 1):
  a user can switch by hand, and re-detecting every turn invites flip-flops
  on code-mixed text.

---

## 6. Running a detector from TypeScript

The port is the stable part; where the model runs is a deployment choice.

| Option | What it takes | Verdict |
|---|---|---|
| **No detector** | Nothing. The menu and country prior (§4) do the work | Ships first. Correct, and costs no model |
| **Sidecar service** | A small HTTP service running CommonLingua's Python, called through the port | Works today, adds an operational part and a network hop on the reply path |
| **ONNX in Node** | Someone exports CommonLingua to ONNX, proves it gives the same answers, and ships an optional `@kalangu/language-commonlingua` package with an ONNX runtime dependency | Best for developers, but real work, and only worth doing if it passes §12 |
| **Heuristic** | Per-language greeting and keyword lists | Cheap and explainable, weak outside its word lists. Useful as a candidate-narrowing hint, not alone |

Core defines only the port and keeps zero runtime dependencies. No detector
ships with core.

---

## 7. Per-language model routing

### 7.1 Default: one model

The developer's `model` handles every language. Nothing in core changes:
`ctx.locale` is already on the handler's context, as in the clinic example.

### 7.2 Opt-in: a model per language

```ts
createAgent({
  model: { fr: frenchModel, wo: wolofModel, default: multilingualModel },
  // ...
});
```

The model handle becomes a map keyed by locale, with a `default`. The engine
resolves `ctx.model` to the entry for `ctx.locale`, falling back to
`default` and logging a warning when none matches. A missing entry never
fails the turn. Keys must be languages the agent has locales for, checked at
startup.

### 7.3 What the model receives

The user's input as typed, plus `ctx.locale` and `ctx.t`. Core supplies the
locale; it does not translate the model's output. Language consistency in
the answer is the handler's job.

---

## 8. Text that must fit the channel

A translation is not only words. The same string has to fit a USSD screen and
an SMS budget (§2.3), and a few strings carry placeholders that must survive.

A **`kalangu locale check`** command (the "language test command" on the
roadmap), run in CI and by contributors, reports for any locale:

- **Missing keys,** and keys that exist in no other locale (typos).
- **Placeholders:** every `{name}` in the English string must appear in the
  translation, and no others (`{amount}`, `{yes}`, `{currency}`).
- **USSD:** each string's length against the screen limit, with characters
  that will be transliterated or removed listed (so a Hausa translator sees
  that `ɗ` becomes `d`).
- **SMS:** the encoding and segment count of each string, flagging any that
  push past one segment or fall into UCS-2 only because of one character.
- **Empty or unchanged strings** (a copied English value).

Fixed strings are short, so the budget rarely bites; the checker's real job
is catching the placeholder that was translated away and the screen that no
longer fits.

---

## 9. Community translations

### 9.1 How it works today

A developer can already add a language with no change to the toolkit:

```ts
createAgent({
  defaultLocale: "wo",
  messages: { wo: { "common.yes": "…", "common.no": "…" /* … */ } },
  // ...
});
```

`messages` accepts partial locales; a missing key falls back to the default
locale, then English. So a half-finished translation cannot break rendering.
The built-in locales are objects in `packages/core/src/locales.ts`.

### 9.2 What 0.3 adds

- **A home for contributed locales** that can be reviewed and versioned
  without touching `locales.ts`: a `locales/<code>.ts` file per language
  (§14, question 3), exporting `Partial<Messages>` and a header with who
  wrote it and who reviewed it.
- **The checker (§8) in CI,** so a locale cannot merge with a broken
  placeholder.
- **A contributor guide** in `CONTRIBUTING.md`: copy the English file,
  translate, run the checker, open a pull request.
- **Native-speaker review.** A maintainer cannot judge a Wolof translation
  by reading it. A locale is marked **reviewed** only when a speaker of that
  language, other than the author, signed off, and the file says who. An
  unreviewed locale ships as **experimental** and the README says so.
- **First languages: Wolof, Hausa, Swahili,** in that order, then whatever
  contributors bring. English and French already ship.

### 9.3 What a translator needs to know

- Keep every `{placeholder}` exactly.
- On USSD the text reaches the user as ASCII (§2.3). Hausa hooked letters and
  Wolof `ë`, `ŋ` and `ó` are flattened. Where that makes a word ambiguous,
  prefer a wording that survives it.
- Keep strings short. A USSD screen is 160 characters including the menu.
- Fixed strings only. Agent content (menu titles, answers) is the
  developer's own and lives in `{ en: "…", wo: "…" }` text.

---

## 10. How the pieces fit

```
contact from +221…
  → stored locale? yes → use it
  → no → language menu ordered by country, store the choice
  → run the handler with ctx.locale set
  → model for ctx.locale (or the default model)
  → render the turn, fixed text from the locale, for the channel

free text typed later (optional)
  → long enough? yes → detector(text, candidates)
  → confident and different? → offer the language menu once
```

---

## 11. Packages and engine changes

```
packages/core       languageMenu() step, country-to-locales prior,
                    LanguageDetector port, model map resolution,
                    `kalangu locale check`, locales/ directory
optional package    @kalangu/language-commonlingua (only if §12 passes)
```

Core keeps zero runtime dependencies. Engine changes: resolving `ctx.model`
from a map, the `candidates` and `minChars` plumbing for the port, and a
suggest-once flag in the session record. Nothing about USSD or SMS rendering
changes.

---

## 12. Verify first

1. **Is Wolof, Hausa and Swahili in CommonLingua's 61?** The card and press
   release do not say. Read the training data or run `predict.py` on known
   text in each.
2. **Accuracy on short, keypad-typed, code-mixed input** in the target
   markets, per language, for CommonLingua and at least one alternative, on
   a labelled set built from real or realistic messages (FLORES-style
   sentences cut to 1–5 words is a start, not the finish). The model card
   says it was not assessed here; assume it is weak until shown otherwise.
3. **What the score means.** Whether `0.99` is a probability, how it
   behaves on short text, and what threshold gives an acceptable
   false-switch rate on the labelled set.
4. **Whether an ONNX export gives identical answers** and runs from Node
   within the reply budget. Without it the options are a sidecar service or
   no detector (§6).
5. **Whether the language menu alone is enough.** If users choose a language
   and stay, detection may not be worth building. Ask the two or three teams
   already running USSD services (TODO) how often people switch.
6. **Whether a single multilingual model is good enough** for most
   developers, which would make routing rarely needed.
7. **Real strings through `kalangu locale check`:** a Wolof and a Hausa
   translator reading the §2.3 table and saying whether the flattening is
   tolerable.

---

## 13. Testing plan (priority order)

1. **The checker:** missing, extra, empty and unchanged keys; lost and extra
   placeholders; the USSD and SMS reports on strings with `ë`, `ŋ`, `ɗ`.
2. **Language menu:** ordered by country; each language in its own name;
   the choice persists across channels and redials; switching later works.
3. **Detector port with a fake:** `candidates` honoured (an answer outside
   them is treated as `null`), below `minChars` never called, never run on a
   menu number, a different confident answer offers the menu once and a "No"
   is remembered.
4. **Routing:** map resolution by locale, fallback to `default` with a
   warning, startup check that keys are known locales.
5. **Locale fallback:** a partial locale falls back to the default, then
   English, and never breaks rendering.
6. **A detector evaluation harness** that takes a labelled file and prints
   per-language accuracy and the confusion matrix, so §12 item 2 can be
   answered repeatably rather than once.

---

## 14. Open questions

Each has a recommendation so they can be settled quickly.

1. **Detect once per session** (recommended), or re-evaluate when the input
   language clearly changes?
2. **Menu first, detection as a hint,** and no detector in the first slice
   (recommended), or build detection first?
3. **Where contributed locales live:** `locales/<code>.ts` in this repo with
   a review header (recommended), a separate `@kalangu/locales` package, or
   a community repository?
4. **`kalangu locale check` as a core CLI** (recommended, small and
   dependency-free), or a script in the repository only?
5. **Model map in core** (recommended, opt-in) or leave routing entirely to
   the developer's handler, since `ctx.locale` is already there?
6. **Country-to-locales prior:** a built-in table for the first markets
   (recommended, small and easy to correct) or developer-supplied only?
7. **Experimental versus reviewed locales:** ship unreviewed translations
   marked experimental (recommended) or hold them until a speaker has signed
   off?
