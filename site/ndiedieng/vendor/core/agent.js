/**
 * The engine (docs/design.md §4.3): loads the caller's session, reads their
 * input against what they were last shown, runs the matching step or
 * handler, renders the result for the channel, and saves the session.
 *
 * Handlers on a live channel (USSD) run under a deadline (§4.6). If one
 * misses it, the user gets the "we'll text you" screen, the handler keeps
 * running in the background, and its answer arrives by SMS.
 */
import { inProcessBackground } from "./background.js";
import { toUssdSafe } from "./budget/ussd.js";
import { systemClock } from "./clock.js";
import { DEFAULT_DETECTION_TIMEOUT_MS, DEFAULT_LANGUAGE_PRIORS, orderLanguages, } from "./languages.js";
import { createCatalog } from "./locales.js";
import { consoleLogger, maskPhone } from "./logger.js";
import { createPaymentController, } from "./payments/controller.js";
import { interpret } from "./render.js";
import { freshRecord, memoryStore, SessionConflictError } from "./session.js";
import { indexSteps, isStep, languageMenu, } from "./steps.js";
import { assertNever } from "./turns.js";
export const DEFAULT_RESUME_WINDOW_MS = 5 * 60 * 1000;
export const DEFAULT_DEADLINE_MS = 4000;
export const DEADLINE_WARN_MS = 8000;
export const DEADLINE_MAX_MS = 10_000;
/** A deferral older than this is treated as lost (e.g. the process restarted). */
export const DEFERRAL_TTL_MS = 15 * 60 * 1000;
export function createAgent(config) {
    const store = config.sessionStore ?? memoryStore();
    return buildAgent({ ...config, sessionStore: store });
}
function buildAgent(config) {
    const store = config.sessionStore;
    const logger = config.logger ?? consoleLogger();
    const clock = config.clock ?? systemClock;
    const catalog = createCatalog(config.defaultLocale ?? "en", config.messages);
    const languageConfig = checkLanguages(config.languages, catalog);
    // The implicit first-contact menu has a fixed id, "language": a position among the extra
    // steps would change whenever the developer adds or removes one, and a user waiting at
    // the menu would then be sent to another step.
    const languageStep = languageConfig ? languageMenu({ then: config.start }) : undefined;
    const steps = indexSteps(config.start, config.steps ?? [], languageStep ? { language: languageStep } : {});
    for (const step of steps.all()) {
        if (step.type !== "language")
            continue;
        if (step.languages === undefined && !languageConfig) {
            throw new TypeError("A language menu without `languages` needs `createAgent({ languages })` to say which languages");
        }
        if (step.languages !== undefined)
            checkLanguages({ supported: step.languages }, catalog);
    }
    if (!config.payments && steps.all().some((step) => step.type === "pay")) {
        throw new TypeError("This agent has a pay step but no `payments` config (provider, store, payeeName, policy)");
    }
    const resumeWindow = config.resumeWindowMs ?? DEFAULT_RESUME_WINDOW_MS;
    const deadlineMs = checkDeadline(config.deadlineMs ?? DEFAULT_DEADLINE_MS, logger);
    if (languageConfig?.detection && deadlineMs + languageConfig.detection.timeoutMs > DEADLINE_MAX_MS) {
        throw new RangeError(`deadlineMs (${deadlineMs}) plus the language detection timeout (${languageConfig.detection.timeoutMs}) is over ${DEADLINE_MAX_MS} ms, the most a USSD gateway waits; lower one of them`);
    }
    const modelFor = buildModelFor(config, catalog, logger);
    const background = config.background ?? inProcessBackground(logger);
    const mask = (phone) => (config.logPhoneNumbers ? phone : maskPhone(phone));
    const channels = new Map();
    for (const channel of config.channels) {
        if (channels.has(channel.id))
            throw new TypeError(`Two channels share the id ${JSON.stringify(channel.id)}`);
        channels.set(channel.id, channel);
    }
    const routes = new Map();
    for (const channel of config.channels) {
        for (const route of channel.routes ?? []) {
            if (routes.has(route.path))
                throw new TypeError(`Two routes share the path ${JSON.stringify(route.path)}`);
            routes.set(route.path, { channel, route });
        }
    }
    const smsSender = config.channels.find((c) => c.kind === "sms" && c.send);
    if (!smsSender && config.channels.some((c) => c.live)) {
        logger.warn("No SMS channel can send: answers that miss the deadline cannot be delivered");
    }
    const errorText = (locale) => catalog.translator(locale && catalog.has(locale) ? locale : catalog.defaultLocale)("common.error");
    if (config.payments && !store.atomic) {
        throw new TypeError("Payments need a sessionStore whose `save` honours `ifVersion` atomically (set `atomic: true`); otherwise a double-tapped Yes can start two payments");
    }
    const payments = config.payments
        ? createPaymentController(config.payments, { clock, logger, mask, onFinal: (payment) => deliverPayment(payment) })
        : undefined;
    if (config.onMessage !== undefined && typeof config.onMessage !== "function") {
        throw new TypeError("`onMessage` must be a function: (text, ctx) => reply");
    }
    const deps = {
        onMessage: config.onMessage,
        languages: languageConfig,
        languageStep,
        payments,
        catalog,
        steps,
        logger,
        modelFor,
        mask,
        store,
        clock,
        background,
        deadlineMs,
        smsSender,
    };
    /** Sends the outcome of a finished payment by SMS, from the pay step that started it. */
    async function deliverPayment(payment) {
        const sender = smsSender;
        const step = steps.get(payment.stepId);
        if (!sender?.send || !step || step.type !== "pay") {
            logger.error("Payment outcome cannot be delivered", {
                payment: payment.id,
                phone: mask(payment.phone),
                reason: !sender?.send ? "no SMS channel can send" : "its pay step no longer exists",
            });
            return;
        }
        const loaded = await store.load(payment.phone);
        const latest = loaded ?? freshRecord(payment.phone, payment.locale, clock.now());
        const run = new TurnRun(latest, sender, { channel: sender.id, phone: payment.phone, input: "" }, { ...deps, saved: Promise.resolve() });
        // Already applied by an earlier attempt whose message failed to send: send it
        // again, and never run onPaid or onFailed a second time.
        let text = appliedOutcome(latest, payment.id);
        if (text === undefined) {
            const base = loaded ? structuredClone(loaded) : null;
            const outcome = await run.paymentOutcome(step, payment);
            text = outcome.text;
            latest.channel = sender.id;
            latest.updatedAt = clock.now();
            recordOutcome(latest, payment.id, text);
            // onPaid or onFailed has run: from here nothing may throw, or a retry would run it
            // again. If the session cannot be updated, the message is still sent (design §9).
            if (!(await saveMerged(store, base, latest, { background: true }))) {
                logger.error("Payment outcome: the session kept changing and was not updated; sending the message anyway", {
                    payment: payment.id,
                    phone: mask(payment.phone),
                });
            }
        }
        await sendWithRetry(sender, { to: payment.phone, text });
        logger.info("Payment outcome sent", { payment: payment.id, phone: mask(payment.phone), status: payment.status });
        if (payment.status === "COMPLETED") {
            // A failed receipt never changes the payment (design §14, decision 7).
            try {
                await sendWithRetry(sender, { to: payment.phone, text: run.receipt(payment) });
            }
            catch (err) {
                logger.error("Receipt could not be sent", { payment: payment.id, error: describeError(err) });
            }
        }
    }
    async function sendWithRetry(sender, out) {
        const waits = [1000, 5000];
        for (let attempt = 0;; attempt++) {
            try {
                await sender.send?.(out);
                return;
            }
            catch (err) {
                const wait = waits[attempt];
                if (wait === undefined)
                    throw err;
                await new Promise((resolve) => clock.setTimeout(resolve, wait));
            }
        }
    }
    const agent = {
        channels: config.channels,
        logger,
        payments: payments
            ? {
                settle: async (id) => {
                    await payments.settle(id);
                },
                reconcile: (options) => payments.reconcile(options),
            }
            : undefined,
        mask,
        errorText,
        background: (task) => background.run(task),
        channel: (id) => channels.get(id),
        withChannels: (next) => buildAgent({ ...config, channels: next }),
        async handle(event) {
            const channel = channels.get(event.channel);
            if (!channel)
                throw new TypeError(`No channel with id ${JSON.stringify(event.channel)}`);
            const now = clock.now();
            const loaded = await store.load(event.phone);
            // What this turn started from, to tell its own changes from those of a
            // payment outcome or deferred answer saved while it ran.
            const base = loaded ? structuredClone(loaded) : null;
            const record = loaded ?? freshRecord(event.phone, catalog.defaultLocale, now);
            if (loaded && now - loaded.updatedAt > resumeWindow)
                resetPosition(record);
            if (record.deferred && now - record.deferred.since > DEFERRAL_TTL_MS)
                record.deferred = null;
            const newGatewaySession = channel.live &&
                event.gatewaySessionId !== undefined &&
                event.gatewaySessionId !== record.gatewaySessionId;
            if (event.gatewaySessionId)
                record.gatewaySessionId = event.gatewaySessionId;
            if (newGatewaySession)
                event = { ...event, newSession: true };
            let markSaved;
            const saved = new Promise((resolve) => (markSaved = resolve));
            const turn = new TurnRun(record, channel, event, { ...deps, saved });
            let outcome;
            try {
                outcome = await turn.run();
            }
            catch (err) {
                logger.error("Turn failed", {
                    channel: channel.id,
                    phone: mask(event.phone),
                    step: record.stepId,
                    error: describeError(err),
                });
                resetPosition(record);
                const text = errorText(record.locale);
                outcome = {
                    text: channel.kind === "ussd" ? toUssdSafe(text).text : text,
                    end: true,
                    stepId: null,
                    deferred: false,
                };
            }
            record.channel = channel.id;
            record.updatedAt = clock.now();
            try {
                // A turn that lost its session to a newer one must not overwrite it. Otherwise
                // its changes are merged into anything saved meanwhile, never written over it.
                if (!turn.superseded && !(await saveMerged(store, base, record, { background: false }))) {
                    logger.warn("Session kept changing; saving this turn over it", { phone: mask(event.phone) });
                    await store.save(record);
                }
            }
            finally {
                markSaved();
            }
            logger.debug("Turn", {
                channel: channel.id,
                phone: mask(event.phone),
                step: outcome.stepId,
                end: outcome.end,
                deferred: outcome.deferred,
            });
            return outcome;
        },
        requestHandler: async (req) => {
            const { pathname } = new URL(req.url);
            const match = routes.get(pathname) ?? routes.get(pathname.replace(/\/+$/, ""));
            if (!match)
                return new Response("Not found", { status: 404, headers: { "content-type": "text/plain" } });
            return match.route.handle(req, agent);
        },
    };
    return agent;
}
/** Validates `createAgent({ languages })` once, at startup, so a typo never reaches a user. */
function checkLanguages(languages, catalog) {
    if (!languages)
        return undefined;
    const { supported } = languages;
    if (supported.length < 2) {
        throw new TypeError("`languages.supported` needs at least two languages: one language needs no menu");
    }
    const codes = new Set();
    const names = new Set();
    for (const language of supported) {
        if (!language.code || !language.name.trim()) {
            throw new TypeError("Each language needs a code and its own name, e.g. { code: \"fr\", name: \"Français\" }");
        }
        if (codes.has(language.code))
            throw new TypeError(`Language ${JSON.stringify(language.code)} is listed twice`);
        if (names.has(language.name))
            throw new TypeError(`Two languages are both called ${JSON.stringify(language.name)}`);
        codes.add(language.code);
        names.add(language.name);
        if (!catalog.has(language.code)) {
            throw new TypeError(`Language ${JSON.stringify(language.code)} has no messages: pass them in createAgent({ messages: { ${language.code}: { … } } })`);
        }
    }
    const detection = languages.detection;
    if (detection === undefined)
        return { supported, priors: languages.priors ?? DEFAULT_LANGUAGE_PRIORS };
    if (typeof detection.detector?.detect !== "function") {
        throw new TypeError("`languages.detection.detector` needs a detect(text, { candidates }) function");
    }
    if (!(Number.isFinite(detection.threshold) && detection.threshold > 0 && detection.threshold <= 1)) {
        throw new TypeError(`\`languages.detection.threshold\` must be above 0 and at most 1, got ${detection.threshold}: there is no default until one is measured`);
    }
    if (!(Number.isInteger(detection.minChars) && detection.minChars >= 1)) {
        throw new TypeError(`\`languages.detection.minChars\` must be a whole number of at least 1, got ${detection.minChars}: there is no default until one is measured`);
    }
    const timeoutMs = detection.timeoutMs ?? DEFAULT_DETECTION_TIMEOUT_MS;
    if (!(Number.isFinite(timeoutMs) && timeoutMs > 0)) {
        throw new TypeError(`\`languages.detection.timeoutMs\` must be a positive number, got ${timeoutMs}`);
    }
    return {
        supported,
        priors: languages.priors ?? DEFAULT_LANGUAGE_PRIORS,
        detection: { detector: detection.detector, threshold: detection.threshold, minChars: detection.minChars, timeoutMs },
    };
}
/** `ctx.model`: the one model, or the entry for the user's language from `models`, checked at startup. */
function buildModelFor(config, catalog, logger) {
    const models = config.models;
    if (!models)
        return () => config.model;
    if (config.model !== undefined) {
        throw new TypeError("Pass either `model` or `models`, not both");
    }
    if (!Object.prototype.hasOwnProperty.call(models, "default")) {
        throw new TypeError("`models` needs a `default` model, used for any language without its own");
    }
    for (const locale of Object.keys(models)) {
        if (locale !== "default" && !catalog.has(locale)) {
            throw new TypeError(`\`models.${locale}\` is for a language with no messages; add them in \`messages\` or remove the model`);
        }
    }
    const warned = new Set();
    return (locale) => {
        if (locale !== "default" && Object.prototype.hasOwnProperty.call(models, locale))
            return models[locale];
        if (!warned.has(locale)) {
            warned.add(locale);
            logger.warn("No model for this language; using the default model", { locale });
        }
        return models.default;
    };
}
function checkDeadline(ms, logger) {
    if (!Number.isFinite(ms) || ms <= 0)
        throw new RangeError(`deadlineMs must be a positive number, got ${ms}`);
    if (ms > DEADLINE_MAX_MS) {
        throw new RangeError(`deadlineMs is ${ms}; gateways expect a USSD reply within ${DEADLINE_MAX_MS} ms, so the most allowed is ${DEADLINE_MAX_MS}`);
    }
    if (ms > DEADLINE_WARN_MS) {
        logger.warn(`deadlineMs is ${ms}; above ${DEADLINE_WARN_MS} ms leaves little room before the gateway gives up`);
    }
    return ms;
}
/** One inbound event's worth of work. Mutates `record`; the caller saves it. */
class TurnRun {
    record;
    channel;
    event;
    deps;
    t;
    /**
     * When this turn's live waits must be over: the handler deadline plus, if
     * detection is on, its timeout. Detection, a handler and a payment's
     * preparation share it, so together they never pass what the config check
     * allowed, however many of them one turn runs.
     */
    waitUntil;
    /** Set when a newer turn saved this session first: this one must not be saved. */
    superseded = false;
    /** The session as it was when this turn's answer was deferred, to tell what the late handler changed. */
    deferral;
    constructor(record, channel, event, deps) {
        this.record = record;
        this.channel = channel;
        this.event = event;
        this.deps = deps;
        this.t = deps.catalog.translator(record.locale);
        this.waitUntil = deps.clock.now() + deps.deadlineMs + (deps.languages?.detection?.timeoutMs ?? 0);
    }
    /** At most `cap` ms, and no more than this turn has left. */
    remaining(cap) {
        return Math.max(0, Math.min(cap, this.waitUntil - this.deps.clock.now()));
    }
    /**
     * Saves the session now, only if no other turn has saved it since it was
     * read. False when one has: that turn is newer, and this one must not act.
     */
    async claim() {
        try {
            await this.deps.store.save(this.record, { ifVersion: this.record.version ?? 0 });
            return true;
        }
        catch (err) {
            if (!(err instanceof SessionConflictError))
                throw err;
            return false;
        }
    }
    /**
     * A newer turn got there first: save nothing, and show what it left on
     * screen, or what `then` makes of the session it saved.
     */
    async yieldToNewer(reason, then) {
        this.superseded = true;
        this.deps.logger.info(reason, { channel: this.channel.id, phone: this.deps.mask(this.event.phone) });
        const current = await this.deps.store.load(this.event.phone);
        if (current)
            Object.assign(this.record, current);
        this.t = this.deps.catalog.translator(this.record.locale);
        if (then)
            return then();
        const shown = this.record.turn;
        return shown ? this.display(shown) : this.showStep(this.entry());
    }
    async run() {
        const { record, channel, event } = this;
        if (record.deferred) {
            // An earlier answer is still on its way; say so again rather than block.
            return this.deferredNotice();
        }
        // A tap on a button from an earlier turn: refuse it and show what is current.
        if (event.turnId !== undefined && event.turnId !== (record.turnId ?? 0)) {
            return this.expiredChoice();
        }
        const shown = record.turn;
        if (channel.live && event.newSession) {
            const replay = event.inputs ?? (event.input !== "" ? [event.input] : []);
            if (replay.length === 0) {
                // A fresh dial: resume where a dropped session left off, or start over.
                return shown ? this.display(shown) : await this.showStep(this.entry());
            }
            // The first replayed input would be taken as a language choice, which it is not:
            // ask the language first and drop the shortcut this once.
            if (this.needsLanguage())
                return this.showStep(this.entry());
            // A dial string with choices in it: start from the top and replay them.
            let outcome = await this.showStep(this.deps.steps.start);
            for (const input of replay) {
                const current = this.record.turn;
                if (outcome.end || !current)
                    break;
                outcome = await this.answer(current, input);
            }
            return outcome;
        }
        if (channel.kind === "sms" && (!shown || shown.kind === "say")) {
            // Nothing is waiting for an answer: an SMS starts the flow from the top.
            return this.startFromMessage(event.input);
        }
        if (!shown)
            return this.showStep(this.entry());
        return this.answer(shown, event.input);
    }
    /** Turns a handler's reply into what to show next. Public for deferred delivery. */
    async finish(reply, owner) {
        if (reply === undefined || reply === null) {
            const ownerId = this.deps.steps.id(owner);
            const up = (ownerId && this.deps.steps.parent(ownerId)) || this.deps.steps.start;
            return this.showStep(up);
        }
        if (typeof reply === "string")
            return this.showTurn({ kind: "say", text: reply }, null);
        if (isStep(reply)) {
            if (!this.deps.steps.id(reply)) {
                throw new TypeError("A handler returned a step that isn't part of the agent. Declare it in the tree or pass it in createAgent({ steps }).");
            }
            return this.showStep(reply);
        }
        if (typeof reply === "object" && reply.kind === "say") {
            return this.showTurn(reply, null);
        }
        throw new TypeError("A handler may return a string, a say turn, a step, or nothing. For questions, return an ask, choose or confirm step.");
    }
    async answer(shown, input) {
        const { record, channel } = this;
        const reading = interpret(shown, input, {
            kind: channel.kind,
            t: this.t,
            page: record.page,
            pages: this.pagesOf(shown),
            ...(channel.ussd ? { budget: channel.ussd } : {}),
        });
        if (reading.type === "more") {
            record.page += 1;
            return this.display(shown);
        }
        if (reading.type === "invalid")
            return this.display(shown, this.t(reading.reason));
        if (record.languageSuggestion && (reading.type === "yes" || reading.type === "no")) {
            return this.resolveLanguageSuggestion(reading.type === "yes");
        }
        const step = record.stepId ? this.deps.steps.get(record.stepId) : undefined;
        if (!step) {
            // The tree changed under a stored session, or a handler's say had pages.
            return this.showStep(this.entry());
        }
        switch (reading.type) {
            case "option": {
                if (step.type === "language")
                    return this.chooseLanguage(step, reading.index);
                if (step.type !== "menu")
                    return this.showStep(this.entry());
                const entry = step.entries[reading.index];
                if (!entry)
                    return this.display(shown, this.t("common.invalidChoice"));
                const label = shown.kind === "choose" ? (shown.options[reading.index]?.label ?? "") : "";
                return this.go(entry.to, label, step);
            }
            case "answer":
                if (step.type !== "ask")
                    return this.showStep(this.entry());
                return (await this.suggestLanguage(reading.value, step)) ?? this.runHandler(step.handler, reading.value, step);
            case "yes":
            case "no": {
                if (step.type === "pay") {
                    return reading.type === "yes" ? this.startPayment(step) : this.go(step.onDeclined, input.trim(), step);
                }
                if (step.type !== "confirm")
                    return this.showStep(this.entry());
                return this.go(reading.type === "yes" ? step.onYes : step.onNo, input.trim(), step);
            }
            default:
                return assertNever(reading);
        }
    }
    go(target, input, from) {
        return isStep(target) ? this.showStep(target) : this.runHandler(target, input, from);
    }
    async runHandler(handler, input, owner) {
        const ctx = this.context(input);
        const work = Promise.resolve().then(() => handler(input, ctx));
        if (!this.channel.live)
            return this.finish(await work, owner);
        const result = await this.race(work);
        if (result.done)
            return this.finish(result.value, owner);
        return this.defer(work, owner);
    }
    /** Settles with the handler's reply, or `{ done: false }` at the deadline. */
    race(work, ms = this.remaining(this.deps.deadlineMs)) {
        const { clock } = this.deps;
        return new Promise((resolve, reject) => {
            const timer = clock.setTimeout(() => resolve({ done: false }), ms);
            work.then((value) => {
                clock.clearTimeout(timer);
                resolve({ done: true, value });
            }, (err) => {
                clock.clearTimeout(timer);
                reject(err);
            });
        });
    }
    /** Ends the live session with the notice and finishes the answer by SMS. */
    defer(work, owner) {
        const { record, deps, event } = this;
        const sender = deps.smsSender;
        if (!sender?.send) {
            work.catch(() => { }); // Nobody will read it; don't let it go unhandled.
            throw new Error("A handler missed the deadline and no SMS channel can send the answer");
        }
        record.deferred = { since: deps.clock.now() };
        this.deferral = { since: record.deferred.since, before: structuredClone(record) };
        deps.logger.info("Answer deferred to SMS", {
            channel: this.channel.id,
            phone: deps.mask(event.phone),
            step: record.stepId,
            deadlineMs: deps.deadlineMs,
        });
        deps.background.run(() => this.deliverLater(work, owner, sender));
        return this.deferredNotice();
    }
    deferredNotice() {
        const outcome = this.showTurn({ kind: "say", text: this.t("common.deferredNotice") }, null);
        return { ...outcome, deferred: true };
    }
    /** Waits for the late answer, renders it for SMS, saves the session, and sends it. */
    async deliverLater(work, owner, sender) {
        const { deps, event } = this;
        let reply;
        let failure;
        try {
            reply = await work;
        }
        catch (err) {
            failure = err;
        }
        await deps.saved;
        const deferral = this.deferral ?? { since: this.record.deferred?.since ?? 0, before: structuredClone(this.record) };
        // Start from the stored session, which other turns or a payment outcome may have
        // changed meanwhile, and apply only what the handler changed after the deadline.
        // The reply is rendered once; a conflicting save is merged, never rendered again.
        const loaded = await deps.store.load(event.phone);
        const base = loaded ? structuredClone(loaded) : null;
        const target = structuredClone(loaded ?? this.record);
        applyChanges(deferral.before, this.record, target);
        // Still this answer's deferral, or has the session moved on without it?
        const ours = loaded === null || loaded.deferred?.since === deferral.since;
        if (ours)
            target.deferred = null;
        const run = new TurnRun(target, sender, { channel: sender.id, phone: event.phone, input: "" }, {
            ...deps,
            saved: Promise.resolve(),
        });
        let text = "";
        if (failure === undefined) {
            try {
                text = (await run.finish(reply, owner)).text;
            }
            catch (err) {
                failure = err;
            }
        }
        if (failure !== undefined) {
            if (ours)
                resetPosition(target);
            text = deps.catalog.translator(target.locale)("common.error");
        }
        // A newer turn waiting for an answer keeps its place; the SMS still goes out.
        if (loaded && !ours && isWaiting(loaded))
            copyPosition(loaded, target);
        target.channel = sender.id;
        target.updatedAt = deps.clock.now();
        if (!(await saveMerged(deps.store, base, target, { background: true }))) {
            deps.logger.error("Deferred answer: the session kept changing and was not updated; sending the answer anyway", {
                phone: deps.mask(event.phone),
            });
        }
        if (failure !== undefined) {
            deps.logger.error("Deferred answer failed", {
                phone: deps.mask(event.phone),
                step: deps.steps.id(owner),
                error: describeError(failure),
            });
        }
        await sender.send?.({ to: event.phone, text });
        deps.logger.info(failure === undefined ? "Deferred answer sent" : "Deferred apology sent", {
            channel: sender.id,
            phone: deps.mask(event.phone),
        });
    }
    async showStep(step) {
        if (step.type === "pay")
            return this.showPay(step);
        if (step.type === "language")
            return this.showLanguage(step);
        return this.showTurn(this.turnFor(step), this.deps.steps.id(step) ?? null);
    }
    /**
     * A typed answer that a detector confidently places in another of the
     * agent's languages: hold it, and ask whether to continue in that language.
     * Returns null to carry on as normal, which is every other case.
     */
    /**
     * The language `input` is written in, if a detector is configured and says
     * so confidently, and it is one of `among`. Null in every other case: too
     * short, no letters, a slow or failing detector, a language not offered, or
     * a score under the threshold. Never decides anything by itself.
     */
    async detectLanguage(input, among) {
        const detection = this.deps.languages?.detection;
        if (!detection || among.length === 0)
            return null;
        const text = input.trim();
        if (text.length < detection.minChars || !/\p{L}/u.test(text))
            return null;
        const candidates = among.map((l) => l.code);
        let result;
        const work = Promise.resolve().then(() => detection.detector.detect(text, { candidates }));
        try {
            // On every channel: a hung detector must never hold up the answer.
            const raced = await this.race(work, this.remaining(detection.timeoutMs));
            if (!raced.done) {
                work.catch(() => { });
                this.deps.logger.warn("Language detection timed out; carrying on without it", { timeoutMs: detection.timeoutMs });
                return null;
            }
            result = raced.value;
        }
        catch (err) {
            this.deps.logger.warn("Language detection failed; carrying on without it", { error: describeError(err) });
            return null;
        }
        if (!result || !(result.confidence >= detection.threshold))
            return null;
        return among.find((l) => l.code === result.code) ?? null;
    }
    /**
     * An SMS that starts a conversation (languages design §5). A new number gets
     * the language menu with the language its message looks like listed first;
     * nothing is chosen for it. A number with a language gets the start, or
     * first an offer to continue in the language it wrote in, under the same
     * rules as for typed answers. With `onMessage`, the start is that handler run
     * on the message, and a message that waits for a language choice is held
     * until it is made (docs/first-message-design.md §4, §5).
     */
    async startFromMessage(input) {
        const entry = this.entry();
        const message = this.deps.onMessage ? input.trim() : "";
        if (entry.type === "language") {
            const hint = await this.detectLanguage(input, entry.languages ?? this.deps.languages?.supported ?? []);
            const outcome = await this.showLanguage(entry, hint?.code);
            // Set after showLanguage, whose showTurn moves the position.
            this.record.heldMessage = message || null;
            return outcome;
        }
        if (this.record.languageSuggestionDeclined || this.record.languageOffered)
            return this.startConversation(message);
        const language = await this.detectLanguage(input, this.deps.languages?.supported ?? []);
        if (!language || language.code === this.record.locale)
            return this.startConversation(message);
        return this.offerLanguage(language, null, { start: true, message });
    }
    /** The start of a conversation: `onMessage` on its first SMS when there is one, else the start step. */
    async startConversation(message) {
        const onMessage = this.deps.onMessage;
        if (!onMessage || message === "")
            return this.showStep(this.entry());
        return this.runHandler(onMessage, message, this.deps.steps.start);
    }
    async suggestLanguage(input, step) {
        if (!this.deps.languages?.detection)
            return null;
        // One offer per conversation, and none ever again after a No.
        if (this.record.languageSuggestionDeclined || this.record.languageOffered)
            return null;
        // Numbers are not language: never send an account number or an amount to a detector.
        if (step.type === "ask" && step.input === "number")
            return null;
        // Only one of the agent's own languages, confidently, and not the one already in use.
        const language = await this.detectLanguage(input, this.deps.languages.supported);
        if (!language || language.code === this.record.locale)
            return null;
        return this.offerLanguage(language, step, { input });
    }
    /**
     * Asks whether to continue in `language`. With a step, the typed `input` is
     * held for it; with `start`, the conversation starts once the user answers.
     */
    async offerLanguage(language, step, held) {
        const stepId = step ? (this.deps.steps.id(step) ?? null) : null;
        // Asked in the suggested language, which is the point: the user reads it if it is theirs.
        const t = this.deps.catalog.translator(language.code);
        const outcome = this.showTurn({
            kind: "confirm",
            question: t("common.suggestLanguage", { language: language.name }),
            yes: t("common.yes"),
            no: t("common.no"),
        }, stepId);
        // Set after showTurn, which clears any earlier suggestion.
        this.record.languageSuggestion =
            "start" in held
                ? { code: language.code, input: held.message ?? "", stepId: "", start: true }
                : { code: language.code, input: held.input, stepId: stepId ?? "", question: step ? questionKey(step) : "" };
        this.record.languageOffered = true;
        // Detection took time: if a newer turn saved this session meanwhile, it wins.
        if (!(await this.claim()))
            return this.yieldToNewer("Language suggestion dropped: a newer turn came first");
        return outcome;
    }
    /** The answer to a language suggestion: switch or not, then run the held answer. */
    async resolveLanguageSuggestion(accept) {
        const suggestion = this.record.languageSuggestion;
        this.record.languageSuggestion = null;
        if (!suggestion)
            return this.showStep(this.entry());
        if (suggestion.start) {
            // Offered on a conversation's first message: answer, then start, with the
            // message itself when `onMessage` held it.
            this.settleSuggestion(suggestion.code, accept);
            if (!(await this.claim())) {
                // The first answer already settled it; show the same start, unsaved.
                return this.yieldToNewer("Duplicate answer to a language suggestion ignored", () => this.showStep(this.entry()));
            }
            return this.startConversation(suggestion.input);
        }
        // Only the question the offer was made on: after a tree change the held
        // answer might reach a different handler, so the offer lapses, unanswered.
        const step = this.deps.steps.get(suggestion.stepId);
        if (step?.type !== "ask" || suggestion.question === undefined || suggestion.question !== questionKey(step)) {
            this.deps.logger.info("Language suggestion lapsed: its question has changed");
            return this.showStep(this.entry());
        }
        this.settleSuggestion(suggestion.code, accept);
        // Claim the held answer before running it: of two answers read from the
        // same stored session, only the first runs the handler.
        if (!(await this.claim()))
            return this.yieldToNewer("Duplicate answer to a language suggestion ignored");
        return this.runHandler(step.handler, suggestion.input, step);
    }
    /** Yes switches to the suggested language for good; No is remembered for good. */
    settleSuggestion(code, accept) {
        if (accept && this.deps.catalog.has(code)) {
            this.record.locale = code;
            this.record.languageChosen = true;
            this.t = this.deps.catalog.translator(code);
            this.deps.logger.info("Language switched on suggestion", { language: code });
        }
        else {
            this.record.languageSuggestionDeclined = true;
        }
    }
    /** Where a fresh start begins: the language menu until the user has chosen, then the start step. */
    entry() {
        return this.needsLanguage() && this.deps.languageStep ? this.deps.languageStep : this.deps.steps.start;
    }
    needsLanguage() {
        return this.deps.languageStep !== undefined && !this.record.languageChosen;
    }
    /** The step's languages, the likely ones for this number first. */
    orderedLanguages(step) {
        const languages = step.languages ?? this.deps.languages?.supported ?? [];
        const priors = step.priors ?? this.deps.languages?.priors ?? DEFAULT_LANGUAGE_PRIORS;
        return orderLanguages(languages, this.event.phone, priors);
    }
    /** The language menu. `first`, a detected language, is listed first: a hint, never a choice. */
    async showLanguage(step, first) {
        const ordered = this.orderedLanguages(step);
        const hinted = first ? ordered.findIndex((l) => l.code === first) : -1;
        if (hinted > 0)
            ordered.unshift(...ordered.splice(hinted, 1));
        const title = step.title !== undefined
            ? this.deps.catalog.localize(step.title, this.record.locale)
            : [...new Set(ordered.map((l) => this.deps.catalog.translator(l.code)("common.language")))].join(" / ");
        const outcome = this.showTurn({ kind: "choose", question: title, options: ordered.map((l) => ({ label: l.name })) }, this.deps.steps.id(step) ?? null);
        // Set after showTurn, which clears it: a choice means what this menu listed.
        this.record.languageCodes = ordered.map((l) => l.code);
        return outcome;
    }
    /** The user picked a language: set it for good, then carry on. */
    async chooseLanguage(step, index) {
        const shown = this.record.turn;
        const codes = this.record.languageCodes;
        // Resolve against the menu the caller saw. Sessions from before it was kept
        // fall back to today's order.
        const code = codes ? codes[index] : this.orderedLanguages(step)[index]?.code;
        if (code === undefined) {
            return shown ? this.display(shown, this.t("common.invalidChoice")) : this.showStep(this.entry());
        }
        const language = (step.languages ?? this.deps.languages?.supported ?? []).find((l) => l.code === code);
        // No longer offered: show the menu as it is now.
        if (!language)
            return this.showLanguage(step);
        this.record.locale = language.code;
        this.record.languageChosen = true;
        this.t = this.deps.catalog.translator(language.code);
        this.deps.logger.info("Language chosen", { language: language.code, channel: this.channel.id });
        const held = this.record.heldMessage;
        if (held) {
            this.record.heldMessage = null;
            // onMessage is for SMS: a choice made on USSD drops the message.
            if (this.channel.kind === "sms") {
                // Claim it first: of two answers read from the same session, only one runs it.
                if (!(await this.claim()))
                    return this.yieldToNewer("Duplicate answer to the language menu; its held message runs once");
                return this.startConversation(held);
            }
        }
        if (step.then === undefined)
            return this.finish(undefined, step);
        return this.go(step.then, language.name, step);
    }
    paymentsOrThrow() {
        if (!this.deps.payments)
            throw new TypeError("A pay step needs `payments` in createAgent");
        return this.deps.payments;
    }
    /** Policy check and operator lookup first; the confirm screen only if both allow it. */
    async showPay(step) {
        const payments = this.paymentsOrThrow();
        const prepare = async () => {
            const spec = await step.spec(this.context(""));
            const reason = spec.reason === undefined ? "" : this.deps.catalog.localize(spec.reason, this.record.locale);
            const result = await payments.offer(this.event.phone, { amount: spec.amount, currency: spec.currency, reason });
            return { spec, reason, result };
        };
        const work = prepare();
        let prepared;
        if (this.channel.live) {
            // Looking up the operator is a network call. On a live channel it gets the same
            // deadline as a handler; offering a payment has no side effects, so on a miss the
            // user is told to try again and the late answer is dropped.
            const raced = await this.race(work);
            if (!raced.done) {
                work.catch(() => { });
                this.deps.logger.warn("Payment preparation missed the deadline", {
                    channel: this.channel.id,
                    phone: this.deps.mask(this.event.phone),
                    deadlineMs: this.deps.deadlineMs,
                });
                return this.showTurn({ kind: "say", text: this.t("payments.unavailable") }, null);
            }
            prepared = raced.value;
        }
        else {
            prepared = await work;
        }
        const { spec, reason, result } = prepared;
        if (!result.ok) {
            return this.runPayTarget(step.onFailed, this.refused(spec.amount, spec.currency, reason, result.reason), step);
        }
        this.record.payIntent = {
            amount: result.offer.amount,
            currency: result.offer.currency,
            reason: result.offer.reason,
            provider: result.offer.provider,
            providerPhone: result.offer.providerPhone,
        };
        // Render the offer that was accepted, the same one "Yes" will pay.
        const { offer } = result;
        const vars = { amount: offer.amount, currency: offer.currency, payee: payments.payeeName, reason: offer.reason };
        const question = this.t(offer.reason === "" ? "payments.confirmNoReason" : "payments.confirm", vars);
        return this.showTurn({ kind: "confirm", question }, this.deps.steps.id(step) ?? null);
    }
    /** "Yes" on a pay confirm: record the payment, end the session, then initiate in the background. */
    async startPayment(step) {
        const payments = this.paymentsOrThrow();
        const intent = this.record.payIntent;
        this.record.payIntent = null;
        if (!intent)
            return this.showStep(step); // Nothing was offered under this session: start over.
        // Claim the intent before touching money: a versioned save of the session
        // with the intent consumed. A second "Yes" read from the same stored
        // session loses here and starts nothing.
        try {
            await this.deps.store.save(this.record, { ifVersion: this.record.version ?? 0 });
        }
        catch (err) {
            if (!(err instanceof SessionConflictError))
                throw err;
            this.deps.logger.info("Duplicate Yes ignored", { phone: this.deps.mask(this.event.phone) });
            return this.showTurn({ kind: "say", text: this.t("payments.alreadyStarted") }, null);
        }
        const stepId = this.deps.steps.id(step) ?? "";
        const begun = await payments.begin(this.event.phone, intent, { stepId, locale: this.record.locale });
        if (!begun.ok) {
            return this.runPayTarget(step.onFailed, this.refused(intent.amount, intent.currency, intent.reason, begun.reason), step);
        }
        const { payment } = begun;
        // Not before this turn's session is saved: a provider that rejects at once would
        // otherwise deliver the outcome against a session this turn then overwrites.
        this.deps.background.run(async () => {
            await this.deps.saved;
            await payments.run(payment.id);
        });
        this.deps.logger.info("Payment started", {
            payment: payment.id,
            phone: this.deps.mask(this.event.phone),
            amount: payment.amount,
            currency: payment.currency,
            provider: payment.provider,
        });
        return this.showTurn({ kind: "say", text: this.t("payments.pinPrompt") }, null);
    }
    refused(amount, currency, reason, why) {
        return {
            status: "REFUSED",
            amount,
            currency,
            reason,
            failureMessage: this.t("payments.refused", { why: this.t(`payments.refusal.${why}`, { currency }) }),
        };
    }
    async runPayTarget(target, outcome, owner) {
        if (isStep(target))
            return this.showStep(target);
        const reply = await target(outcome, this.context(""));
        if ((reply === undefined || reply === null) && this.fallbackFor(owner) === owner) {
            // "Back to the menu above" would land on this same pay step and offer the payment
            // again (a root pay step has no menu above it). End with a plain message instead.
            return this.showTurn({ kind: "say", text: outcome.failureMessage ?? this.t("payments.paid") }, null);
        }
        return this.finish(reply, owner);
    }
    /** The step a handler that returns nothing goes back to. */
    fallbackFor(owner) {
        const ownerId = this.deps.steps.id(owner);
        return (ownerId && this.deps.steps.parent(ownerId)) || this.deps.steps.start;
    }
    /** What the user hears when a payment reaches a final status. */
    async paymentOutcome(step, payment) {
        const status = payment.status;
        const payee = this.paymentsOrThrow().payeeName;
        const outcome = {
            id: payment.id,
            amount: payment.amount,
            currency: payment.currency,
            reason: payment.reason,
            status,
            // Never the provider's code: that stays in the store for the developer.
            ...(status === "COMPLETED"
                ? {}
                : { failureMessage: status === "UNRESOLVED" ? this.t("payments.unresolved", { payee }) : this.t("payments.failed") }),
        };
        return this.runPayTarget(status === "COMPLETED" ? step.onPaid : step.onFailed, outcome, step);
    }
    receipt(payment) {
        return this.t("payments.receipt", {
            amount: payment.amount,
            currency: payment.currency,
            payee: this.paymentsOrThrow().payeeName,
            ref: payment.id.slice(0, 8),
        });
    }
    /** Shows a new turn, which makes every earlier button stale. */
    showTurn(turn, stepId) {
        // A pending language suggestion only applies while its question is on screen.
        this.record.languageSuggestion = null;
        this.record.languageCodes = null;
        this.record.stepId = stepId;
        this.record.page = 0;
        this.record.turnId = newTurnId(this.record.turnId);
        return this.display(turn);
    }
    /** The same turn again, with a notice and no handler run. */
    async expiredChoice() {
        const shown = this.record.turn;
        this.deps.logger.info("Expired choice ignored", {
            channel: this.channel.id,
            phone: this.deps.mask(this.event.phone),
            step: this.record.stepId,
        });
        if (shown)
            return this.display(shown, this.t("common.expiredChoice"));
        return this.showStep(this.entry());
    }
    /** Renders `turn` at the record's current page and updates the position. */
    display(turn, notice) {
        const { record, channel } = this;
        const rendered = channel.render(turn, {
            t: this.t,
            page: record.page,
            turnId: record.turnId ?? 0,
            ...(notice ? { notice } : {}),
        });
        for (const warning of rendered.warnings) {
            this.deps.logger.warn(warning, { channel: channel.id, step: record.stepId });
        }
        const stepId = record.stepId;
        record.page = rendered.page;
        if (rendered.end)
            resetPosition(record);
        else
            record.turn = turn;
        return { text: rendered.text, end: rendered.end, stepId, deferred: false };
    }
    pagesOf(turn) {
        // Re-render to learn how many pages the user is paging through.
        return this.channel.render(turn, { t: this.t, page: 0 }).pages;
    }
    turnFor(step) {
        const text = (value) => this.deps.catalog.localize(value, this.record.locale);
        switch (step.type) {
            case "say":
                return { kind: "say", text: text(step.text) };
            case "menu":
                return {
                    kind: "choose",
                    ...(step.title !== undefined ? { question: text(step.title) } : {}),
                    options: step.entries.map((e) => ({ label: text(e.label) })),
                };
            case "ask":
                return { kind: "ask", question: text(step.question), input: step.input };
            case "confirm":
                return {
                    kind: "confirm",
                    question: text(step.question),
                    ...(step.yes !== undefined ? { yes: text(step.yes) } : {}),
                    ...(step.no !== undefined ? { no: text(step.no) } : {}),
                };
            case "pay":
                throw new TypeError("A pay step is shown through showPay, not turnFor");
            case "language":
                throw new TypeError("A language step is shown through showLanguage, not turnFor");
            default:
                return assertNever(step);
        }
    }
    context(input) {
        const { record, channel, event, deps } = this;
        const setLocale = (locale) => {
            if (!deps.catalog.has(locale)) {
                deps.logger.warn("Ignored unknown locale", { locale });
                return;
            }
            record.locale = locale;
            record.languageChosen = true;
            this.t = deps.catalog.translator(locale);
        };
        return {
            input,
            phone: event.phone,
            channel: channel.id,
            channelKind: channel.kind,
            session: record.data,
            get locale() {
                return record.locale;
            },
            set locale(locale) {
                setLocale(locale);
            },
            t: (key, vars) => this.t(key, vars),
            get model() {
                return deps.modelFor(record.locale);
            },
            logger: deps.logger,
        };
    }
}
/** A random positive 31-bit integer, different from `previous`. Never 0, which means "none". */
function newTurnId(previous) {
    for (;;) {
        const id = globalThis.crypto.getRandomValues(new Uint32Array(1))[0] >>> 1;
        if (id !== 0 && id !== previous)
            return id;
    }
}
/** Versioned attempts at a merged save before giving up. */
const SAVE_TRIES = 5;
/** Applied payment outcomes kept per session, enough to cover any retry. */
const OUTCOMES_KEPT = 10;
function appliedOutcome(record, paymentId) {
    return record.paymentOutcomes?.find((o) => o.id === paymentId)?.text;
}
function recordOutcome(record, paymentId, text) {
    const kept = (record.paymentOutcomes ?? []).filter((o) => o.id !== paymentId);
    record.paymentOutcomes = [...kept, { id: paymentId, text }].slice(-OUTCOMES_KEPT);
}
/** Where a session is in its conversation: what an outcome may move only if nothing is waiting. */
const POSITION_KEYS = [
    "stepId",
    "turn",
    "page",
    "turnId",
    "languageSuggestion",
    "languageCodes",
    "heldMessage",
    "payIntent",
    "channel",
];
/**
 * Saves `mine`, a session changed from `base` (what was loaded; null for a
 * new one), without undoing anything saved meanwhile: the save is versioned,
 * and on a conflict `mine`'s changes are merged into the newer session and
 * saved again. Never runs a handler or renders anything a second time. False
 * if the session kept changing through every attempt.
 */
