# Prior art: USSD packages and the Chat SDK adapter directory

Survey date: 16 Nov 2026. This document feeds the verify-first checklist item
*"Search npm and the Chat SDK adapter directory for a USSD adapter published
since 16 Nov 2026"*. Bottom line: **nothing on npm or in the Chat SDK adapter
directory combines a USSD/SMS agent engine with typed turns, an encoding-aware
budgeter, and model-deferral to SMS.** At the time no `@kalangu/*` package
existed on the registry. (That does not prove an organisation name is free:
an organisation can exist with no packages. The scope has since been
claimed and the packages published; see §6.)

---

## 1. npm: USSD-related packages

| Package | Version | License | Weekly downloads | What it is | Gap vs. `@kalangu/*` |
|---|---|---|---|---|---|
| `africastalking` | 0.8.4 | MIT | ~27,636 | Official Africa's Talking Node.js SDK. Covers SMS, USSD, voice, payments, airtime. Low-level API wrapper; you write the session logic yourself. | No engine, no typed turns, no budgeter, no deferral, no AI model port. |
| `ussd-builder` | 1.3.2 | MIT | ~11,495 | State-based USSD menu composer (`con`/`end`, regex input matching, Express handler). Claims compatibility with Africastalking, Hubtel, Emergent, Arkesel, Nalo, Beem. | No session store, no AI, no SMS channel, no deferral, no encoding budgeter. Last updated 2024-05. |
| `ussd-at` | unknown | unknown | unknown | Same state-machine menu-builder pattern as `ussd-builder`, Africastalking callback shape. | Same gaps. |
| `ussd-menu-builder` | 1.2.0 | MIT | ~1,348 | State-based menus, Africastalking-compatible. Last updated ~2020. | Same gaps; effectively unmaintained. |
| `africastalking-ts` | 0.0.3 | MIT | ~1,191 | Unofficial TypeScript port of the Africa's Talking SDK. | Same gaps; last updated ~2021. |
| `@stead/at-js` | 0.0.14 | MIT | ~24 | Customized Africa's Talking wrapper. | Same gaps. |
| `@goonerlabs/ussd-router` | unknown | unknown | unknown | Tiny dependency-free state-machine router for Africastalking USSD; replays the `*`-joined input trail, `CON`/`END` replies, no session store by design. | No engine, no SMS, no deferral, no budgeter. |
| `ussd-state-builder` | 2.6.0 | MIT | ~398 | State machine with back navigation, lifecycle hooks, middleware, validation, i18n, testing utilities, multiple storage adapters. | Menu builder, not an agent; no SMS channel, no deferral, no budgeter. Updated 17 days before the survey. |
| `ananse` | 1.12.0 | MIT | ~283 | TypeScript USSD framework: session management, menu routing, validation, pagination, CLI simulator, pluggable gateways (wigal, hubtel, africas_talking). | Built around USSD menus and session storage; no AI model port, no typed turns, no SMS deferral, no GSM-7/UCS-2 budgeter. |

None of these publish under `@kalangu`, and none render AI-generated answers as budgeted keypad screens or fall back to SMS when a model exceeds the gateway's response bound.

---

## 2. Chat SDK adapter directory (chat-sdk.dev/adapters)

The directory lists three classes of adapters:

- **Official** (Vercel, `@chat-adapter/*`): Slack, Teams, Google Chat, Gmail, Discord, GitHub, GitLab, Linear, Notion, Telegram, WhatsApp, web chat, plus state adapters (Redis, ioredis, PostgreSQL, memory).
- **Vendor-official**: Resend (email), Sendblue (iMessage/SMS/RCS), Linq (iMessage/SMS), AgentPhone (SMS/MMS/iMessage/voice), Liveblocks, Lark/Feishu, Telnyx (SMS/MMS).
- **Community**: signal-cli, Rocket.Chat, Zoom Team Chat, and others.

The catalog is exposed statically via `@chat-adapter/catalog` (`listAdapters()`, `getFeatureSupport()`). **There is no USSD adapter** in any class: official, vendor-official, or community. SMS is covered (Twilio, Sendblue, AgentPhone, Linq), but no keypad/USSD channel exists in the directory.

---

## 3. Closest concept in spirit

