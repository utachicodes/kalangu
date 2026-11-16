/**
 * A simulated keypad phone (docs/design.md §8). It drives the agent
 * directly, with no HTTP and no gateway, through a USSD-style channel for
 * screens and an SMS-style channel whose "sending" lands in the phone's inbox.
 */

import { smsChannel, ussdChannel, type Agent } from "@kalangu/core";

export interface SimPhoneOptions {
  /** The simulated subscriber's number. Default "+254700000001". */
  phone?: string;
  /** The service code that reaches the agent, e.g. "*384*1#". Any code works when omitted. */
  code?: string;
  /** Characters per USSD screen. Default 160. */
  maxScreenChars?: number;
  /** Shown in the terminal header only. Default "Safaricom KE". */
  operator?: string;
  /** Sender name shown on SMS from the agent. Default "AGENT". */
  sender?: string;
}

export interface Screen {
  text: string;
  /** True when the session ended with this screen. */
  end: boolean;
}

export interface SimSms {
  from: string;
  text: string;
  at: Date;
}

export const SIM_USSD_CHANNEL = "sim-ussd";
export const SIM_SMS_CHANNEL = "sim-sms";

export class SimPhone {
  readonly number: string;
  readonly operator: string;
  readonly sender: string;
  readonly inbox: SimSms[] = [];
  /** The agent rewired to the simulator's channels. */
  readonly agent: Agent;

  private readonly code: string | undefined;
  private listeners: Array<(sms: SimSms) => void> = [];
  private session: { id: string; inputs: string[] } | null = null;
  private sessions = 0;

  constructor(agent: Agent, options: SimPhoneOptions = {}) {
    this.number = options.phone ?? "+254700000001";
    this.operator = options.operator ?? "Safaricom KE";
    this.sender = options.sender ?? "AGENT";
    this.code = options.code;
    this.agent = agent.withChannels([
      ussdChannel({
        id: SIM_USSD_CHANNEL,
        ...(options.maxScreenChars !== undefined ? { budget: { maxChars: options.maxScreenChars } } : {}),
      }),
      smsChannel({
        id: SIM_SMS_CHANNEL,
        send: async (out) => {
          if (out.to === this.number) this.receive(out.text);
        },
      }),
    ]);
  }

  get inSession(): boolean {
    return this.session !== null;
  }

  /**
   * Dials a service code. A code with choices in it (`*384*1*2#`) carries
   * them in, as on a real network.
   */
  async dial(code: string): Promise<Screen> {
    const inputs = this.parseCode(code.trim());
    if (inputs === null) {
      return { text: "Connection problem or invalid MMI code.", end: true };
    }
    this.sessions += 1;
    this.session = { id: `sim-${this.sessions}`, inputs };
    return this.exchange(inputs.at(-1) ?? "", inputs.length === 0);
  }

  /** Sends a reply in the current session. */
  async press(input: string): Promise<Screen> {
    if (!this.session) throw new Error("No USSD session; dial a code first");
    this.session.inputs.push(input);
    return this.exchange(input, false);
  }

  /** Drops the session, as when the user cancels or the network times out. */
  hangUp(): void {
    this.session = null;
  }

  /** Sends an SMS to the agent; its reply, if any, lands in the inbox. */
  async sendSms(text: string): Promise<void> {
    const outcome = await this.agent.handle({ channel: SIM_SMS_CHANNEL, phone: this.number, input: text });
    this.receive(outcome.text);
  }

  /** Calls `listener` for every SMS that arrives. Returns an unsubscribe function. */
  onSms(listener: (sms: SimSms) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private async exchange(input: string, newSession: boolean): Promise<Screen> {
    const session = this.session;
    if (!session) throw new Error("No USSD session");
    const outcome = await this.agent.handle({
      channel: SIM_USSD_CHANNEL,
      phone: this.number,
      input,
      inputs: [...session.inputs],
      newSession,
      gatewaySessionId: session.id,
    });
    if (outcome.end) this.session = null;
    return { text: outcome.text, end: outcome.end };
  }

  private receive(text: string): void {
    const sms: SimSms = { from: this.sender, text, at: new Date() };
    this.inbox.push(sms);
    for (const listener of this.listeners) listener(sms);
  }

  /** The inputs carried by a dialed code, or null when it doesn't reach the agent. */
  private parseCode(code: string): string[] | null {
    if (!/^\*[0-9*#]*#$/.test(code)) return null;
    if (!this.code) return [];
    if (code === this.code) return [];
    const prefix = this.code.slice(0, -1) + "*";
    if (!code.startsWith(prefix)) return null;
    return code.slice(prefix.length, -1).split("*");
  }
}

export function createPhone(agent: Agent, options: SimPhoneOptions = {}): SimPhone {
  return new SimPhone(agent, options);
}
