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

## Guides

- [Run on the Africa's Talking sandbox](sandbox-guide.md): the real gateway,
  with their phone simulator.
- [Translate Kalangu](translating.md): a new language for the fixed strings,
  checked for USSD and SMS.
- [Release the packages](../RELEASING.md): for maintainers.

## Design

Kalangu is designed in the open, and the design documents explain why it
works the way it does, including what has not been verified yet.

- [Core design](design.md): turns, the budgeter, deferral, adapters.
- [Payments](payments-design.md): experimental, against a fake provider.
- [Languages](languages-design.md): the language menu, detection, models.
- [WhatsApp](whatsapp-design.md): designed, not built.
- [Text normalization](normalization-design.md): African languages on
  keypads and USSD.
- [Prior art](prior-art.md): what else exists.

## Project

- [Contributing](../CONTRIBUTING.md)
- [Roadmap and to-do](../TODO.md)
- [Changelog](../CHANGELOG.md)
- [Source on GitHub](https://github.com/utachicodes/kalangu)
