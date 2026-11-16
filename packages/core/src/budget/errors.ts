export type BudgetErrorCode =
  /** An SMS needs more segments than the configured cap. */
  | "sms_too_long"
  /** A USSD line that cannot be split (a menu option, a question) is longer than a screen. */
  | "line_too_long"
  /** A character outside the USSD safe set, in strict mode. */
  | "unsafe_char";

/**
 * Raised when output cannot be fitted to a channel without losing text.
 * The budgeter never truncates silently; this is what it does instead.
 */
export class BudgetError extends Error {
  override readonly name = "BudgetError";
  readonly code: BudgetErrorCode;

  constructor(code: BudgetErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}
