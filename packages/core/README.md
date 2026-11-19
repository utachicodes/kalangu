# @kalangu/core

Build AI agents that work on any phone, including basic keypad phones.
This is Kalangu's core: turns, steps, the budgeter, the engine, sessions
and deferral. It has no runtime dependencies and never imports a model or
gateway SDK.

> Alpha. The API may change before 1.0.

```sh
npm install @kalangu/core @kalangu/ussd @kalangu/sms
```

Documentation: [quick start](https://kalangu.utachi.website/docs/quick-start/),
[building agents](https://kalangu.utachi.website/docs/agents/),
[models and gateways](https://kalangu.utachi.website/docs/providers/).

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

What it handles for you:

- **Typed turns.** Steps return `say`, `choose`, `ask` or `confirm`; each
  channel renders them (numbered USSD menus, numbered SMS replies).
- **Languages.** `createAgent({ languages: { supported } })` asks the user to
  choose a language once and remembers it per phone number. The menu names
  each language in itself and lists the likely ones for the caller's country
  first. `en` and `fr` ship; others are passed in `messages`. The
  `kalangu locale check wo.json` command (installed with this package)
  checks a translation for lost `{placeholders}` and for how each string fits
  USSD and SMS. An optional detector you supply can suggest a switch when a
  typed answer, or the SMS that starts a conversation, is in another of your
  languages; it never switches on its own.
- **The budgeter.** USSD screens stay within the screen limit (160 by
  default) and a safe character set, with `98. More` paging. SMS length is
  counted by encoding: one character outside GSM-7 drops a segment from 160
  to 70 characters. Text is never silently cut.
- **Deferral.** On USSD a handler gets 4 seconds (`deadlineMs`, at most 10).
  If it is slower, the user is told an SMS is coming and the answer is sent
  by SMS when ready.
- **Sessions** keyed by phone number, resumable on redial. In memory by
  default; pass a durable `sessionStore` in production, and test it with
  `checkSessionStore(() => myStore())`, which returns the contract's problems.
  The repository's clinic example has a reference store on Node's built-in
  SQLite.
- **Privacy.** Phone numbers are masked in logs by default.

## Payments: experimental, no real provider yet

The package contains a `pay` step, a policy layer (no policy, no payments),
payment polling and an SMS receipt, and `agent.payments.reconcile()` for a
scheduled job. **It has only been run against a fake provider.** There is no
pawaPay or other real provider package yet, so do not use it with real money.
It also needs a durable payment store and a session store whose `save`
honours `ifVersion` atomically (`atomic: true`), which you supply; test them
with `checkPaymentStore` and `checkSessionStore`. See
[docs/payments-design.md](https://github.com/utachicodes/kalangu/blob/main/docs/payments-design.md)
for what is built and what is not.

On serverless platforms, pass `background: { run: (task) => ctx.waitUntil(task()) }`
(or a queue), or deferred answers are never sent.

Documentation: https://kalangu.utachi.website/docs/ ·
Source, design and the runnable demo: https://github.com/utachicodes/kalangu ·
Security reports: [SECURITY.md](https://github.com/utachicodes/kalangu/blob/main/SECURITY.md)

MIT licensed.
