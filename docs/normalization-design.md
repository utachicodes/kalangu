# Kalangu — text normalization design

Status: **draft for review. No normalization code exists.**
Date: 2026-11-17. Scope: how Kalangu should handle the many ways people
write African languages on a phone, for Wolof, Hausa and Swahili first. It
also settles whether this work belongs in its own repository (§9).

---

## 1. What "normalization" means here

Turning the many ways a word is written into a form a program can rely on.
Three jobs, kept apart because they have different rules:

| Job | Input | Output | Used for | Ever shown to a user? |
|---|---|---|---|---|
| **Fold** | what the user typed | a comparison key | matching a typed answer to a menu label, "yes", a language name | Never |
| **Render for USSD** | correct text | plain ASCII | USSD screens, which accept no other characters | Yes |
| **Canonicalize** | what the user typed | the same text, tidied | language detection and models | Only to a model |

Not in scope: translation, spelling correction of what people mean, speech,
and the Arabic-script writing of these languages (Ajami, and Wolofal for
Wolof). Those are separate problems.

---

## 2. Why now: two problems in the code today

Measured on `main` on 17 Nov 2026, with the engine's own `interpret` and
`toUssdSafe`.

**A menu label the user cannot type back.** The language menu offers
"Français". On USSD it is displayed as **"Francais"**, because USSD allows
plain ASCII only. A user who types back what they see is refused:

| Typed | Result |
|---|---|
| `Français`, `français` | option 1 |
| `francais`, `FRANCAIS`, `Francais ` (trailing space) | **"Invalid choice"** |
| `2`, `wolof` | option 2 |

Typing the number always works, but a keypad user typing the word cannot
produce a cedilla. The comparison (`render.ts`, `interpret`) is lower-case
only: it ignores neither accents nor spaces.

**Hausa letters collapse on USSD.** The generic table turns `ɓ`, `ɗ`, `ƙ`
and `ƴ` into `b`, `d`, `k` and `y` (`ɓarna` becomes `barna`, `Ɗan` becomes
`Dan`). Those are different sounds from plain `b`, `d`, `k` and `y`, so words
can become ambiguous. Wolof loses less: `ñ` becomes `n`, `ë` becomes `e`, `ŋ`
becomes `ng`.

---

## 3. Facts (read 17 Nov 2026)

Secondary sources, mostly. Every rule in §5 still needs a native speaker
(§10).

### 3.1 Wolof

- Wolof's Latin spelling in Senegal was set by government decrees between
  1971 and 1985. A 1971 decree adopted one alphabet for several national
  languages, Wolof among them. The Centre de linguistique appliquée de Dakar
  (CLAD) is the recognised authority on spelling.
- The letters include `à`, `é`, `ë`, `ñ`, `ŋ` and `ó` besides the basic
  Latin ones. Sources count the alphabet differently (27 or 29 letters),
  probably depending on whether accented vowels count separately; I did not
  confirm this against a primary text.
- Teaching material notes that the accent on a long vowel is written on the
  first vowel only in the CLAD standard, and that some writers put it on both.
  So even careful writers vary.
- In everyday typing many people use French-influenced spellings rather than
  the official ones. I have no source measuring how common each is; that is
  exactly the data §8 asks for.

Sources: the Wikipedia articles on the Wolof language and the Wolofal
alphabet, the text of the Senegalese decree hosted by Université Laval
(axl.cefan.ulaval.ca), and Polyglot Club's Wolof alphabet lesson.

### 3.2 Hausa

- Standard Hausa in Latin script (boko) uses the hooked letters `ɓ`, `ɗ`,
  `ƙ` and `ƴ`, and the glottal stop written with an apostrophe (`ʼy`).
- Where hooked letters are not available, writers use an apostrophe with the
  plain letter. Richard Ishida's Hausa script notes describe `ɓ` as `b` with a
  modifier apostrophe, and `ƴ` as `ʼy`, with the apostrophe **before** the
  `y`. They also note that the BBC, CRI and Wikipedia write the ordinary ASCII
  apostrophe (`'`) instead of the modifier letter, and some texts a curly
  quote.
- Speakers do not treat plain `b`, `d` and `k` as acceptable: a Unicode
  mailing-list post argues the hooked letters are not optional, and a Hausa
  writer reports being corrected for using apostrophes instead of them.
