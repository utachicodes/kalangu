/**
 * Steps (docs/design.md §4.2): the tree an agent is built from. A step is
 * data; the engine turns it into a `Turn` for the current locale and routes
 * the user's reply to the next step or handler.
 */
/**
 * A language menu. Place it in the tree (for a "Language" entry), or let
 * `createAgent({ languages })` show it on first contact.
 */
export function languageMenu(options = {}) {
    const step = { type: "language" };
    if (options.languages !== undefined)
        step.languages = options.languages;
    if (options.priors !== undefined)
        step.priors = options.priors;
    if (options.title !== undefined)
        step.title = options.title;
    if (options.then !== undefined)
        step.then = options.then;
    return step;
}
/**
 * Takes a payment from the user (docs/payments-design.md §4.2). Shown as a
 * confirm screen; `onPaid` and `onFailed` run when the final status arrives,
 * after the USSD session has ended, so their output goes out by SMS.
 * Requires `payments` in `createAgent`.
 */
export function pay(spec, options) {
    return {
        type: "pay",
        spec: typeof spec === "function" ? spec : () => spec,
        onPaid: options.onPaid,
        onFailed: options.onFailed,
        onDeclined: options.onDeclined,
    };
}
/** A final screen or message. */
export function say(text) {
    return { type: "say", text };
}
/**
 * A numbered menu. Entries are `{ label: target }`, or an array of
 * `{ label, to }` when labels need translations.
 */
export function menu(title, entries) {
    const list = Array.isArray(entries)
        ? [...entries]
        : Object.entries(entries).map(([label, to]) => ({ label, to }));
    if (list.length === 0)
        throw new TypeError("A menu needs at least one entry");
    return title === undefined ? { type: "menu", entries: list } : { type: "menu", title, entries: list };
}
/** Same as `menu`, named for when the list is a question. */
export const choose = menu;
/** A free-text or number question; the answer goes to `handler`. */
export function ask(question, handler, options = {}) {
    return { type: "ask", question, input: options.input ?? "text", handler };
}
/** A yes/no question. */
export function confirm(question, options) {
    const step = {
        type: "confirm",
        question,
        onYes: options.onYes,
        onNo: options.onNo,
    };
    if (options.yes !== undefined)
        step.yes = options.yes;
    if (options.no !== undefined)
        step.no = options.no;
    return step;
}
export function isStep(value) {
    if (typeof value !== "object" || value === null)
        return false;
    const type = value.type;
    return (type === "say" || type === "menu" || type === "ask" || type === "confirm" || type === "pay" || type === "language");
}
/**
 * Gives every reachable step a stable id from its position in the tree
 * (`start`, `start.2`, `start.2.yes`). Ids are stored in sessions, so they
 * stay valid across restarts as long as the tree's shape doesn't change.
 */
export function indexSteps(start, extra = [], 
/** Steps with a fixed id of their own, which no change to `extra` can shift. */
named = {}) {
    const ids = new Map();
    const byId = new Map();
    const parents = new Map();
    const visit = (step, id, parent) => {
        if (ids.has(step))
            return;
        ids.set(step, id);
        byId.set(id, step);
        if (parent)
            parents.set(id, parent);
        const child = (target, suffix) => {
            if (isStep(target))
                visit(target, `${id}.${suffix}`, step);
        };
        switch (step.type) {
            case "menu":
                step.entries.forEach((entry, i) => child(entry.to, String(i + 1)));
                break;
            case "confirm":
                child(step.onYes, "yes");
                child(step.onNo, "no");
                break;
            case "pay":
                if (isStep(step.onPaid))
                    visit(step.onPaid, `${id}.paid`, step);
                if (isStep(step.onFailed))
                    visit(step.onFailed, `${id}.failed`, step);
                child(step.onDeclined, "declined");
                break;
            case "language":
                if (step.then !== undefined)
                    child(step.then, "then");
                break;
            case "say":
            case "ask":
                break;
        }
    };
    visit(start, "start", undefined);
    extra.forEach((step, i) => visit(step, `steps.${i}`, undefined));
    for (const [name, step] of Object.entries(named))
        visit(step, name, undefined);
    return {
        start,
        id: (step) => ids.get(step),
        get: (id) => byId.get(id),
        parent: (id) => parents.get(id),
        all: () => [...ids.keys()],
    };
}