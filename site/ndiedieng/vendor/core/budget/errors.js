/**
 * Raised when output cannot be fitted to a channel without losing text.
 * The budgeter never truncates silently; this is what it does instead.
 */
export class BudgetError extends Error {
    name = "BudgetError";
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}