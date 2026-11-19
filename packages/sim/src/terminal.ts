/**
 * The terminal front end for `SimPhone`: dial, read boxed screens, answer,
 * and watch SMS arrive. Commands: `x` hangs up, `sms <text>` texts the
 * agent, `q` quits.
 */

import { createInterface } from "node:readline";
import type { Agent } from "@kalangu/core";
import { SimPhone, type Screen, type SimPhoneOptions, type SimSms } from "./phone.js";

export interface TerminalOptions extends SimPhoneOptions {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  /** Width of the screen box's text area. Default 34. */
  width?: number;
}

/** Runs the simulator until the user quits or input ends. */
export function runTerminal(agent: Agent, options: TerminalOptions = {}): Promise<SimPhone> {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const width = options.width ?? 34;
  const phone = new SimPhone(agent, options);
  const tty = (output as { isTTY?: boolean }).isTTY === true;
  const rl = createInterface({ input, output, terminal: tty });

  const write = (text: string) => output.write(`${text}\n`);
  let prompt = "Dial> ";
  let busy = false;

  const showPrompt = () => {
    rl.setPrompt(prompt);
    rl.prompt();
  };

  phone.onSms((sms) => {
    // Print above whatever the user is typing, then restore the prompt.
    if (tty) output.write("\r\x1b[K");
    else output.write("\n");
    write(formatSms(sms));
    if (!busy) showPrompt();
  });

  write(`│ Simulated phone: ${formatNumber(phone.number)} (${phone.operator})`);
  write(
    `│ Dial ${options.code ?? "a code such as *384#"} · x hangs up · sms <text> texts the agent · q quits`,
  );
  write("│ After a screen marked END, dial again. Replies to an SMS start with sms, e.g. sms 1");
  showPrompt();

  return new Promise((resolve) => {
    let queue = Promise.resolve();
    rl.on("line", (line) => {
      queue = queue.then(async () => {
        busy = true;
        const keep = await handleLine(line.trim());
        busy = false;
        if (keep) showPrompt();
        else rl.close();
      });
    });
    rl.on("close", () => {
      void queue.then(() => resolve(phone));
    });
  });

  async function handleLine(line: string): Promise<boolean> {
    if (line === "q") return false;
    if (line === "x") {
      if (phone.inSession) write("… hung up. Dial again to resume where you left off.");
      phone.hangUp();
      prompt = "Dial> ";
      return true;
    }
    if (line.startsWith("sms ")) {
      await phone.sendSms(line.slice(4));
      return true;
    }
    if (line === "") return true;

    let screen: Screen;
    const dialling = !phone.inSession;
    try {
      screen = dialling ? await phone.dial(line) : await phone.press(line);
    } catch (err) {
      write(`! ${err instanceof Error ? err.message : String(err)}`);
      return true;
    }
    write(box(screen, width));
    if (dialling && !line.startsWith("*")) {
      // What a real phone says, then what the person most likely meant.
      write(`→ Not a code. Dial ${options.code ?? "a code such as *384#"} to start, or reply by SMS with: sms ${line}`);
    }
    prompt = screen.end ? "Dial> " : looksLikeMenu(screen.text) ? "Choice> " : "Input> ";
    return true;
  }
}

/** Draws a screen in a box, wrapping long lines. Final screens show `END`. */
export function box(screen: Screen, width = 34): string {
  const text = screen.end ? `END ${screen.text}` : screen.text;
  const lines = text.split("\n").flatMap((line) => wrap(line, width));
  const edge = "─".repeat(width + 2);
  return [`┌${edge}┐`, ...lines.map((l) => `│ ${l.padEnd(width)} │`), `└${edge}┘`].join("\n");
}

export function formatSms(sms: SimSms): string {
  return `✉ SMS from ${sms.from}: ${sms.text}`;
}

function wrap(line: string, width: number): string[] {
  if (line.length <= width) return [line];
  const out: string[] = [];
  let current = "";
  for (const word of line.split(" ")) {
    if (word.length > width) {
      if (current) out.push(current);
      for (let i = 0; i < word.length; i += width) out.push(word.slice(i, i + width));
      current = out.pop() ?? "";
      continue;
    }
    if (current === "") current = word;
    else if (current.length + 1 + word.length <= width) current += ` ${word}`;
    else {
      out.push(current);
      current = word;
    }
  }
  if (current) out.push(current);
  return out;
}

function looksLikeMenu(text: string): boolean {
  return text.split("\n").some((line) => /^\d+\. /.test(line));
}

function formatNumber(phone: string): string {
  const m = /^\+(\d{3})(\d{3})(\d{3})(\d{3})$/.exec(phone);
  return m ? `+${m[1]} ${m[2]} ${m[3]} ${m[4]}` : phone;
}
