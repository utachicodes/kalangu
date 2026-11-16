/**
 * Africa's Talking USSD adapter (docs/design.md §7.1).
 *
 * The gateway POSTs form fields on every dial and every reply, and expects
 * `200 text/plain` starting `CON ` (continue) or `END ` (finish). Anything
 * else ends the user's session, so every path here answers with a valid
 * body, including errors.
 *
 * Callbacks are not signed. Treat them as untrusted input: use a hard-to-
 * guess path and, where you can, allow only the gateway's IP addresses.
 */

import { ussdChannel, type Channel, type Outcome, type Route, type RouteAgent } from "@kalangu/core";

export interface AfricasTalkingUssdOptions {
  /** Channel id. Default "ussd". */
  id?: string;
  /** Your service code, e.g. "*384*1#". Requests for another code are logged. */
  code?: string;
  /** Callback path. Default "/ussd". */
  path?: string;
  /** Session-end notification path, or false for none. Default "/ussd/end". */
  endPath?: string | false;
  /** Characters per screen. Default 160 (Safaricom KE, Nigeria); Airtel KE allows 184. */
  maxScreenChars?: number;
  /** The number for "More". Default "98". */
  more?: string;
  /** Characters with no safe form: strip with a warning (default) or throw. */
  unsafeChars?: "strip" | "throw";
  /**
   * Send the step id in the `at-ussd-hop-metadata` header for journey
   * tracking in the gateway dashboard. Contains no personal data. Default off.
   */
  hopMetadata?: boolean;
  /** Called with each session-end notification after it is logged. */
  onSessionEnd?: (notification: SessionEndNotification) => void | Promise<void>;
}

export interface UssdRequest {
  sessionId: string;
  phoneNumber: string;
  networkCode: string;
  serviceCode: string;
  /** Everything typed this session, `*`-joined; empty on the first request. */
  text: string;
}

export interface SessionEndNotification {
  sessionId: string;
  phoneNumber: string;
  networkCode: string;
  serviceCode: string;
  date: string;
  status: "Incomplete" | "Success" | "Failed" | (string & {});
  cost: string;
  durationInMillis: number | null;
  hopsCount: number | null;
  hopsMetadata: string[];
  input: string;
  lastAppResponse: string;
  errorMessage?: string;
}

export type AfricasTalkingUssdChannel = Channel & {
  /** This channel's callback handler, for mounting it yourself. */
  handler(agent: RouteAgent): (req: Request) => Promise<Response>;
};

const HOP_HEADER = "at-ussd-hop-metadata";

export function africasTalkingUssd(options: AfricasTalkingUssdOptions = {}): AfricasTalkingUssdChannel {
  const path = options.path ?? "/ussd";
  const endPath = options.endPath === undefined ? "/ussd/end" : options.endPath;

  const callback: Route = {
    path,
    handle: (req, agent) => handleCallback(req, agent, channel.id, options),
  };
  const routes: Route[] = [callback];
  if (endPath) routes.push({ path: endPath, handle: (req, agent) => handleSessionEnd(req, agent, options) });

  const base = ussdChannel({
    id: options.id ?? "ussd",
    budget: {
      ...(options.maxScreenChars !== undefined ? { maxChars: options.maxScreenChars } : {}),
      ...(options.more !== undefined ? { more: options.more } : {}),
      ...(options.unsafeChars !== undefined ? { unsafeChars: options.unsafeChars } : {}),
    },
    routes,
  });
  const channel: AfricasTalkingUssdChannel = {
    ...base,
    handler: (agent) => (req) => callback.handle(req, agent),
  };
  return channel;
}

/** Reads the gateway's form fields. Missing fields become empty strings. */
export function parseUssdRequest(form: FormData | URLSearchParams): UssdRequest {
  const field = (name: string) => {
    const value = form.get(name);
    return typeof value === "string" ? value : "";
  };
  return {
    sessionId: field("sessionId"),
    phoneNumber: field("phoneNumber"),
    networkCode: field("networkCode"),
    serviceCode: field("serviceCode"),
    text: field("text"),
  };
}

/**
 * The inputs typed so far, oldest first. A `*` typed inside free text also
 * splits here; the gateway sends no way to tell the two apart.
 */
export function ussdInputs(text: string): string[] {
  return text === "" ? [] : text.split("*");
}