- So the right ASCII form for USSD is a question for Hausa readers (§10),
  not one to settle from sources: `b'`, `'b`, or the plain letter.

Sources: Richard Ishida's Hausa notes (r12a.github.io/scripts/latin/ha.html),
a 2010 thread on the Unicode mailing list about the hooked characters, and
Hausa keyboard guides (amsoshi.com, branah.com), as summarised by a web
search; not read in full.

### 3.3 Swahili

Standard Swahili spelling uses only basic Latin letters, so it fits USSD and
GSM-7 SMS unchanged. Its normalization needs are about how people type
(abbreviations, English mixed in), not about letters.

---

## 4. Principles

1. **Deterministic and local at runtime.** A rule table, tested, with no
   network call and no model. It runs on every typed answer, inside the
   10-second USSD bound, and must cost nothing.
2. **Never alter what the user reads without a reason.** Folding is for
   comparing only. Rendering for USSD changes text only because the channel
   forces it, and then the way readers of that language expect.
3. **Per language, with a generic default.** Today's single table stays the
   fallback. A language gets its own rules only when a speaker has reviewed
   them.
4. **Provenance on every rule.** Each table says who proposed it, who
   reviewed it and when. A rule nobody has reviewed is marked experimental.
5. **No user text leaves the device to normalize it.** Typed answers are
   personal data. A model may help write rules offline (§7); it does not see
   users' messages.

---

## 5. The three operations

### 5.1 Fold (for comparison only)

`fold(text, locale) -> key`. Two strings match when their keys are equal.

Generic steps, for every language:

- Unicode compatibility decomposition, then drop combining accents
  (`Français` and `francais` both become `francais`). This already makes
  Wolof `ñ`, `ë`, `é` and `ó` match `n`, `e`, `e` and `o`, since those are
  accented letters. Letters that are not an accented form keep their own key
  (`ŋ`, `ɓ`, `ɗ`, `ƙ`, `ƴ`).
- Lower case, trimmed, inner whitespace collapsed to one space.
- All apostrophe-like characters (`'`, `ʼ`, `’`, `‘`) made one.

Per-language additions, once reviewed. Examples to confirm with speakers,
not decisions:

- **Wolof:** `ŋ` and `ng` equal (the generic step does not cover it, since
  `ŋ` is a letter of its own).
- **Hausa:** `ɓ`, `b'` and `'b` equal, and similarly for `ɗ`, `ƙ` and `ƴ`.
  Whether plain `b` should also match `ɓ` is a real question: folding it in
  helps people typing on a keypad, but merges two different sounds.

Where it is used: `interpret`'s comparison of typed text with option labels,
the yes and no words, and language names. This alone fixes the first
problem in §2, and needs no language data for the accent part.

### 5.2 Render for USSD

`toAscii(text, locale) -> text`, replacing the generic table in `toUssdSafe`
for languages that have reviewed rules. The generic table stays the
fallback.

- A per-language table can map a letter to more than one character (a
  possible Hausa rule, `ɗ` to `d'`). Text then gets longer, so the screen
  budget must be measured **after** rendering, which the budgeter already
  does. `kalangu locale check` already shows what each letter becomes.
- The table is chosen by the turn's locale, which the engine knows.

### 5.3 Canonicalize (for detection and models)

`canonical(text, locale) -> text`. Conservative by default: Unicode
composition (NFC), one apostrophe, collapsed whitespace. Nothing that changes
spelling.

Spelling-variant maps (a French-influenced spelling to the official one) are
**data**, reviewed per entry, and opt-in. A wrong variant entry silently
changes what a model is told the user said, so the bar is higher than for
folding.

---

## 6. Data

Per language, one file, for example `normalize/data/ha.json`:

```json
{
  "language": "ha",
  "reviewed": false,
  "provenance": { "proposedBy": "…", "reviewedBy": null, "date": "2026-11-17" },
  "fold": { "ɓ": ["b'", "'b"], "ɗ": ["d'", "'d"] },
  "ascii": { "ɓ": "b'", "ɗ": "d'" },
  "variants": []
}
```

- **Tests come with the data:** pairs of what someone typed and what it
  should fold to, taken from real (consented, anonymised) messages where
  possible.
