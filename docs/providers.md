# Providers

An agent has two kinds of provider: the **model** that writes its answers,
and the **gateway** that carries its screens and messages to phones. Kalangu
is tied to neither. This page shows how to plug in each, and how to run one
agent on several at once.

## Models

Kalangu never calls a model itself. Whatever you pass as `model` reaches your
handlers as `ctx.model`, so any provider works: a local model, a hosted API,
your own service, or several of them.

```js
const agent = createAgent({
  model,  // any object, used by your handlers
  start: menu("Clinic line", {
    "Ask a nurse": ask("Type your question", (q, ctx) => ctx.model.answer(q)),
  }),
  channels,
});
```

Two things matter more on a phone than in a chat app:

- **Time.** A USSD gateway waits about 10 seconds. A handler that takes
  longer than `deadlineMs` (4 seconds by default) has its answer sent by SMS
  instead, so a slow model still works, but a fast one keeps the user on the
  same screen. See [slow answers](agents.md#slow-answers).
- **Length.** A long answer is split across USSD screens, which is fine, but
  an SMS reply over 4 segments is an error, never cut. Ask the model for
  short, plain-text answers, and shorten them if they still run long: the
  example's [`fitSms`](../examples/clinic/src/ollama.ts) cuts at the last
  whole sentence that fits.

Each snippet below is a complete `model` object. Keys come from environment
variables; never put one in your code or repository.

### Ollama, on your own machine

No account, no key, nothing leaves the machine. Install
[Ollama](https://ollama.com) and `ollama pull llama3.2`.

```js
const model = {
  async answer(question) {
    const res = await fetch("http://localhost:11434/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "llama3.2",
        stream: false,
        options: { num_predict: 150 },
        messages: [
          { role: "system", content: "Answer in plain text, in at most 2 short sentences." },
          { role: "user", content: question },
        ],
      }),
    });
    if (!res.ok) throw new Error(`Ollama answered ${res.status}`);
    return (await res.json()).message.content.trim();
  },
};
```

The clinic example does this with `OLLAMA_MODEL=llama3.2 pnpm demo`. The
server running the agent must be able to reach Ollama, so a serverless host
cannot use `localhost`.

### Claude

With Anthropic's SDK (`npm install @anthropic-ai/sdk`), which reads
`ANTHROPIC_API_KEY` from the environment:

```js
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

const model = {
  async answer(question) {
    const response = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 1024,
      output_config: { effort: "low" }, // short answers; raise it for harder questions
      // If the model declines a request, the API retries it on a fallback model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: "Answer in plain text, in at most 2 short sentences.",
      messages: [{ role: "user", content: question }],
    });
    if (response.stop_reason === "refusal") return "Sorry, I can't help with that.";
    return response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("")
      .trim();
  },
};
```

### Gemini

Google's REST API, with `GEMINI_API_KEY` in the environment:

```js
const model = {
  async answer(question) {
    const name = "gemini-3.5-flash-lite";
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${name}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: "Answer in plain text, in at most 2 short sentences." }] },
        contents: [{ role: "user", parts: [{ text: question }] }],
      }),
    });
    if (!res.ok) throw new Error(`Gemini answered ${res.status}`);
    const data = await res.json();
    return data.candidates[0].content.parts.map((p) => p.text).join("").trim();
  },
};
```

### Any API in OpenAI's chat format

Many providers and local servers accept OpenAI's chat completions format.
Set the address, key and model name for the one you use:

```js
const model = {
  async answer(question) {
    const res = await fetch(`${process.env.MODEL_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${process.env.MODEL_API_KEY}`,
      },
      body: JSON.stringify({
        model: process.env.MODEL_NAME,
        messages: [
          { role: "system", content: "Answer in plain text, in at most 2 short sentences." },
          { role: "user", content: question },
        ],
      }),
    });
    if (!res.ok) throw new Error(`The model answered ${res.status}`);
    return (await res.json()).choices[0].message.content.trim();
  },
};
```

### A different model per language

One model may be good in French and weak in Wolof. Pass `models` instead of
`model`, and `ctx.model` is the entry for the user's language, or `default`:

```js
createAgent({
  models: { default: claude, fr: claude, wo: wolofModel },
  languages: { supported: [/* ... */] },
  // ...
});
```

See [languages](agents.md#languages).

## Gateways

A gateway connects phones to your server: it turns a USSD dial or an SMS into
an HTTP request, and your reply back into a screen or a message. In Kalangu a
gateway is a **channel**.

### Africa's Talking: built

`@kalangu/ussd` and `@kalangu/sms` talk to [Africa's
Talking](https://africastalking.com), which reaches operators in several
African countries. Both run in one agent:

```js
import { africasTalkingSms } from "@kalangu/sms";
import { africasTalkingUssd } from "@kalangu/ussd";

createAgent({
  channels: [
    africasTalkingUssd({ code: "*384*1#", path: "/ussd" }),
    africasTalkingSms({ username: process.env.AT_USERNAME, apiKey: process.env.AT_API_KEY, path: "/sms" }),
  ],
  // ...
});
```

To try it without real operators, follow the
[sandbox guide](sandbox-guide.md).

### Several channels at once

One agent can serve any number of channels, each on its own path:

- **One user, every channel.** Sessions are keyed by phone number, so a user
  keeps their place, data and language whether they dial or text.
- **Slow answers** go out on the first SMS channel in the list that can send.
- **Paths must differ.** Two channels on the same path are refused at
  startup. `agent.requestHandler` sends each request to its channel by path.

### Another gateway: write a channel

There is no package yet for other gateways, but a channel is small. Core's
`smsChannel` and `ussdChannel` do the rendering; you add the route that reads
your gateway's request and answers in its format. An SMS gateway, with the
field names your gateway documents:

```js
import { smsChannel } from "@kalangu/core";

async function send({ to, text }) {
  // Call your gateway's send API here.
}

const mySms = smsChannel({
  id: "my-sms",
  send,
  routes: [
    {
      path: "/my-sms",
      async handle(req, agent) {
        const form = await req.formData();
        const outcome = await agent.handle({
          channel: "my-sms",
          phone: String(form.get("from")),
          input: String(form.get("text")),
        });
        await send({ to: String(form.get("from")), text: outcome.text });
        return new Response("ok");
      },
    },
  ],
});
```

A USSD gateway is the same with `ussdChannel`: pass `newSession` on a fresh
dial, the gateway's session id as `gatewaySessionId`, and every input so far
as `inputs`, then answer with `outcome.text`, ending the session when
`outcome.end` is true. The Africa's Talking packages
([`packages/ussd`](../packages/ussd/src/index.ts),
[`packages/sms`](../packages/sms/src/index.ts)) are complete examples. If you
build one, a pull request is welcome.

### WhatsApp

Designed, not built: see the [WhatsApp design](whatsapp-design.md).

## Payment providers

Experimental: payments have only run against a fake provider, and there is no
real provider package yet. See the [payments design](payments-design.md).
