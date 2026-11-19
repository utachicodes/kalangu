# Security policy

Kalangu handles phone numbers, conversations and, experimentally, payments.
If you find a way to break that, please tell us privately first.

## Reporting a vulnerability

Use GitHub's private reporting: on the repository, open the **Security** tab
and choose **Report a vulnerability**. Only the maintainers see the report.

Please **do not** open a public issue, pull request or discussion for a
security problem, and do not include real people's phone numbers or any
API key in a report; a made-up number such as `+254700000001` is enough.

Include what you can of:

- the package and version (`npm ls @kalangu/core`), and your Node version;
- what an attacker can do, and what they need first (for example, knowing a
  callback URL);
- the smallest steps or code that show it.

## What to expect

- An acknowledgement within **5 working days**.
- An assessment, and a fix or a plan, within **30 days**. Kalangu is a
  small project; if it will take longer, we will say so and why.
- A security advisory and a release with the fix, crediting you unless you
  would rather not be named.

## Supported versions

Kalangu is in alpha. Only the **latest published version** gets fixes:
upgrade to it before reporting, and check the [changelog](CHANGELOG.md) in
case it is already fixed.

## What is in scope

Anything in this repository, in particular:

- the engine (`@kalangu/core`): sessions, turns, and the saves that keep a
  payment or a deferred answer from being lost or applied twice;
- payments: anything that could charge twice, charge the wrong amount, or
  report a payment that did not happen;
- the gateway adapters (`@kalangu/ussd`, `@kalangu/sms`): parsing callbacks
  and sending messages;
- phone numbers or keys reaching logs, URLs or third parties.

## Known limits, not vulnerabilities

These are documented; reports that only restate them will be closed, though
ideas to improve them are welcome as ordinary issues:

- **Gateway callbacks are not signed.** Africa's Talking does not sign USSD
  or SMS callbacks, so anyone who knows a callback URL can call it. Use a
  secret path segment and, where you can, allow only the gateway's addresses
  (which its support shares on request); see
  [Agents](docs/agents.md#channels).
- **Payments are experimental** and have only run against a fake provider;
  the [payments design](docs/payments-design.md) §9 lists what is not
  guaranteed.
- **The in-memory stores** lose everything on restart and are for tests and
  the simulator only.
