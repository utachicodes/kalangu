# Agents

An agent is a tree of steps that Kalangu shows to a user one screen at a
time, over USSD or SMS, remembering where each phone number is. This page
covers everything you configure. For a first agent, start with the
[quick start](quick-start.md).

```js
import { createAgent } from "@kalangu/core";

const agent = createAgent({ start, channels, model });
```

## Steps

A step is data: what to show and where an answer goes. Text can be a string,
or `{ en: "...", fr: "..." }` for each language.

| Step | Shows | The answer goes to |
|---|---|---|
| `say(text)` | A final message; the conversation ends | |
| `menu(title, { label: target })` | Numbered options (`choose` is the same) | The chosen option's target |
| `ask(question, handler, { input: "text" \| "number" })` | A question to type an answer to | `handler(answer, ctx)` |
| `confirm(question, { onYes, onNo, yes?, no? })` | A yes/no question | `onYes` or `onNo` |
| `languageMenu(options?)` | The languages, each named in itself | Sets the language, then `then` or back up |
| `pay(spec, { onPaid, onFailed, onDeclined })` | A payment to confirm (experimental, see below) | The payment's outcome |

A target is either another step or a handler. Menus can also take
`[{ label, to }]` when labels need translations.

```js
import { ask, confirm, menu, say } from "@kalangu/core";

const start = menu({ en: "Clinic line", fr: "Ligne de la clinique" }, {
  "Opening hours": say("Open Monday to Saturday, 8:00 to 18:00."),
  "Ask a nurse": ask("Type your question", (q, ctx) => ctx.model.answer(q)),
  "Book a visit": confirm("Book for Monday?", {
    onYes: say("Booked for Monday."),
    onNo: () => "No booking made.",
  }),
});
```

A user can always answer with the number, or by typing the option's label.
Typed labels are matched ignoring accents, case, spacing and apostrophe
style, so whatever a USSD screen showed can be typed back.

## Handlers

A handler is `(input, ctx) => reply`, and may be async. Its reply decides
what happens next:

| Reply | Result |
|---|---|
| A string, or a `say` turn | Shown as a final message |
| A step | Shown next. It must be in the tree, or listed in `createAgent({ steps })` |
| Nothing | Back to the menu above |

`ctx` gives the handler:

| Field | What it is |
|---|---|
| `ctx.input` | This turn's input |
| `ctx.phone` | The user's phone number. Personal data: don't log it unmasked |
| `ctx.channel`, `ctx.channelKind` | Which channel, and whether it is `"ussd"` or `"sms"` |
| `ctx.session` | This phone number's state, saved for you. Must stay JSON-safe |
| `ctx.locale` | The user's language. Setting it switches language for good |
| `ctx.t(key, vars)` | Kalangu's own fixed strings, in the user's language |
| `ctx.model` | Your model: `model`, or the entry for the user's language from `models` |
| `ctx.logger` | The agent's logger |

## The first SMS

An SMS that starts a conversation (nothing is waiting for an answer) shows the
agent's start, whatever it says. An agent that takes free-text reports can
read it instead with `onMessage`:

```js
createAgent({
  start,
  onMessage: async (text, ctx) => {
    if (text.length < 15) return;            // "hi", "menu": the start, as before
    const report = await saveReport(ctx.phone, text);
    return `Report ${report.code} received. Thank you.`;
  },
  // ...
});
```

Its reply works like any handler's: a string ends the conversation, a step is
shown next, and nothing shows the start. It is never called on USSD, for an
SMS that answers a waiting question, or while a deferred answer is on its way.
For a number that has not chosen a language, the message waits through the
language menu and runs in the language chosen. The
[first-message design](first-message-design.md) has the details.

## How screens are made

