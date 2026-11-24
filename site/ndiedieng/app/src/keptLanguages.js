/**
 * Keeps the language each chief chose, so a demo saved and reopened (the
 * website's, in the browser) does not ask it again. Only the language is
 * kept: a conversation in progress is not.
 */
import { freshRecord } from "@kalangu/core";
/**
 * `inner`, noting in `chosen` every language a chief picks, and starting
 * each number in `chosen` with its language already picked.
 */
export async function keepingLanguages(inner, chosen, now = Date.now()) {
    for (const [phone, locale] of chosen) {
        if (!(await inner.load(phone)))
            await inner.save({ ...freshRecord(phone, locale, now), languageChosen: true });
    }
    return {
        load: (phone) => inner.load(phone),
        async save(record, options) {
            await inner.save(record, options);
            if (record.languageChosen)
                chosen.set(record.phone, record.locale);
        },
        clear: (phone) => inner.clear(phone),
        ...(inner.atomic ? { atomic: true } : {}),
    };
}