- **License:** the data is the most reusable part of this work, so its
  license should be chosen on purpose (for example a Creative Commons
  license for data, alongside MIT for code), and contributors told which.

---

## 7. Where Gemini fits

**Offline, to help write the data. Not at runtime by default.**

- **Good uses:** proposing spelling variants for a word list, drafting
  folding and ASCII tables, and generating test pairs. The same pattern as
  `scripts/translate-locale.mjs`: a script that asks for a draft, marks it
  unreviewed, and checks its shape.
- **Then a speaker reviews.** A model's spelling variants in Wolof or Hausa
  can be confidently wrong, and the data is only as good as its review.
- **Why not at runtime:**
  - **Privacy:** it would send every user's message to Google.
  - **Time:** it adds latency inside the USSD bound.
  - **Cost:** every turn costs money.
  - **Testing:** the results are not reproducible. A future `Normalizer`
    interface could allow a model as an optional plug-in, as the language
    detector is, but the default stays rule-based.

---

## 8. Measuring whether it helps

Normalization is worth what it fixes, so measure that, not the elegance of
the rules.

- **Menu matching:** the share of typed (non-number) answers that match an
  option, before and after folding. It needs typed answers from real users,
  collected with consent and without phone numbers.
- **Detection:** the accuracy of language detection on canonicalized versus
  raw text, with the evaluation harness in `docs/languages-design.md` §13.
- **Readability on USSD:** whether readers of each language prefer the
  per-language ASCII forms over the generic ones, asked directly.

---

## 9. Its own repository?

**Not yet. Start inside this repository and split it out later.**

- **Start here:** a `packages/normalize` package with zero dependencies,
  holding the functions and the data tables, used by core. The data-drafting
  and evaluation scripts go in `scripts/normalize/`.
- **Why not now:** there are no reviewed rules, no data and no reviewers yet.
  The first users are inside Kalangu (`interpret` and `toUssdSafe`), so early
  changes would touch two repositories at once. Splitting a folder into its
  own repository later keeps its history (`git subtree split`), so waiting
  costs nothing.
- **When to split, into `kalangu-normalization`:**
  - Native speakers contribute data regularly and need their own review flow.
  - Someone outside Kalangu wants the data or the functions.
  - The evaluation needs its own tooling (for example Python and published
    datasets) that does not belong next to a TypeScript library.
  - The data needs a license different from the code's.

---

## 10. Questions for native speakers (verify first)

1. **Hausa on USSD:** should `ɓ`, `ɗ`, `ƙ` and `ƴ` be shown as `b'`, `d'`,
   `k'` and `'y`, as `'b` style, or as plain letters? Is the extra character
   worth it on a 160-character screen?
2. **Hausa matching:** when someone types plain `b` for `ɓ`, should it still
   match? It helps keypad users but merges two sounds.
3. **Wolof on USSD:** are `ë` to `e`, `ñ` to `n` and `ŋ` to `ng` acceptable,
   or does a reader expect something else?
4. **Wolof typing:** which French-influenced spellings are common enough to
   fold (for example in greetings and numbers)? This needs examples, not
   guesses.
5. **Swahili:** which abbreviations and English words are common in typed
   answers?
6. **Collection:** who can provide consented, anonymised typed samples per
   language, and under what terms?

---

## 11. Build order

1. **Generic folding in `interpret`** (§5.1, generic steps only): ignore
   accents, case, extra spaces and apostrophe style when comparing typed text
   with labels and the yes and no words. It fixes the "Francais" problem,
   needs no language data, and is testable today.
2. **`packages/normalize`** with the three functions, the generic default,
   and the data format, used by core.
3. **The Hausa USSD table**, once question 1 is answered.
4. **The drafting script** for variant lists and test pairs, as described in
   §7.
5. **Per-language folding and canonicalization data**, reviewed, as
   speakers provide it.
6. **The measurements** in §8, once there are samples.

---

## 12. Open questions

1. **Generic folding first,** shipped before any language data (recommended),
   since it fixes a bug users hit today?
2. **A `packages/normalize` package now,** or keep the generic folding in
   core until there is language data (recommended: in core first, since step
   1 is a few lines)?
3. **The data license:** Creative Commons for the data and MIT for the code
   (recommended), or MIT for everything?
4. **A runtime `Normalizer` plug-in for models:** later, and off by default
   (recommended), or never?
