# Kalangu

> Agents for every phone, not just smartphones.

Kalangu is an open-source TypeScript toolkit for building AI agents that work
on any phone — including basic keypad phones. Write the agent once; it runs on
USSD and SMS, with WhatsApp and voice planned later, and mobile money payments
on the roadmap.

The name: the **kalangu** is the Hausa talking drum, which carried messages
between towns across West Africa for centuries by imitating the tones of
speech — a long-distance, low-bandwidth messaging network that needed no
literacy and no smartphone. That is the job this toolkit does for agents.

## Status: design review

**Nothing is published on npm and no code ships yet.** This repository
currently contains the v0.1 design, which is open for review:

| Start here | What it is |
|---|---|
| [docs/design.md](docs/design.md) | The v0.1 design: package layout, public API, turn types, sessions & deferral, the budgeter, Africa's Talking adapters, the simulator, the test plan |
| [docs/design.md §12](docs/design.md#12-open-questions) | Seven open questions — the most useful feedback right now |
| [TODO.md](TODO.md) | Build order and the verify-first checklist |
| [CHANGELOG.md](CHANGELOG.md) | What has landed so far |

## The problem

USSD and language models do not fit together, and no published open-source
library reconciles them:

| USSD reality | Model reality |
|---|---|
| Live, time-boxed session; total 20–180 s per operator; app response expected within ~10 s | Models think for seconds |
| About 160 characters per screen; anything longer is cut off | Models are wordy |
| Input arrives as everything typed so far, `*`-joined; replies must start `CON` or `END` | … |
| Mobile money settles asynchronously | … |
| Frontier models lose ~30 accuracy points on African languages | Users speak Wolof, Hausa, Swahili… |

Three ideas do the reconciling (full details in the design doc):

1. **Typed turns.** The agent never writes text straight to a phone. It
   returns a typed turn — `say`, `choose`, `ask`, `confirm` — and a renderer
   per channel converts that into what the channel can show: a numbered menu
   on USSD, a numbered reply-list on SMS, buttons on WhatsApp later.
2. **The budgeter.** Every outgoing screen or message is counted, paginated,
   and never allowed to be silently truncated. It counts by encoding: an SMS
   holds 160 characters in GSM-7 but only 70 once a single character falls
   outside that alphabet — which French, Wolof and Hausa diacritics will do.
3. **Deferral.** Model-backed steps run under a deadline (default 4 s). In
   time: the answer renders on the USSD screen. Too late: the session ends
   with "we'll text you", the model finishes in the background, and the
   answer arrives by SMS. Fixed menus never call the model and answer in
   milliseconds.

## Roadmap

| Version | Ships | Proves |
|---|---|---|
| 0.1 | core, ussd (Africa's Talking), sms, terminal keypad simulator, one example agent | A model-backed agent works on USSD despite the time limit |
| 0.2 | pay turns, policy layer, pawaPay sandbox adapter | An agent can take money safely |
| 0.3 | language detection, per-language model routing, language test command | The agent holds up outside English and French |
| 0.4 | WhatsApp adapter + Chat SDK community adapter | One agent, every channel |

The v0.1 goal: someone clones the repo, runs `pnpm install && pnpm demo`, and
within ten minutes has dialed a code on a simulated keypad phone, asked a
question, seen the "we'll text you" screen, and received the answer as a
simulated SMS — with no API key and no gateway account.

## For reviewers

- Start with [docs/design.md](docs/design.md). It states every verified
  gateway fact with sources (§2) and separates them from what still needs a
  real account or operator (§2.5).
- The seven open questions in §12 are where your judgement matters most —
  they change defaults, not implementation details.
- Open an issue or comment inline. Nothing is sacred yet; changing a design
  is cheaper than changing code.
- If you run USSD services today: question #7 in [TODO.md](TODO.md) is for
  you — would deferral-to-SMS suit your users?

## Local setup

```sh
pnpm install    # workspace scaffolding; packages land with v0.1
pnpm demo       # arrives with v0.1
```

Requires Node 20 or later and pnpm. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE) © Abdoullah Ndao
