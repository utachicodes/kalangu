# @kalangu/sim

A simulated keypad phone for [Kalangu](https://github.com/utachicodes/kalangu)
agents: dial codes, read USSD screens, answer, and receive SMS, in your
terminal or in tests. No gateway account, no network.

> Alpha. The API may change before 1.0.

```sh
pnpm add -D @kalangu/sim
```

In a terminal:

```ts
import { runTerminal } from "@kalangu/sim";

await runTerminal(agent, { code: "*384*1#", sender: "CLINIC" });
// Dial> *384*1#   x hangs up · sms <text> texts the agent · q quits
```

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
channel is never called.

MIT licensed.
