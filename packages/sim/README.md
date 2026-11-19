# @kalangu/sim

A simulated keypad phone for [Kalangu](https://github.com/utachicodes/kalangu)
agents: dial codes, read USSD screens, answer, and receive SMS, in your
terminal or in tests. No gateway account, no network.

> Alpha. The API may change before 1.0.

```sh
npm install --save-dev @kalangu/sim
```

In a terminal:

```ts
import { runTerminal } from "@kalangu/sim";

await runTerminal(agent, { code: "*384*1#", sender: "CLINIC" });
// Dial> *384*1#   x hangs up · sms <text> texts the agent · q quits
```

At `Dial>`, what you type is dialled, as on a real phone; replies to an SMS
start with `sms`, for example `sms 1`. Each incoming SMS shows what it costs:

```
✉ SMS from CLINIC (2 segments, UCS-2 because of ë): ...
```

One character outside the GSM-7 alphabet, such as Wolof `ë` or Hausa `ɓ`,
makes the whole message UCS-2: 70 characters per segment instead of 160.

In tests:

```ts
import { createPhone } from "@kalangu/sim";

const phone = createPhone(agent, { code: "*384*1#" });
await phone.dial("*384*1#");          // { text: "Clinic line\n1. ...", end: false }
await phone.press("1");
phone.hangUp();                        // dial again to resume
phone.onSms((sms) => console.log(sms.text));
```

The simulator replaces the agent's channels with its own, so a real SMS
channel is never called. `input` and `output` take any streams with
`process.stdin`'s and `process.stdout`'s shape; the types do not need
`@types/node`.

Try it in one paste: the [quick start](https://kalangu.utachi.website/docs/quick-start/).

MIT licensed.
