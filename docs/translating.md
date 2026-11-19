# Translating Kalangu

Kalangu's fixed strings (the "Yes", "Invalid choice", payment messages and so
on) can be translated by anyone who speaks the language, with no code. See
the [languages design](languages-design.md) §8 and §9 for the why.

## Steps

1. Copy the English messages from `packages/core/src/locales.ts` (the `en`
   object) into a JSON file named for the language, e.g. `wo.json`, and
   translate the values. Keep the keys exactly. You may translate only some:
   anything missing falls back to the default language.
2. Keep every `{placeholder}` exactly as written: the program fills it in
   (`{amount}`, `{yes}`). You can move it within the sentence.
3. Run the checker from the repository root:

   ```
   pnpm build
   node packages/core/dist/cli.js locale check wo.json --verbose
   ```

   Outside the repository, the same checker comes with the published
   package: `npm install @kalangu/core`, then
   `npx kalangu locale check wo.json --verbose`.

   It reports lost or invented placeholders (errors), strings that will take
   more than one USSD screen or SMS segment, and the letters USSD shows
   differently. `--complete` makes a missing message an error, and `--strict`
   makes warnings fail.
4. **Mind the channels.** USSD shows plain ASCII, so Wolof `ë`, `ŋ` and `ó`
   and Hausa `ɓ`, `ɗ` and `ƙ` appear as `e`, `ng`, `o` and `b`, `d`, `k`. If
   that makes a word ambiguous, choose a wording that survives it. On SMS one
   such letter makes the whole message UCS-2, 70 characters per segment
   instead of 160. The checker lists both, so you can judge.
5. **Use it.** Kalangu does not load translation files on its own. Pass the
   messages to your agent:

   ```js
   import { readFileSync } from "node:fs";

   const wo = JSON.parse(readFileSync("wo.json", "utf8"));
   createAgent({ messages: { wo }, languages: { supported: [/* ..., */ { code: "wo", name: "Wolof" }] } });
   ```

   If the file came from the drafting script below, pass its `messages`
   object, not the whole file.
6. **Share it.** Open a pull request with the file at `locales/<code>.json`.
   Machine drafts for Wolof, Hausa and Swahili are already there, waiting for
   a speaker to review them ([`locales/`](../locales/README.md)).
   That folder is where contributions wait; Kalangu does not read it. Shipping
   a language inside `@kalangu/core`, as `en` and `fr` are, is still an open
   decision ([languages design](languages-design.md) §14), so until then a
   merged translation is used as in step 5. A translation is marked
   **reviewed** only when a speaker of that language other than the author has
   checked it, and the file says who; until then it is **experimental**.

## Starting from a machine draft

If no speaker is at hand to write the first
version, `scripts/translate-locale.mjs` asks Gemini for a draft and runs the
checker on it:

```
pnpm build
export GEMINI_API_KEY=...   # your own key; never paste it into a chat, issue or commit
node scripts/translate-locale.mjs wo --name Wolof --reference fr
```

It writes `locales/wo.draft.json`, marked as an unreviewed machine draft, and
sends Google only Kalangu's fixed strings. Models are much weaker in Wolof,
Hausa and other African languages than their fluent output suggests, so a
draft is a starting point for a native speaker, never a translation to ship
as it is. `--dry-run` shows the request without sending anything.

## Your agent's own text

Agent content (menu titles, answers) is the developer's own and lives in the
agent definition as `{ en: "...", wo: "..." }`, not in these files.
