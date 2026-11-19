# Contributed translations

Translations of Kalangu's fixed strings (the "Yes", "Invalid choice",
payment messages and so on) wait here until they are reviewed. **Kalangu
does not load this folder**: pass a translation to your agent yourself, as
the [translation guide](../docs/translating.md) shows. Whether reviewed
languages later ship inside `@kalangu/core` is still open (languages design
§14).

| File | Language | Status |
|---|---|---|
| `wo.draft.json` | Wolof | Machine draft (Gemini, 19 Nov 2026), **not reviewed** |
| `ha.draft.json` | Hausa | Machine draft (Gemini, 19 Nov 2026), **not reviewed** |
| `sw.draft.json` | Swahili | Machine draft (Gemini, 19 Nov 2026), **not reviewed** |

A `.draft.json` file is a starting point for a native speaker, never a
translation to use as it is: models are much weaker in these languages than
their fluent output suggests, and nobody who does not speak the language can
tell. Each draft passes `kalangu locale check` (placeholders kept, every key
present), which says nothing about whether the words are right.

## Reviewing a draft

If you speak one of these languages:

1. Read every string in the draft and correct it. Keep each `{placeholder}`.
2. Run `npx kalangu locale check <file> --verbose` and fix any error.
3. Rename the file to `<code>.json`, set `"reviewed": true` and add your
   name (or handle) as `"reviewedBy"` in `_draft`, and open a pull request.
   A translation counts as reviewed when someone other than its author has
   checked it.

CI runs the checker on every file here, so a lost placeholder fails the
build.