/** `CON body` or `END body`, with the trailing space the official SDK sends. */
export function ussdBody(outcome: Pick<Outcome, "text" | "end">): string {
  return `${outcome.end ? "END" : "CON"} ${outcome.text}`;
}

async function handleCallback(
  req: Request,
  agent: RouteAgent,
  channelId: string,
  options: AfricasTalkingUssdOptions,
): Promise<Response> {
  if (req.method !== "POST") return methodNotAllowed();

  let request: UssdRequest;
  try {
    request = parseUssdRequest(await req.formData());
  } catch (err) {
    agent.logger.warn("Unreadable USSD callback body", { error: String(err) });
    return reply({ text: agent.errorText(), end: true, stepId: null, deferred: false }, false);
  }

  if (!request.phoneNumber) {
    agent.logger.warn("USSD callback without a phone number", { sessionId: request.sessionId });
    return reply({ text: agent.errorText(), end: true, stepId: null, deferred: false }, false);
  }
  if (options.code && request.serviceCode && request.serviceCode !== options.code) {
    agent.logger.warn("USSD callback for an unexpected service code", {
      expected: options.code,
      received: request.serviceCode,
    });
  }

  const inputs = ussdInputs(request.text);
  try {
    const outcome = await agent.handle({
      channel: channelId,
      phone: request.phoneNumber,
      input: inputs.at(-1) ?? "",
      inputs,
      newSession: request.text === "",
      ...(request.sessionId ? { gatewaySessionId: request.sessionId } : {}),
    });
    return reply(outcome, options.hopMetadata ?? false);
  } catch (err) {
    agent.logger.error("USSD turn failed", { phone: agent.mask(request.phoneNumber), error: String(err) });
    return reply({ text: agent.errorText(), end: true, stepId: null, deferred: false }, false);
  }
}

async function handleSessionEnd(
  req: Request,
  agent: RouteAgent,
  options: AfricasTalkingUssdOptions,
): Promise<Response> {
  if (req.method !== "POST") return methodNotAllowed();
  try {
    const notification = parseSessionEnd(await req.formData());
    agent.logger.info("USSD session ended", {
      phone: agent.mask(notification.phoneNumber),
      status: notification.status,
      durationInMillis: notification.durationInMillis,
      hopsCount: notification.hopsCount,
      ...(notification.errorMessage ? { errorMessage: notification.errorMessage } : {}),
    });
    await options.onSessionEnd?.(notification);
  } catch (err) {
    agent.logger.error("Session-end notification failed", { error: String(err) });
  }
  return new Response("OK", { status: 200, headers: { "content-type": "text/plain" } });
}

/** Reads a session-end notification's form fields. */
export function parseSessionEnd(form: FormData | URLSearchParams): SessionEndNotification {
  const field = (name: string) => {
    const value = form.get(name);
    return typeof value === "string" ? value : "";
  };
  const number = (name: string) => {
    const value = field(name);
    const n = Number(value);
    return value !== "" && Number.isFinite(n) ? n : null;
  };
  const notification: SessionEndNotification = {
    sessionId: field("sessionId"),
    phoneNumber: field("phoneNumber"),
    networkCode: field("networkCode"),
    serviceCode: field("serviceCode"),
    date: field("date"),
    status: field("status"),
    cost: field("cost"),
    durationInMillis: number("durationInMillis"),
    hopsCount: number("hopsCount"),
    hopsMetadata: field("hopsMetadata") === "" ? [] : field("hopsMetadata").split("|"),
    input: field("input"),
    lastAppResponse: field("lastAppResponse"),
  };
  const errorMessage = field("errorMessage");
  if (errorMessage) notification.errorMessage = errorMessage;
  return notification;
}

function reply(outcome: Outcome, hopMetadata: boolean): Response {
  const headers = new Headers({ "content-type": "text/plain; charset=utf-8" });
  if (hopMetadata && outcome.stepId) {
    headers.set(HOP_HEADER, outcome.stepId.replace(/\|/g, "/").slice(0, 99));
  }
  return new Response(ussdBody(outcome), { status: 200, headers });
}

function methodNotAllowed(): Response {
  return new Response("Method not allowed", { status: 405, headers: { allow: "POST", "content-type": "text/plain" } });
}
