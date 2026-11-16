/**
 * Logging (docs/design.md §4.8). Phone numbers are personal data: the agent
 * masks them before they reach a logger unless masking is switched off.
 */

export type LogFields = Readonly<Record<string, unknown>>;

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
}

export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

const ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3, silent: 4 };

/** Writes to the console at or above `level` (default "info"). */
export function consoleLogger(level: LogLevel = "info"): Logger {
  const at = (l: Exclude<LogLevel, "silent">) => (message: string, fields?: LogFields) => {
    if (ORDER[l] < ORDER[level]) return;
    const line = `[kalangu] ${message}`;
    if (fields && Object.keys(fields).length > 0) console[l](line, fields);
    else console[l](line);
  };
  return { debug: at("debug"), info: at("info"), warn: at("warn"), error: at("error") };
}

export const silentLogger: Logger = consoleLogger("silent");

/**
 * Keeps the country prefix and the last four digits: `+254700001001` →
 * `+254••••••1001`. Short or unusual values are masked almost entirely.
 */
export function maskPhone(phone: string): string {
  const p = phone.trim();
  if (p.length <= 6) return "•".repeat(Math.max(p.length - 2, 0)) + p.slice(-2);
  const head = p.startsWith("+") ? p.slice(0, 4) : p.slice(0, 3);
  const tail = p.slice(-4);
  return head + "•".repeat(p.length - head.length - tail.length) + tail;
}