async function saveMerged(store, base, mine, options) {
    let attempt = mine;
    let basedOn = mine.version ?? 0;
    for (let tries = 0; tries < SAVE_TRIES; tries++) {
        try {
            await store.save(attempt, { ifVersion: basedOn });
            if (attempt !== mine)
                mine.version = attempt.version;
            return true;
        }
        catch (err) {
            if (!(err instanceof SessionConflictError))
                throw err;
        }
        const theirs = await store.load(mine.phone);
        attempt = theirs ? mergeSessions(base, mine, theirs, options) : mine;
        basedOn = theirs?.version ?? 0;
    }
    return false;
}
const MERGE_SKIP = new Set(["data", "version", "paymentOutcomes", ...POSITION_KEYS]);
/**
 * A three-way merge of sessions: `theirs`, saved meanwhile, with `mine`'s
 * changes from `base` applied. A field only one side changed keeps that
 * side's value. Data keys `mine` changed are always kept (a handler's write).
 * Where both changed a field, the user's own turn wins, and a background
 * delivery gives way. The screen position is decided as one: a background
 * delivery takes it unless the user moved meanwhile and is waiting on a
 * question, who then keeps their place. Applied payment outcomes from both
 * are kept.
 */
function mergeSessions(base, mine, theirs, { background }) {
    const from = (base ?? {});
    const out = structuredClone(theirs);
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const field = (r, key) => r[key];
    const set = (key, value) => {
        out[key] = structuredClone(value);
    };
    applyChanges({ data: from.data ?? {} }, { data: mine.data }, out, { dataOnly: true });
    const keys = new Set([...Object.keys(mine), ...Object.keys(theirs)]);
    for (const key of keys) {
        if (MERGE_SKIP.has(key))
            continue;
        if (same(field(mine, key), field(from, key)))
            continue;
        const theirsChanged = !same(field(theirs, key), field(from, key));
        if (!theirsChanged || !background)
            set(key, field(mine, key));
    }
    // A background delivery gives way only to a user who moved and is now waiting
    // on a question; a conversation that ended takes the delivery's follow-up.
    const moved = (r) => POSITION_KEYS.some((k) => !same(field(r, k), field(from, k)));
    if (moved(mine) && (!background || !moved(theirs) || !isWaiting(theirs)))
        copyPosition(mine, out);
    const outcomes = [...(theirs.paymentOutcomes ?? [])];
    for (const o of mine.paymentOutcomes ?? [])
        if (!outcomes.some((t) => t.id === o.id))
            outcomes.push(o);
    if (outcomes.length > 0)
        out.paymentOutcomes = outcomes.slice(-OUTCOMES_KEPT);
    return out;
}
/**
 * Applies to `target` what changed from `before` to `after`: each data key
 * set or removed, and the language. Keys nobody touched keep `target`'s value,
 * so changes saved meanwhile by others survive.
 */