- **USSD:** each screen fits 160 characters (`maxScreenChars` on the
  channel; Airtel Kenya allows 184). Longer text is split across screens with
  a `98. More` option, never cut. Screens are plain ASCII, because
  operators cannot show anything else: accents are dropped (`é` becomes
  `e`), letters such as `ŋ` become `ng`, and other characters are removed
  with a warning in the log.
- **SMS:** options are numbered the same way. A reply may take up to 4
  segments (`maxSegments` on the SMS channel); a longer one is an error you
  see, never a silently cut message. One character outside the GSM-7
  alphabet makes the whole message UCS-2, 70 characters per segment instead
  of 160.

## Slow answers

On USSD the gateway waits only about 10 seconds for a reply. A turn gets
`deadlineMs` (default 4000, at most 10000), shared by everything it waits for:
the handler, a payment's checks, and any further handlers a dial string runs
(language detection adds its own timeout on top). If it runs out, the user sees
"We are working on your question. You will receive an SMS shortly.", the
session ends, and the answer is sent by SMS when it is ready. This needs an
SMS channel that can send. Menus and other fixed steps never wait.

The late work runs after the response is sent. On a server that keeps
running, that just works. On platforms that freeze the process after a
response, pass something that keeps it alive, or the late answers are never
sent:

```js
createAgent({
  // Cloudflare Workers, for example:
  background: { run: (task) => ctx.waitUntil(task()) },
  // ...
});
```

## Sessions

Sessions are keyed by phone number, not by the gateway's session id, so a
dropped USSD call resumes where it was if the user dials again within
`resumeWindowMs` (default 5 minutes); after that they start at the top, with
their data and language kept.

The default store is in memory and is lost on restart. In production pass a
durable `sessionStore`:

```ts
interface SessionStore {
  load(phone: string): Promise<SessionRecord | null>;
  save(record: SessionRecord, options?: { ifVersion?: number }): Promise<void>;
  clear(phone: string): Promise<void>;
  readonly atomic?: boolean;
}
```

`save` bumps `record.version`. With `ifVersion` it must save only if the
stored version is still that one (a compare-and-set) and otherwise throw
`SessionConflictError`. Agents that take payments require a store that does
this atomically and says so with `atomic: true`.

To test a store you write, run the contract against it. `makeStore` must
return a fresh, empty store each time:

```js
import { checkSessionStore } from "@kalangu/core";

const problems = await checkSessionStore(() => myStore());
// [] when the store keeps the contract; otherwise { check, problem } for each failure
```

It checks loading, saving and clearing, that each save bumps the version,
that a stale `ifVersion` throws `SessionConflictError` and changes nothing,
that data comes back intact, and, for a store that says it is atomic, that
exactly one of several simultaneous saves wins.

For a working example, the clinic example's
[`sqliteStore.ts`](../examples/clinic/src/sqliteStore.ts) is a durable,
atomic store on Node's built-in SQLite (Node 22.13 or later), about seventy
lines, that passes the check. Each versioned save is a single
`UPDATE … WHERE version = ?`, the pattern to copy for any SQL database.

## Languages

```js
createAgent({
  languages: {
    supported: [
      { code: "fr", name: "Français" },
      { code: "wo", name: "Wolof" },
      { code: "en", name: "English" },
    ],
  },
  messages: { wo: { /* Kalangu's fixed strings in Wolof */ } },
  // ...
});
```

- On first contact the user picks a language, and it is remembered for
  their phone number on every channel. The menu names each language in
  itself and lists the likely ones for the caller's country first (a prior,
  never a guess; every language is always listed).
- Each language needs messages: `en` and `fr` ship, others go in `messages`.
  Missing ones fall back to the default language, then English. Check a
  translation with `npx kalangu locale check wo.json`; see the
  [translation guide](translating.md).
- `languageMenu()` is the same menu for a "Language" entry in your tree.
- **A model per language:** `models: { default: multilingual, wo: wolofModel }`
  instead of `model`. `ctx.model` is the entry for the user's language, or
  `default`.
