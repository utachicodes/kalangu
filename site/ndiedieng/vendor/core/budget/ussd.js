/**
 * USSD screen budgeting (docs/design.md §5.2).
 *
 * Telcos cannot render special characters on USSD, and when a screen is too
 * long they paginate it themselves with reserved `98`/`00` codes. We keep
 * every screen within the limit so that never happens, restrict text to a
 * safe character set, and number options around the reserved codes.
 */
import { BudgetError } from "./errors.js";
export const DEFAULT_USSD_BUDGET = {
    maxChars: 160,
    more: "98",
    reserved: ["98", "00"],
    unsafeChars: "strip",
};
// Letters that Unicode normalization does not reduce to ASCII, including
// those used in Wolof, Hausa and other West African orthographies.
const TRANSLITERATE = {
    "œ": "oe", "Œ": "OE", "æ": "ae", "Æ": "AE", "ß": "ss",
    "ø": "o", "Ø": "O", "đ": "d", "Đ": "D", "ł": "l", "Ł": "L", "ı": "i",
    "ŋ": "ng", "Ŋ": "Ng", "ɲ": "ny", "Ɲ": "Ny",
    "ɓ": "b", "Ɓ": "B", "ɗ": "d", "Ɗ": "D", "ƙ": "k", "Ƙ": "K", "ƴ": "y", "Ƴ": "Y",
    "ɛ": "e", "Ɛ": "E", "ɔ": "o", "Ɔ": "O",
    "‘": "'", "’": "'", "ʼ": "'", "‛": "'", "“": '"', "”": '"', "„": '"', "«": '"', "»": '"',
    "–": "-", "—": "-", "‐": "-", "−": "-", "•": "-", "·": ".", "…": "...", "×": "x",
    "€": "EUR", "£": "GBP", " ": " ", " ": " ", "\t": " ",
};
/**
 * Restricts text to printable ASCII plus newline. Accented letters lose their
 * accents (é → e), known letters are transliterated (ŋ → ng), and anything
 * else is removed, or throws in strict mode.
 */
export function toUssdSafe(text, mode = "strip") {
    const removed = [];
    let out = "";
    for (const ch of text.replace(/\r\n?/g, "\n")) {
        if (isSafe(ch)) {
            out += ch;
            continue;
        }
        const mapped = TRANSLITERATE[ch] ?? stripMarks(ch);
        if (mapped !== null) {
            out += mapped;
            continue;
        }
        if (mode === "throw") {
            throw new BudgetError("unsafe_char", `Character ${JSON.stringify(ch)} cannot be shown on USSD`);
        }
        if (!removed.includes(ch))
            removed.push(ch);
    }
    return { text: out, removed, changed: out !== text };
}
function isSafe(ch) {
    if (ch === "\n")
        return true;
    const code = ch.codePointAt(0) ?? 0;
    return code >= 0x20 && code <= 0x7e;
}
function stripMarks(ch) {
    const base = ch.normalize("NFD").replace(/\p{M}/gu, "");
    return base !== "" && [...base].every(isSafe) ? base : null;
}
/**
 * Option numbers 1, 2, 3, … skipping reserved codes, so an option can never
 * collide with the telco's or our own navigation.
 */
export function optionNumbers(count, reserved = DEFAULT_USSD_BUDGET.reserved) {
    const numbers = [];
    for (let n = 1; numbers.length < count; n++) {
        if (!reserved.includes(String(n)))
            numbers.push(String(n));
    }
    return numbers;
}
/**
 * Splits text into screens of at most `maxChars`. Every screen but the last
 * ends with `moreLine` (e.g. "98. More"). Breaks at whitespace where it can,
 * mid-word only when a single word is longer than a screen.
 */
export function paginateText(text, maxChars, moreLine) {
    if (text.length <= maxChars)
        return [text];
    const room = maxChars - moreLine.length - 1;
    if (room < 1) {
        throw new BudgetError("line_too_long", `A ${maxChars}-character screen has no room beside ${JSON.stringify(moreLine)}`);
    }
    const pages = [];
    let rest = text;
    while (rest.length > maxChars) {
        let cut = lastBreak(rest, room);
        if (cut <= 0)
            cut = room;
        pages.push(`${rest.slice(0, cut).trimEnd()}\n${moreLine}`);
        rest = rest.slice(cut).replace(/^[ \n]+/, "");
    }
    pages.push(rest);
    return pages;
}
function lastBreak(text, room) {
    // The break may sit exactly at `room` (the character after the fitted part).
    for (let i = Math.min(room, text.length - 1); i > 0; i--) {
        const ch = text[i];
        if (ch === " " || ch === "\n")
            return i;
    }
    return -1;
}
/**
 * Lays out a menu across screens. The head goes on the first page, items fill
 * pages in order, and every page but the last ends with `moreLine`.
 *
 * @throws BudgetError("line_too_long") when an item cannot fit on a page.
 */
export function paginateMenu({ head, items, maxChars, moreLine }) {
    const pages = [];
    let lines = [...head];
    let i = 0;
    while (i < items.length) {
        const fitsAll = size([...lines, ...items.slice(i)]) <= maxChars;
        if (fitsAll) {
            lines.push(...items.slice(i));
            i = items.length;
            break;
        }
        const start = i;
        while (i < items.length && size([...lines, items[i], moreLine]) <= maxChars) {
            lines.push(items[i]);
            i++;
        }
        if (i === start) {
            const what = lines.length > 0 && pages.length === 0 ? "The question and first option" : "A menu option";
            throw new BudgetError("line_too_long", `${what} do not fit on a ${maxChars}-character USSD screen: ${JSON.stringify(items[i])}`);
        }
        lines.push(moreLine);
        pages.push(lines.join("\n"));
        lines = [];
    }
    if (lines.length > 0 || pages.length === 0) {
        const page = lines.join("\n");
        if (page.length > maxChars) {
            throw new BudgetError("line_too_long", `Screen is ${page.length} characters; the limit is ${maxChars}`);
        }
        pages.push(page);
    }
    return pages;
}
function size(lines) {
    return lines.join("\n").length;
}