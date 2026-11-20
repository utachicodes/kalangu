/**
 * Checks a translation (docs/languages-design.md §8).
 *
 * A translation is not only words: it has to keep its `{placeholders}`, fit a
 * USSD screen and stay inside an SMS budget. This is pure, with no I/O, so it
 * runs anywhere; the `kalangu locale check` command wraps it for files.
 */
import { smsLength } from "./budget/sms.js";
import { DEFAULT_USSD_BUDGET, toUssdSafe } from "./budget/ussd.js";
import { en } from "./locales.js";
const PLACEHOLDER = /\{(\w+)\}/g;
function placeholdersOf(text) {
    return [...new Set([...text.matchAll(PLACEHOLDER)].map((m) => m[1]))].sort();
}
/**
 * Checks one locale's messages against the reference. `messages` is whatever
 * was loaded, so it is typed loosely and every value is checked.
 */
export function checkLocale(locale, messages, options = {}) {
    const reference = (options.reference ?? en);
    const referenceLocale = options.referenceLocale ?? "en";
    const maxChars = options.ussdMaxChars ?? DEFAULT_USSD_BUDGET.maxChars;
    const issues = [];
    const add = (key, code, severity, message) => issues.push({ key, code, severity, message });
    const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
    for (const key of Object.keys(reference)) {
        if (!own(messages, key)) {
            add(key, "missing-key", options.complete ? "error" : "warning", options.complete ? "missing" : "missing: falls back to the default language until translated");
        }
    }
    for (const [key, value] of Object.entries(messages)) {
        // Own keys only: "toString" or "constructor" must not count as a known message.
        const original = own(reference, key) ? reference[key] : undefined;
        if (original === undefined) {
            add(key, "unknown-key", "error", "not a message Kalangu uses (a typo?)");
            continue;
        }
        if (typeof value !== "string") {
            add(key, "not-a-string", "error", `must be a string, got ${value === null ? "null" : typeof value}`);
            continue;
        }
        if (value.trim() === "") {
            add(key, "empty", "error", "is empty");
            continue;
        }
        if (locale !== referenceLocale && value === original) {
            add(key, "unchanged", "warning", "is identical to the English: not translated?");
        }
        const wanted = placeholdersOf(original);
        const found = placeholdersOf(value);
        for (const name of wanted.filter((n) => !found.includes(n))) {
            add(key, "placeholder-missing", "error", `lost the placeholder {${name}}, which the program fills in`);
        }
        for (const name of found.filter((n) => !wanted.includes(n))) {
            add(key, "placeholder-extra", "error", `has {${name}}, which the program never fills in`);
        }
        const safe = toUssdSafe(value);
        if (safe.removed.length > 0) {
            add(key, "ussd-removed", "warning", `these characters have no USSD form and are removed: ${safe.removed.map((c) => JSON.stringify(c)).join(" ")}`);
        }
        const altered = [...new Set([...value])]
            .filter((ch) => (ch.codePointAt(0) ?? 0) > 126 && !safe.removed.includes(ch))
            .map((ch) => `${ch} → ${toUssdSafe(ch).text}`);
        if (altered.length > 0) {
            add(key, "ussd-altered", "info", `shown differently on USSD: ${altered.join(", ")}`);
        }
        if (safe.text.length > maxChars) {
            add(key, "ussd-too-long", "warning", `${safe.text.length} characters on USSD (screen limit ${maxChars}): it will be split across screens`);
        }
        const sms = smsLength(value);
        if (sms.encoding === "ucs2") {
            add(key, "sms-ucs2", "warning", `sent as UCS-2, 70 characters per segment instead of 160, because of: ${sms.nonGsmChars.join(" ")}`);
        }
        if (sms.segments > 1) {
            add(key, "sms-segments", "warning", `takes ${sms.segments} SMS segments (${sms.encoding === "ucs2" ? "UCS-2" : "GSM-7"})`);
        }
    }
    const count = (severity) => issues.filter((i) => i.severity === severity).length;
    return {
        locale,
        checked: Object.keys(messages).length,
        expected: Object.keys(reference).length,
        issues,
        errors: count("error"),
        warnings: count("warning"),
        infos: count("info"),
    };
}
/**
 * A report as text for a terminal. Notes only with `verbose`. A partial
 * translation is normal, so when many messages are simply not translated yet
 * they are one line, not a wall that hides the real problems; `verbose` lists them.
 */
export function formatReport(report, options = {}) {
    const lines = [`${report.locale}: ${report.checked} of ${report.expected} messages`];
    const untranslated = report.issues.filter((i) => i.code === "missing-key" && i.severity === "warning");
    const collapse = !options.verbose && untranslated.length > 3;
    if (collapse) {
        lines.push(`  warning ${untranslated.length} messages not translated yet: they fall back to the default language (--verbose lists them)`);
    }
    for (const issue of report.issues) {
        if (issue.severity === "info" && !options.verbose)
            continue;
        if (collapse && untranslated.includes(issue))
            continue;
        lines.push(`  ${issue.severity.padEnd(7)} ${issue.key}: ${issue.message}`);
    }
    const hidden = options.verbose ? 0 : report.infos;
    lines.push(`${report.errors} error${report.errors === 1 ? "" : "s"}, ${report.warnings} warning${report.warnings === 1 ? "" : "s"}` +
        (hidden > 0 ? `, ${hidden} note${hidden === 1 ? "" : "s"} (use --verbose)` : ""));
    return lines.join("\n");
}