- **Detection, as a hint:** `languages.detection: { detector, threshold,
  minChars }` takes a detector you supply. When a typed answer looks like
  another of your languages, the user is asked, in that language, whether to
  continue in it, and their answer is held until they reply. The SMS that
  starts a conversation is checked too: a new number sees its language
  first in the language menu, and a known one is offered the switch. To
  choose `threshold` and `minChars`, [measure the
  detector](measuring-a-detector.md) on your own samples. It never
  switches silently, offers at most once per conversation, never sees number
  answers, and has no default threshold until one is measured. Kalangu
  ships no detector.

## Payments (experimental)

Payments have only been run against a fake provider. There is no real
provider package yet, so do not use them with real money. In outline:

- A `pay` step shows "Pay 500 KES to CLINIC for Consultation?" only after a
  policy check and an operator lookup, ends the USSD session, and starts the
  payment in the background. The outcome and a receipt arrive by SMS.
- `createAgent({ payments: { provider, store, payeeName, policy } })`. The
  policy is mandatory: allowed currencies and a limit per payment.
- Call `agent.payments.reconcile()` from a scheduled job, about every 5
  minutes, so payments finish even after a restart.
- A durable payment store must make three operations atomic; test yours
  with `checkPaymentStore(() => myPaymentStore())`, which returns the
  problems found, as `checkSessionStore` does for sessions.

The full design, and what it does not guarantee, is in the
[payments design](payments-design.md).

## Channels

```js
import { africasTalkingUssd } from "@kalangu/ussd";
import { africasTalkingSms } from "@kalangu/sms";

africasTalkingUssd({ code: "*384*1#", path: "/ussd" });
africasTalkingSms({ username, apiKey, senderId, sandbox, path: "/sms" });
```

Each channel adds its callback routes, and `agent.requestHandler` dispatches
requests to them by path: a standard `Request` to `Response` function.

**Callbacks are not signed** by Africa's Talking, so anyone who knows a
callback URL can call it. Two mitigations, both outside Kalangu's routes:

- **A secret path segment.** Give the channels paths such as
  `/3f9a1c0e7b2d4a6f/ussd`: the URL is then the secret. Use at least 16
  random characters (`openssl rand -hex 16`), never log it, and change it if
  it leaks.
- **Only the gateway's addresses.** Africa's Talking does not publish the
  addresses its callbacks come from (checked 19 Nov 2026); its support shares
  them on request. Check the address before the agent sees the request:

  ```js
  const allowed = new Set(["<address from support>"]);
  const handler = (req) => {
    // Only behind a proxy you control that sets X-Forwarded-For; otherwise it can be forged.
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    return allowed.has(ip) ? agent.requestHandler(req) : new Response("Forbidden", { status: 403 });
  };
  ```

A user-agent check, which some guides suggest, is trivially faked. The
clinic example does both (`CALLBACK_SECRET`, `ALLOWED_IPS`); see its
[`callbackGuard.ts`](../examples/clinic/src/callbackGuard.ts).

## Testing

`@kalangu/sim` replaces the agent's channels with a simulated phone, so
nothing real is called:

```js
import { createPhone } from "@kalangu/sim";

const phone = createPhone(agent, { code: "*384*1#" });
await phone.dial("*384*1#");     // { text: "Clinic line\n1. ...", end: false }
await phone.press("1");
phone.hangUp();                  // dial again to resume
phone.onSms((sms) => console.log(sms.text));
```

`runTerminal(agent, { code })` gives you the same phone in a terminal.

## Before production

- A durable `sessionStore` (atomic, if you take payments).
- An SMS channel that can send, for answers that miss the deadline.
- A `background` that keeps the process alive, on serverless platforms.
- Hard-to-guess callback paths, and the gateway's IP addresses only.
- Phone numbers are masked in logs by default (`logPhoneNumbers: false`);
  keep it that way.
- For payments: the scheduled `reconcile()`, and not before a real provider
  exists.
