# Kalangu: AI Agents for Every Phone over USSD and SMS

A short paper (IEEE conference format, 4 pages): the problem, Kalangu's design
(typed turns, the encoding-aware budgeter, deferral to SMS), the Ndiédieng case
study, measurements on the built packages, and what is still unverified.

| File | What it is |
|---|---|
| `paper.tex` | The paper (IEEEtran, compiled with XeTeX) |
| `refs.bib` | References: standards, gateway docs, surveyed packages |
| `paper.pdf` | The compiled paper |
| `bench/bench.mjs` | The measurements of Section VI, on the built packages |
| `bench/results.json` | Their raw output, with the machine they ran on |

## Rebuild

```sh
brew install tectonic                       # once: a small LaTeX engine
cd papers/kalangu && tectonic -X compile paper.tex
```

Tectonic fetches the IEEE template and the TeX Gyre fonts on first run.

## Re-run the measurements

```sh
pnpm install && pnpm build
node papers/kalangu/bench/bench.mjs > papers/kalangu/bench/results.json
```

No network, account or API key: everything runs on Kalangu's simulator. Update
the numbers in Section VI if they change.

The authors and acknowledgments are placeholders to fill in before submission.