`ussd-platform` on the Hermes Marketplace is a Hermes plugin, not an npm package and not a Chat SDK adapter. It speaks the Africa's Talking USSD callback format (`sessionId`, `phoneNumber`, `serviceCode`, `text`; `CON`/`END` replies), pages agent output to 160-character screens with a `98.More` control, defers slow answers to an inbox or SMS ("Text me the answer"), resumes dropped calls on redial, and ships a localhost-only keypad simulator. It authenticates callbacks with a path-secret because USSD gateways do not sign requests.

Differences from Kalangu: it is a Hermes plugin (Python `adapter.py`), not a TypeScript library; it has no typed turn system (`say`/`choose`/`ask`/`confirm`/`pay`), no per-channel renderers, no encoding-aware segment budget, and no model-deferral deadline with SMS fallback built around a 10 s gateway bound.

---

## 4. What this means for Kalangu

- **Name:** no `@kalangu/*` package existed on 16 Nov 2026. The scope was claimed and `0.1.0-alpha.0` published on 17 Nov 2026.
- **Positioning:** existing npm USSD tools are menu builders or low-level gateway wrappers. Kalangu's distinct combination is: AI agent with typed turns, encoding-aware budgeter (GSM-7/UCS-2), phone-number-keyed sessions, and deferral to SMS when a model turn misses the gateway deadline. None of the packages above do that.
- **Chat SDK:** no USSD adapter exists in the directory, so a future `@kalangu` adapter would be filling a genuine gap rather than duplicating one (see the v0.4 WhatsApp/channel survey item in TODO.md).

---

## 5. Verify-first status

| Checklist item | Status |
|---|---|
| Search npm and the Chat SDK adapter directory for a USSD adapter published since 16 Nov 2026 | Done: none found; documented here. Refreshed 17 Nov 2026 (§6): still none |

---

## 6. Refresh, 17 Nov 2026

Rerun of the checklist item, plus two packages the first survey missed.

**How.** npm's public search API (`registry.npmjs.org/-/v1/search`) for
`ussd`, `ussd agent`, `ussd ai`, `ussd llm` and `keywords:ussd` (394 unique
packages, of which 124 mention USSD), filtered by publish date. For the
Chat SDK directory, whose website did not answer a script, the package it is
built from, `@chat-adapter/catalog`, read as text from its published tarball
(not installed or run).

**Published or updated since 16 Nov 2026 and mentioning USSD:** only
`@kalangu/core`, `@kalangu/ussd` and `@kalangu/sim` themselves, and
`opscms-paystack-plugin` (Paystack card, bank-transfer and USSD *payments*
for a CMS; not a USSD app toolkit).

**Chat SDK directory:** `@chat-adapter/catalog` 4.45.0 was last published on
13 Nov 2026, before the first survey, so the directory cannot have gained an
adapter since. Its files contain no mention of USSD, Africa's Talking,
keypad or feature phones (the same search finds WhatsApp 66 times and
Telegram 52 times, so the search itself works).

**Missed by the first survey, and worth knowing:**

| Package | Version, date | What it is | Versus Kalangu |
|---|---|---|---|
| `@omoyolab/ussdkit` | 0.3.0, 4 Oct 2026, MIT | Build USSD apps in Node: declarative screens, session handling, gateway adapters (Africa's Talking among its keywords), a terminal phone simulator and a test helper, zero dependencies. Its README covers screen room (`ctx.room`, warnings past `maxLength`), pagination, and warnings about reply time. | **The closest prior art**: much of Kalangu v0.1's surface (sessions, simulator, screen budget, zero dependencies). Its README never mentions a model, SMS deferral, SMS encoding (GSM-7/UCS-2) or languages. |
| `baselineos` | 1.7.1, 8 Aug 2026, Apache-2.0 | Its description pitches AI that runs offline, over USSD and on low bandwidth. | Its README never mentions USSD or SMS; it describes a general AI operations runtime with an Anthropic SDK dependency. Not a USSD toolkit as far as its published docs show. |

**Conclusion unchanged, with one caveat.** Still nothing combines a model
with typed turns, deferral to SMS within the gateway bound, and an
encoding-aware SMS budget. But "existing tools are menu builders" undersells
`ussdkit`: it is a careful, modern USSD framework, and Kalangu's claim to
difference rests on the agent side (deferral, the SMS budget, payments,
languages), not on menus, sessions or the simulator.

Repeat this check right before announcing; it is a snapshot.
