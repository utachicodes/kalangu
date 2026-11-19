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

**Documentation:** <https://kalangu.utachi.website/docs/>, with a
[quick start](docs/quick-start.md), a guide to [building agents](docs/agents.md),
and guides for the Africa's Talking sandbox and translating.

## Status: alpha

**Alpha packages are on npm**: `@kalangu/core`, `@kalangu/ussd`,
`@kalangu/sms` and `@kalangu/sim`, published with verified provenance. The
API may change before 1.0. Payments have only been run against a fake
provider, so do not use them with real money. The design is still open for
review, and the verify-first checklist in [TODO.md](TODO.md) (real
operators, real costs) is not done.

| Start here | What it is |
|---|---|
| `pnpm install && pnpm demo` | The clinic agent on a simulated keypad phone; no account or API key |
| [docs/design.md](docs/design.md) | The v0.1 design: package layout, public API, turn types, sessions & deferral, the budgeter, Africa's Talking adapters, the simulator, the test plan |
| [docs/payments-design.md](docs/payments-design.md) | The 0.2 payments design (pawaPay deposits): draft for review, no code yet |
| [docs/design.md §12](docs/design.md#12-open-questions) | Seven open questions — the most useful feedback right now |
| [TODO.md](TODO.md) | Build order and the verify-first checklist |
| [CHANGELOG.md](CHANGELOG.md) | What has landed so far |

| Package | What it does |
|---|---|
| `@kalangu/core` | Turns, steps, the budgeter, the engine, sessions, deferral. No runtime dependencies |
| `@kalangu/ussd` | Africa's Talking USSD callbacks |
| `@kalangu/sms` | Africa's Talking SMS: send, incoming messages, delivery reports |
| `@kalangu/sim` | Terminal keypad-phone simulator, and a scriptable phone for tests |
| `examples/clinic` | The example agent behind `pnpm demo` |

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

| Version | Ships | Proves | Status (19 Nov 2026) |
|---|---|---|---|
| 0.1 | core, ussd (Africa's Talking), sms, terminal keypad simulator, one example agent | A model-backed agent works on USSD despite the time limit | Built and published (latest `0.1.0-alpha.9`). Not yet tested on real operators |
| 0.2 | pay turns, policy layer, pawaPay sandbox adapter | An agent can take money safely | Engine built and tested against a fake provider. The pawaPay adapter waits for a sandbox account and its terms |
| 0.3 | language detection, per-language model routing, language test command | The agent holds up outside English and French | Language menu, `kalangu locale check`, detector port and model map built. Wolof, Hausa and Swahili translations and a real detector wait for native speakers and data |
| 0.4 | WhatsApp adapter + Chat SDK community adapter | One agent, every channel | Designed ([docs/whatsapp-design.md](docs/whatsapp-design.md)). Code waits for a Meta test number |

Text normalization for African languages (matching what people type,
spelling on USSD) is designed in
[docs/normalization-design.md](docs/normalization-design.md); its first step,
matching typed answers regardless of accents, is built. The full list of what
is done and what is next is in [TODO.md](TODO.md).

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
- Open an issue or comment inline. Nothing is sacred yet; the code is
  young enough that changing a design is still cheap.
- If you run USSD services today: question #7 in [TODO.md](TODO.md) is for
  you — would deferral-to-SMS suit your users?

## Try it

```sh
pnpm install
pnpm demo
```

Dial `*384*1#`, choose `2`, and ask a question. The example's fake nurse
takes 6 seconds and the deadline is 4, so the screen says the answer will
come by SMS, and a couple of seconds later it does. `x` hangs up mid-session
(dial again to resume), `sms <text>` texts the agent, `q` quits.

To have a real model answer instead, run a local [Ollama](https://ollama.com)
model: `ollama pull llama3.2`, then `OLLAMA_MODEL=llama3.2 pnpm demo`
(`OLLAMA_HOST` if it is not on this machine). Or use Gemini: with your
`GEMINI_API_KEY` exported in the shell, `GEMINI_MODEL=gemini-3.5-flash-lite
pnpm demo`. See [examples/clinic/src/ollama.ts](examples/clinic/src/ollama.ts)
and [gemini.ts](examples/clinic/src/gemini.ts).

To run the same example against Africa's Talking's real gateway, in their
free sandbox with their phone simulator, follow
[docs/sandbox-guide.md](docs/sandbox-guide.md).

The packages run on Node 20 or later; the test suite needs Node 22.12 or
later. Requires pnpm. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Write an agent

```sh
npm install @kalangu/core @kalangu/ussd @kalangu/sms
```

```ts
import { ask, createAgent, menu, say } from "@kalangu/core";
import { africasTalkingSms } from "@kalangu/sms";
import { africasTalkingUssd } from "@kalangu/ussd";

const agent = createAgent({
  model: myModel, // anything; handlers get it as ctx.model
  channels: [
    africasTalkingUssd({ code: "*384*1#", path: "/ussd" }),
    africasTalkingSms({ username: "...", apiKey: "...", senderId: "CLINIC", path: "/sms" }),
  ],
  start: menu("Clinic line", {
    "Opening hours": say("Open Monday to Saturday, 8:00 to 18:00."),
    "Ask a nurse": ask("Type your question", (question, ctx) => ctx.model.answer(question)),
  }),
});

export default agent.requestHandler; // standard Request -> Response
```

- **Steps**: `menu`/`choose` (numbered options), `ask` (free text, or
  `{ input: "number" }`), `confirm` (yes/no), `say` (final message). Text can
  be a string or `{ en: "...", fr: "..." }`.
- **Handlers** get `(input, ctx)` and return a string (a final message), a
  step (shown next), or nothing (back to the menu above). `ctx.session` is
  per-phone state, `ctx.locale` switches language.
- **Deadline**: on USSD a handler has 4 s (`deadlineMs`, at most 10 s).
  After that the user is told an SMS is coming, and the answer is sent by
  SMS when it is ready. Fixed menus never wait.
- **Serverless**: deferred answers run after the response is sent. Pass
  `background: { run: (task) => ctx.waitUntil(task()) }` (or a queue) on
  platforms that freeze the process, or those answers are never sent.
- **Payments** (0.2, unreleased, fake provider only so far): a `pay` step
  and `createAgent({ payments })` with a mandatory policy. Starting a
  payment and waiting for its outcome run in the background, and that
  waiting is lost when the process restarts or a serverless platform
  freezes it. **Call `agent.payments.reconcile()` from a cron job or
  scheduler, about every 5 minutes**; on serverless it is the only reliable
  way to finish payments, and a payment whose outcome is never checked is
  never reported to the user. Pass a `background` that keeps the process
  alive there too, since initiating the payment runs in it. See
  [docs/payments-design.md](docs/payments-design.md) §6.5.
- **Languages**: `createAgent({ languages: { supported: [...] } })` asks the
  user to pick a language on first contact and remembers it per phone number.
  The menu names each language in itself and lists the likely ones for the
  caller's country first (a prior, not a guess; the list is never shortened).
  Each language needs messages: `en` and `fr` ship, others go in `messages`.
  `languageMenu()` is the same step for a "Language" entry in your tree.
  Optionally, `languages.detection` takes a detector you supply and offers
  to switch when a typed answer looks like another of your languages (it
  never switches silently), and `models: { default, wo: ... }` gives handlers
  a model per language as `ctx.model`.
  Check a translation with `kalangu locale check wo.json`. See
  [docs/languages-design.md](docs/languages-design.md).
- **Sessions** are in memory by default and keyed by phone number; pass a
  durable `sessionStore` for production. Agents that take payments need one
  whose `save` honours `ifVersion` atomically (`atomic: true`), so a
  double-tapped "Yes" cannot start two payments.
- **Callbacks are not signed** by the gateway. Use hard-to-guess paths and,
  where you can, allow only the gateway's IP addresses.

[`examples/clinic/src/server.ts`](examples/clinic/src/server.ts) runs the
example on Africa's Talking (sandbox or live) with Node's `http` module.

## Known limits

To report a security problem, see [SECURITY.md](SECURITY.md); please do not
open a public issue.

- A `*` typed inside a free-text USSD answer splits it; the gateway sends
  no way to tell it apart from a separator. Numeric input is unaffected.
- USSD screens are restricted to printable ASCII: accents are dropped
  (`é` → `e`), letters such as `ŋ` are transliterated (`ng`), and anything
  else is removed with a warning. Hausa's hooked letters become plain ones
  (`ɗ` → `d`), which merges different sounds; per-language spellings wait for
  Hausa readers (normalization design §10). A user can always type back what
  a screen showed: typed answers are matched ignoring accents, case, spacing
  and apostrophe style.
- A redial while an answer is still pending repeats the "SMS shortly"
  notice instead of waiting.
- Payments run against a fake provider only; there is no real provider yet,
  so do not use them with real money.
- Language detection is an interface you supply a detector for; none ships,
  and its threshold has no default until one is measured. WhatsApp and voice
  are later versions.

## License

[MIT](LICENSE) © Abdoullah Ndao
