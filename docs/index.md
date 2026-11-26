# Kalangu documentation

Kalangu is an open-source TypeScript toolkit for AI agents that work on any
phone, keypad phones included, over USSD and SMS. Packages are published on
npm as alpha releases: the API may change before 1.0.

## Start here

- [Quick start](quick-start.md): from nothing to an agent you can talk to in
  a few minutes, with no account and no API key.
- [Agents](agents.md): steps, handlers, sessions, slow answers, languages,
  payments, channels, testing, and what to set before production.
- [Providers](providers.md): plug in a model (Ollama, Claude, Gemini, any
  API in OpenAI's format) and gateways, several at once.

## See it working: Ndiédieng

[kalangu.utachi.website/ndiedieng](https://kalangu.utachi.website/ndiedieng/)
is a complete example built with Kalangu, for the commune of Ndiédieng
(Kaolack, Senegal). A village chief dials `*123#` on a simulated phone (a
keypad phone, an Android or an iPhone) to report a broken borehole, a birth
or a death, or sends an SMS or a voice message. The town hall sees the
reports on a dashboard, edits and closes them, and the chief is told by SMS.
An assistant answers the town hall's questions by voice, and shows the data
behind each answer. Everything runs in your browser on fictitious data: no
account, no install. The code is in
[`examples/ndiedieng`](https://github.com/utachicodes/kalangu/tree/main/examples/ndiedieng).

## Guides

- [Run on the Africa's Talking sandbox](sandbox-guide.md): the real gateway,
  with their phone simulator.
- [Translate Kalangu](translating.md): a new language for the fixed strings,
  checked for USSD and SMS.
- [Measure a language detector](measuring-a-detector.md): accuracy on short
  text, and the threshold to use, from your own samples.
- [Release the packages](../RELEASING.md): for maintainers.

## Design

Kalangu is designed in the open, and the design documents explain why it
works the way it does, including what has not been verified yet.

- [Core design](design.md): turns, the budgeter, deferral, adapters.
- [Payments](payments-design.md): experimental, against a fake provider.
- [Languages](languages-design.md): the language menu, detection, models.
- [WhatsApp](whatsapp-design.md): designed, not built.
- [First message](first-message-design.md): taking a conversation's first
  SMS as input; draft for review.
- [Text normalization](normalization-design.md): African languages on
  keypads and USSD.
- [Prior art](prior-art.md): what else exists.

## Project

- [Contributing](../CONTRIBUTING.md)
- [Roadmap and to-do](../TODO.md)
- [Changelog](../CHANGELOG.md)
- [Source on GitHub](https://github.com/utachicodes/kalangu)
