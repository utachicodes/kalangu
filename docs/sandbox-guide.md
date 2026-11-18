# Running Kalangu on the Africa's Talking sandbox

A step-by-step guide to running the clinic example against Africa's Talking's
real gateway, in their free sandbox, with their phone simulator instead of a
handset.

Written 18 Nov 2026 from Africa's Talking's help article *How do I get started
on the Africa's Talking sandbox?*, the gateway facts in
[design.md](design.md) §2, and the example's own code. **Nobody has run it end
to end yet**: the first run is the test of this guide too, so note anything
that differs and fix the guide.

---

## What this proves, and what it does not

**Proves:** Kalangu works with Africa's Talking's real gateway: the request
fields, the `CON`/`END` replies, sending an SMS through their API, receiving
an incoming SMS, delivery reports, and the "we'll text you" deferral from
USSD to SMS end to end.

**Does not prove:** anything about real mobile operators. The sandbox is
Africa's Talking's test environment. The questions the project depends on
most (the real session timeout and screen length, whether operators
intercept `98`, whether a USSD session and an SMS to the same number work
together) still need a real short code on real networks. See the
verify-first checklist in [TODO.md](../TODO.md).

---

## What you need

- Node 20 or later and pnpm (the same as for `pnpm demo`).
- A free Africa's Talking account.
- A way to give your machine a public HTTPS address, such as ngrok or
  Cloudflare Tunnel. Africa's Talking cannot reach `localhost`.

---

## 1. Sign up for the sandbox

Go to <https://account.africastalking.com/apps/sandbox> and sign up. The
sandbox is free.

## 2. Get the sandbox API key

In the sandbox app's settings, generate an API key. (The help article does not
describe this screen; the label may differ.) The sandbox username is
`sandbox`, which the example and the official SDK both use.

**Keep the key out of everything but your shell.** Do not paste it into a
chat, an issue, a commit or a file in this repository. To keep it out of your
shell history too:

```sh
read -s AT_API_KEY && export AT_API_KEY   # type or paste the key; nothing is shown
```

## 3. Build

From the repository root:

```sh
pnpm install
pnpm build
```

## 4. Start the example server

```sh
AT_USERNAME=sandbox AT_SANDBOX=1 PORT=3000 \
  pnpm --filter @kalangu/example-clinic start
```

It prints `Clinic agent listening on http://localhost:3000 (sandbox)`. It
serves:

| Path | For |
|---|---|
| `/ussd` | USSD callbacks |
| `/ussd/end` | USSD session-end notifications (optional) |
| `/sms` | incoming SMS |
| `/sms/delivery` | SMS delivery reports |

`AT_SANDBOX=1` makes the SMS adapter use `api.sandbox.africastalking.com`.
Leave `AT_SENDER_ID` unset in the sandbox unless you create a short code for
it (step 7).

## 5. Expose it

Start a tunnel to port 3000 and note the HTTPS address it gives you, for
example `https://<something>.ngrok-free.app`. (Commands differ between tools:
for ngrok it is typically `ngrok http 3000`; check your tool's documentation.)
On a free tunnel the address usually changes each time it restarts; when it
does, update the callbacks in steps 6 and 7.

**The tunnel makes your server public.** Africa's Talking does not sign its
callbacks, so anyone who finds the address can call it. Stop the tunnel when
you are done.

## 6. Create a USSD channel

Open <https://account.africastalking.com/apps/sandbox/ussd/channel/create>.

- Pick a service code, for example `*384*1234#`.
- Set the callback URL to `https://<your tunnel>/ussd`.

Then restart the server with the same code, so it does not log "unexpected
service code" warnings (it accepts other codes; it only warns):

```sh
USSD_CODE='*384*1234#' AT_USERNAME=sandbox AT_SANDBOX=1 PORT=3000 \
  pnpm --filter @kalangu/example-clinic start
```

If the dashboard offers a session-end notification URL, point it at
`https://<your tunnel>/ussd/end`. It is optional; the example only logs it.

## 7. Set up SMS

The "we'll text you" path sends the answer by SMS, so SMS matters even for a
USSD test.

- **Incoming messages:** set the callback at
  <https://account.africastalking.com/apps/sandbox/sms/inbox/callback> to
  `https://<your tunnel>/sms`.
- **A short code** (optional, for a sender ID or to receive messages on one):
  <https://account.africastalking.com/apps/sandbox/sms/shortcodes/create>.
  To send from it, restart the server with `AT_SENDER_ID=<your short code>`.
- **Delivery reports:** if the dashboard lets you set a delivery-report
  callback, point it at `https://<your tunnel>/sms/delivery`. The help article
  does not describe where.

## 8. Open the simulator and test

Open <https://simulator.africastalking.com:1517/> and register a phone
number. Africa's Talking's guidance is to use the simulator, not a handset,
for all sandbox testing, and to register numbers in separate browser sessions
if you want more than one.

Then work through this, noting what actually happens:

| Do | Expect |
|---|---|
| Dial your service code | `Clinic line`, then `1. Opening hours`, `2. Ask a nurse`, `3. Language` |
| `1` | `Open Monday to Saturday, 8:00 to 18:00.` and the session ends |
| Dial again, `2`, type a question | After about 4 seconds: `We are working on your question. You will receive an SMS shortly.` and the session ends |
| Wait a few more seconds | An SMS to the simulator's number with the nurse's answer. The example's fake nurse takes 6 seconds and the deadline is 4, so this is the deferral path |
| Dial again, `3`, then `2` | French: the menu comes back as `Ligne de la clinique` (accents shown as plain letters on USSD) |
| Dial again, `3`, type `francais` | French again: a typed name works without its accent |
| Send an SMS from the simulator to your short code (if you set up step 7) | A reply SMS with the menu, numbered |

**Also look at:**

- **The server's console:** one line per turn; phone numbers are masked.
- **The dashboard:** the USSD session logs and the SMS inbox and outbox. Did
  the deferred answer show as sent, and did a delivery report arrive?
- **Timing:** how long from the deferral screen to the SMS arriving.

## 9. Report back

What would be most useful to record, in an issue or a note:

1. Which steps worked as written and which did not (and what the screens
   actually said). This guide should be corrected from it.
2. Whether the deferred answer arrived by SMS, and how long it took.
3. Any request the server rejected or logged a warning for.
4. The exact USSD request fields the gateway sent, from the server log or
   the dashboard, compared with [design.md](design.md) §2.1.

Do not include the API key, and mask phone numbers if they are real.

---

## Troubleshooting

- **`Set AT_USERNAME to run the server`:** an environment variable is
  missing; see steps 2 and 4.
- **The simulator shows an error or nothing:** check that the tunnel is
  running, that the callback URL ends in `/ussd`, and that the tunnel address
  has not changed since you set it.
- **No SMS arrives:** check that `AT_SANDBOX=1` is set (otherwise the adapter
  calls the live API with sandbox credentials), and the dashboard's SMS
  outbox for an error.
- **"unexpected service code" in the log:** `USSD_CODE` does not match the
  channel's code; see step 6.

---

## After the sandbox

Real operators need a USSD short code per country, usually with business
registration and operator approval, and the costs are still an open item in
[TODO.md](../TODO.md). The sandbox run makes that step worth taking, by
showing that everything on Kalangu's side works.
