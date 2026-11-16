# @kalangu/core

Build AI agents that work on any phone, including basic keypad phones.
This is Kalangu's core: turns, steps, the budgeter, the engine, sessions
and deferral. It has no runtime dependencies and never imports a model or
gateway SDK.

> Alpha. The API may change before 1.0.

```sh
pnpm add @kalangu/core @kalangu/ussd @kalangu/sms
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

What it handles for you:

- **Typed turns.** Steps return `say`, `choose`, `ask` or `confirm`; each
  channel renders them (numbered USSD menus, numbered SMS replies).
- **The budgeter.** USSD screens stay within the screen limit (160 by
  default) and a safe character set, with `98. More` paging. SMS length is
  counted by encoding: one character outside GSM-7 drops a segment from 160
  to 70 characters. Text is never silently cut.
- **Deferral.** On USSD a handler gets 4 seconds (`deadlineMs`, at most 10).
  If it is slower, the user is told an SMS is coming and the answer is sent
  by SMS when ready.
- **Sessions** keyed by phone number, resumable on redial. In memory by
  default; pass a durable `sessionStore` in production.
- **Privacy.** Phone numbers are masked in logs by default.

On serverless platforms, pass `background: { run: (task) => ctx.waitUntil(task()) }`
(or a queue), or deferred answers are never sent.

Full documentation, design and the runnable demo:
https://github.com/utachicodes/kalangu

MIT licensed.
