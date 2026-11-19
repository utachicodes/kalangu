# @kalangu/sms

Africa's Talking SMS adapter for [Kalangu](https://github.com/utachicodes/kalangu)
agents: sends replies and deferred answers, receives incoming messages, and
logs delivery reports.

> Alpha. The API may change before 1.0.

```sh
npm install @kalangu/core @kalangu/sms
```

```ts
import { createAgent } from "@kalangu/core";
import { africasTalkingSms } from "@kalangu/sms";

const agent = createAgent({
  start,
  channels: [
    africasTalkingSms({
      username: process.env.AT_USERNAME,
      apiKey: process.env.AT_API_KEY,
      senderId: "CLINIC",
      sandbox: false,
      path: "/sms",                    // incoming messages
      deliveryPath: "/sms/delivery",   // delivery reports
    }),
  ],
});
```

- Sends through the legacy `/version1/messaging` endpoint (the one the
  official SDK and the sandbox use). Swap in another `transport` to use a
  different endpoint.
- A refused send raises `SmsSendError` with the gateway's own `statusCode`
  and `status`, for example `409 DoNotDisturbRejection` in Nigeria.
- Messages over the segment cap (`maxSegments`, default 4) are an error,
  never truncated, for replies and for direct `send` calls alike.
- "Success" in a send response means sent, not delivered; delivery reports
  say what actually happened.

Callbacks from the gateway are not signed: anyone who knows the URL can
call it. Put the routes under a secret path segment and, where you can,
allow only the gateway's addresses (its support shares them on request):
[how](https://kalangu.utachi.website/docs/agents/#channels).

MIT licensed.
