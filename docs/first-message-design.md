# Kalangu: taking a conversation's first SMS as input

Status: **draft for review. No code until it is reviewed.**
Date: 2026-11-24. Scope: SMS (and, later, WhatsApp text) only. USSD, payments
and language detection are unchanged except where §5 says.

---

## 1. The problem

An SMS that starts a conversation is never read as input. Whatever it says,
the agent answers with its start: the language menu for a number that has not
chosen a language, the start step for one that has. The text is used only as
a hint for language detection (languages design §9.5).

That suits an agent built as a menu, where the first SMS is "hi". It does not
suit one that takes free-text reports. In the Ndiédieng example a village
chief who texts "the borehole is broken" gets the menu back, answers `5`
("write a message"), and has to send the report again: three SMS, and the
first one, which already said everything, is thrown away. On a basic phone,
each SMS is typing, a cost, and a chance to give up.

## 2. What the code does today

Read from `packages/core/src/agent.ts` on 24 Nov 2026.

- **What counts as a conversation-starting SMS:** an SMS that arrives when
  nothing is waiting for an answer: no turn on screen, or a final `say`. A
  waiting question also lapses after `resumeWindowMs` (default 5 minutes)
  without activity, so an SMS after that starts a conversation too.
- **What happens to it** (`startFromMessage`): a number without a language
  gets the language menu, with the language its message looks like listed
  first if a detector is configured. A number with a language gets the start
  step, or first a "Continue in {language}?" offer if a detector places the
  text in another of the agent's languages. In every case **the text answers
  nothing.**
- **An SMS while a question is waiting** is that question's answer: a menu
  number or label, an `ask` answer, a Yes or No. Free text sent to a waiting
  menu is an invalid choice.
- **USSD** never has this problem: its first input is the dial, and a dial
  string (`*123*1*4#`) already carries choices, which are replayed.

So the language menu is not the cause; it adds one screen before the same
behaviour every number already gets.

## 3. Options

| Option | How | Verdict |
|---|---|---|
| **A. An `ask` start step answers itself** | If the start step is an `ask`, a conversation-starting SMS is its answer | Breaks every agent whose start is an `ask` and whose users open with "hi". Implicit: a developer could not see from the tree that SMS behaves differently from USSD. Rejected |
| **B. An `onMessage` handler** | `createAgent({ onMessage })` is called with the text of a conversation-starting SMS; its reply decides what follows, and "nothing" means the start, as today | Opt-in, backwards compatible, and the developer decides what a first message means (a report, a keyword, a greeting). **Recommended** |
| **C. A separate SMS start step** | `createAgent({ start, smsStart })` | Only moves the problem: a step still cannot see the text that started it |

## 4. Proposal: `onMessage`

```ts
createAgent({
  start,
  onMessage: async (text, ctx) => {
    // A report in one SMS: record it and reply. Anything short ("hi", "menu"):
    // return nothing, and the agent shows its start as today.
    if (text.length < 15) return;
    const report = await recordReport(ctx.phone, text, ctx.locale);
    return `Report received (${report.code}). Thank you.`;
  },
  // ...
});
```

- **Signature:** a `Handler`, `(text, ctx) => Reply`, like any other: the
  trimmed text of the SMS, and the usual `ctx` (`phone`, `session`,
  `locale`, `t`, `model`, `logger`).
- **When it is called:** for a conversation-starting SMS (§2), on an SMS
  channel, and later for a WhatsApp text message. Never on USSD, never for an
  SMS that answers a waiting question, and never while a deferred answer is
  still on its way (that keeps its notice, as today).
- **What its reply does:** the same as any handler's (`docs/agents.md`,
  Handlers): a string or `say` is the reply SMS and ends the conversation; a
  step is shown next, so a handler can ask a follow-up question; **nothing
  shows the start**, exactly as today. An agent that does not set
  `onMessage` behaves exactly as today.
- **Errors:** a handler that throws gets the usual `common.error` reply, and
  the session is left at the start, as for any handler.
- **No deadline:** SMS is not a live channel, so there is nothing to defer;
  the handler may take as long as it needs, as an SMS `ask` handler already
  may.

## 5. With languages

The language menu still comes first for a number that has not chosen, so the
reply can be in its language. The message is **held** and run once the
choice is made, the same mechanism as an answer held during a language
suggestion (languages design §9.5):

```
first SMS "forage bi dafa yàqu" from a new number
  → language menu (Wolof listed first, if a detector says so)   message held
  → "2" (Wolof)                                                  language set
  → onMessage("forage bi dafa yàqu", ctx with locale "wo")       held message used
  → its reply, in Wolof; or the start step if it returns nothing
```

- **Where it is held:** in the session record, like a held answer, with the
  same lifetime: cleared once used, and dropped when the position resets
  after `resumeWindowMs`. A number that never chooses a language never has it
  run.
- **A "Continue in {language}?" offer** on a first message (a number that
  has a language): today the offer holds nothing and either answer starts the
  conversation. With `onMessage`, the message is held instead, and the answer
  runs it in the language chosen.
- **Detection is unchanged:** the message is still only a hint for which
  language to list first or offer. It never chooses.
- Only one message is held. A second SMS before the choice is read as the
  answer to the language menu, as today.

## 6. Ndiédieng, with it

```ts
onMessage: async (text, ctx) => {
  if (text.length < 15 || /^(menu|aide|help)$/i.test(text)) return; // the menu, as today
  const done = await recordFreeText(commune, classifier, ctx.phone, text, "sms", langOf(ctx.locale));
  return done ? done.reply : say(langOf(ctx.locale), "notRegistered");
},
```

A chief's report becomes one SMS and one reply, in their language. "menu" or
a greeting still opens the menu, so nothing a chief does today stops working.

## 7. Testing plan

1. Without `onMessage`: every existing SMS test passes unchanged.
2. A conversation-starting SMS calls `onMessage` with the trimmed text; a
   string reply is sent and ends the conversation; a step is shown; nothing
   shows the start.
3. Not called: on USSD (including a dial string), for an SMS that answers a
   waiting question, during a deferral.
4. A waiting question that lapsed after `resumeWindowMs`: the next SMS calls
   `onMessage`.
5. A new number with `languages`: the message is held through the language
   menu and runs with the chosen locale; a second SMS answers the menu; a
   reset drops the held message.
6. A "Continue in…?" offer on a first message holds it and runs it after Yes
   and after No, each in the right language.
7. A handler that throws: `common.error`, session at the start.
8. Two SMS racing on the same held message run `onMessage` once (the claim
   used for held answers).

## 8. Open questions

Each with a recommendation.

1. **The name:** `onMessage` (recommended: it says when it runs), or
   `firstMessage`, or a `start: { sms: handler }` form?
2. **A number as the first SMS** (`"5"` from someone who knows the menu):
   pass it to `onMessage` like any text (recommended: the developer decides,
   and Ndiédieng's length check already sends it to the menu), or have core
   treat a first SMS that is a valid menu number as a menu choice?
3. **Free text sent to a waiting menu** (inside the resume window): keep it
   an invalid choice (recommended: a waiting question is answered), or route
   text that matches no option to `onMessage` too? The second would make the
   rules depend on what the menu happens to contain.
