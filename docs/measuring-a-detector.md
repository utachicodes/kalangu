# Measuring a language detector

Kalangu's language detection is a hint: when a typed answer looks like
another of your languages, the user is asked whether to switch (see
[Agents](agents.md#languages)). It needs a detector you supply and a
`threshold` and `minChars` you choose, and Kalangu gives neither a default,
because no detector has been measured on short, keypad-typed text in the
languages that matter here (Wolof, Hausa, Swahili and others).
`scripts/eval-detector.mjs` is how to measure one, so the numbers come from
your samples instead of a guess.

## Run it

From the repository root, with the example files (English and French only,
to show the format):

```sh
node scripts/eval-detector.mjs \
  --detector scripts/detector-eval/example-detector.mjs \
  --data scripts/detector-eval/example.tsv
```

## What it needs

**A detector**: an ES module exporting an object with
`detect(text, { candidates })`, as a default export, as `detector`, or as a
function (which may be async) that returns one. It must resolve to
`{ code, confidence }`, with `code` one of `candidates` and `confidence` from
0 to 1, or `null`. That is the same shape `languages.detection.detector`
takes, so the module you measure is the one you deploy. A model that only
runs in Python, such as CommonLingua, can be measured through a small
module that calls it as a service.

**Labelled samples**: one per line, `<code><TAB><text>`, or a `.jsonl` file of
`{"code": "wo", "text": "..."}`. Lines starting with `#` are comments.

- Use **real or realistic messages**, typed the way people type on a keypad:
  short, often without accents, sometimes mixing languages. Sentences cut to
  one to five words are a start, not the finish.
- Have each sample **labelled by someone who speaks the language**.
- Aim for **at least 100 per language**; the report warns below that.
- Include text in **none of your languages** under any other code (for
  example `xx`). A confident answer to it is a false offer, which is what
  you most want to avoid.

## What it reports

- **Per language:** how often the top answer is right, ignoring the
  threshold, and how often there is no answer. A **confusion matrix** shows
  which languages are mistaken for which.
- **Accuracy by length**, in words. Short input is the open question.
- **Kalangu's rule at each setting.** For every `threshold` and `minChars`,
  each sample is read as typed by someone whose language is its label:
  - a **false offer** is a confident answer naming another language, which
    would interrupt a user who is fine where they are;
  - **caught** is a confident answer naming the right one, which is what
    helps a user who is in the wrong language.
- **A suggestion:** the setting that catches the most while keeping false
  offers at or under `--max-false` (2% by default), choosing the more
  cautious setting on a tie, or a warning that no setting is safe enough.
- **Latency** against the detection timeout (`--timeout-ms`, default 1000):
  an answer later than that is ignored by Kalangu, so it is not counted.
- **The contract:** answers outside the candidates, scores outside 0 to 1,
  and calls that threw.

## Options

| Option | Use |
|---|---|
| `--candidates wo,fr,en` | Your agent's languages (default: every code in the data) |
| `--thresholds 0.6,0.8,0.9` | Thresholds to try |
| `--min-chars 10,20` | `minChars` values to try |
| `--max-false 0.01` | The false-offer rate you can accept |
| `--ascii` | Fold the text to plain ASCII first, as typed on a keypad and shown on USSD (needs `pnpm build`) |
| `--json` | The report as JSON, to compare detectors or keep a record |

Run it with and without `--ascii`: keypad users often type without accents,
and a detector that relies on them will do worse than it looks.

## Using the result

Set `languages.detection` with the suggested `threshold` and `minChars`, or
leave detection off if no setting is safe enough: the language menu works
without it. Keep the samples and the command, and run them again when the
detector or the languages change. The results are only as good as the
samples.
