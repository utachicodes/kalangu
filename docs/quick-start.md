# Quick start

Kalangu builds AI agents that work on any phone, keypad phones included, over
USSD and SMS. This page gets you from nothing to an agent you can talk to in
a few minutes, with no account and no API key.

You need Node 20 or later.

## 1. See it work

Clone the repository and run the demo:

```sh
git clone https://github.com/utachicodes/kalangu.git
cd kalangu
pnpm install
pnpm demo
```

A keypad phone appears in your terminal. Dial `*384*1#`, choose `2`, and ask
a question. The example's fake nurse takes 6 seconds and the deadline is 4,
so the screen says the answer will come by SMS, and a couple of seconds later
it does. `x` hangs up mid-session (dial again to resume), `sms <text>` texts
the agent, `q` quits.

## 2. Write your first agent

In a new folder:

```sh
npm init -y
npm pkg set type=module
npm install @kalangu/core @kalangu/sim
```

Create `agent.mjs`:

```js
import { ask, createAgent, menu, say } from "@kalangu/core";

// Any object can be the model: handlers receive it as ctx.model.
const model = {
  async answer(question) {
    return `You asked: ${question}`;
  },
};

export const agent = createAgent({
  model,
  channels: [], // the simulator brings its own; real channels come in step 4
  start: menu("Clinic line", {
    "Opening hours": say("Open Monday to Saturday, 8:00 to 18:00."),
    "Ask a nurse": ask("Type your question", (question, ctx) => ctx.model.answer(question)),
  }),
});
```

## 3. Talk to it

Create `try.mjs`, which drives the agent with a simulated phone:

```js
import { createPhone } from "@kalangu/sim";
import { agent } from "./agent.mjs";

const phone = createPhone(agent, { code: "*384*1#" });

console.log(await phone.dial("*384*1#"));
console.log(await phone.press("2"));
console.log(await phone.press("Is the clinic open on Sunday?"));
```

Run it with `node try.mjs`:

```text
{ text: 'Clinic line\n1. Opening hours\n2. Ask a nurse', end: false }
{ text: 'Type your question', end: false }
{ text: 'You asked: Is the clinic open on Sunday?', end: true }
```

Each line is one USSD screen. `end: true` means the session is over. To use
the keypad in your terminal instead, run
`import { runTerminal } from "@kalangu/sim"; await runTerminal(agent, { code: "*384*1#" });`.

## 4. Put it on a real gateway

Add the Africa's Talking channels and serve the agent:

```sh
npm install @kalangu/ussd @kalangu/sms
```

```js
import { africasTalkingSms } from "@kalangu/sms";
import { africasTalkingUssd } from "@kalangu/ussd";

export const agent = createAgent({
  model,
  channels: [
    africasTalkingUssd({ code: "*384*1#", path: "/ussd" }),
    africasTalkingSms({ username: "sandbox", apiKey: process.env.AT_API_KEY, sandbox: true, path: "/sms" }),
  ],
  start: /* as before */,
});
```

`agent.requestHandler` is a standard `Request` to `Response` function, so it
runs anywhere that serves one: for example `Bun.serve({ fetch:
agent.requestHandler })` or `Deno.serve(agent.requestHandler)`. For Node's
`http` module, copy the small adapter in
[`examples/clinic/src/server.ts`](../examples/clinic/src/server.ts).

To try it on Africa's Talking's free sandbox with their phone simulator,
follow the [sandbox guide](sandbox-guide.md).

## Next

- [Agents](agents.md): steps, handlers, sessions, slow answers, languages,
  and what to set before production.
- [Guides](sandbox-guide.md): the sandbox, translating Kalangu, releasing.
- [Design](design.md): why it works the way it does.
