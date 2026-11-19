# @kalangu/ussd

Africa's Talking USSD adapter for [Kalangu](https://github.com/utachicodes/kalangu)
agents.

> Alpha. The API may change before 1.0.

```sh
npm install @kalangu/core @kalangu/ussd
```

```ts
import { createAgent } from "@kalangu/core";
import { africasTalkingUssd } from "@kalangu/ussd";

const agent = createAgent({
  start,
  channels: [africasTalkingUssd({ code: "*384*1#", path: "/ussd" })],
});

// Mount agent.requestHandler (standard Request -> Response) at your callback URL.
```

- Parses the gateway's form callback and always answers `200 text/plain`
  with `CON `/`END `, including on errors, so the user's session is never
  dropped by a malformed reply.
- Dial strings with choices (`*384*1*2#`) are replayed from the start menu.
- Options: `maxScreenChars` (default 160; Airtel Kenya allows 184), `more`
  (default `98`), `unsafeChars` (`"strip"` or `"throw"`), `hopMetadata`,
  and a session-end notification route (`endPath`, default `/ussd/end`).

Callbacks from the gateway are not signed: anyone who knows the URL can
call it. Put the routes under a secret path segment and, where you can,
allow only the gateway's addresses (its support shares them on request):
[how](https://kalangu.utachi.website/docs/agents/#channels). To try the
gateway for free, follow the
[sandbox guide](https://kalangu.utachi.website/docs/guides/sandbox/).

A `*` typed inside free text splits the answer; the gateway gives no way
to tell it apart from a separator. Numeric input is unaffected.

MIT licensed.