function applyChanges(before, after, target, { dataOnly = false } = {}) {
    const keys = new Set([...Object.keys(before.data), ...Object.keys(after.data)]);
    for (const key of keys) {
        if (JSON.stringify(before.data[key]) === JSON.stringify(after.data[key]))
            continue;
        if (after.data[key] === undefined)
            delete target.data[key];
        else
            target.data[key] = structuredClone(after.data[key]);
    }
    if (dataOnly)
        return;
    if (after.locale !== before.locale)
        target.locale = after.locale;
    if (after.languageChosen !== before.languageChosen)
        target.languageChosen = after.languageChosen;
}
/** Whether the session is waiting on something: a question on screen, or a deferred answer. */
function isWaiting(record) {
    return record.deferred !== null || (record.turn !== null && record.turn.kind !== "say");
}
function copyPosition(from, to) {
    for (const key of POSITION_KEYS)
        to[key] = structuredClone(from[key]);
}
function resetPosition(record) {
    record.stepId = null;
    record.turn = null;
    record.page = 0;
    record.languageSuggestion = null;
    record.languageCodes = null;
    record.languageOffered = false;
    record.heldMessage = null;
}
/** What an ask step asks, as a string, to tell whether it is still the same question. */
function questionKey(step) {
    return step.type === "ask" ? JSON.stringify(step.question) : "";
}
function describeError(err) {
    return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}