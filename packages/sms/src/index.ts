/**
 * Africa's Talking SMS adapter (docs/design.md §7.2): sends budgeted
 * messages, receives incoming messages, and logs delivery reports.
 *
 * Callbacks are not signed. Treat them as untrusted input: use a hard-to-
 * guess path and, where you can, allow only the gateway's IP addresses.
 */

import { budgetSms, smsChannel, type Channel, type Route, type RouteAgent } from "@kalangu/core";
import { legacyTransport, type SendResult, type SmsTransport } from "./transport.js";

export * from "./transport.js";

export interface AfricasTalkingSmsOptions {
  /** Channel id. Default "sms". */
  id?: string;
  /** Your Africa's Talking username ("sandbox" in the sandbox). */
  username?: string;
  apiKey?: string;
  /** Registered sender ID or short code. */
  senderId?: string;
  /** Incoming-message callback path, or false for none. Default "/sms". */
  path?: string | false;
  /** Delivery-report callback path, or false for none. Default "/sms/delivery". */
  deliveryPath?: string | false;
  /** Use the sandbox API. Default false. */
  sandbox?: boolean;
  /** Default 1, as in the official SDK. */
  bulkSmsMode?: 0 | 1;
  /** Passed to the gateway only when set. */
  enqueue?: boolean;
  /** Segment cap per message. Default 4. Longer replies are an error, never cut. */
  maxSegments?: number;
  /** Replaces the HTTP transport, e.g. for the JSON bulk endpoint or tests. */
  transport?: SmsTransport;
  fetch?: typeof fetch;
  onDeliveryReport?: (report: DeliveryReport) => void | Promise<void>;
  onIncoming?: (message: IncomingSms) => void | Promise<void>;
}

export interface IncomingSms {
  from: string;
  to: string;
  text: string;
  id: string;
  date: string;
  linkId?: string;
  networkCode?: string;
}

export type DeliveryStatus =
  | "Sent"
  | "Submitted"
  | "Buffered"
  | "Rejected"
  | "Success"
  | "Failed"
  | "AbsentSubscriber"
  | "Expired"
  | (string & {});

export interface DeliveryReport {
  /** Matches `messageId` from the send response. */
  id: string;
  phoneNumber: string;
  networkCode: string;
  status: DeliveryStatus;
  failureReason?: string;
}

export type AfricasTalkingSmsChannel = Channel & {
  send(out: { to: string; text: string }): Promise<void>;
  /** The transport, for sending outside a conversation. */
  readonly transport: SmsTransport;
  /** Incoming-message handler, for mounting it yourself. */
  handler(agent: RouteAgent): (req: Request) => Promise<Response>;
};

const FINAL_FAILURES = new Set(["Failed", "Rejected", "AbsentSubscriber", "Expired"]);

export function africasTalkingSms(options: AfricasTalkingSmsOptions): AfricasTalkingSmsChannel {
  const transport = options.transport ?? httpTransport(options);
  const id = options.id ?? "sms";
  const path = options.path === undefined ? "/sms" : options.path;
  const deliveryPath = options.deliveryPath === undefined ? "/sms/delivery" : options.deliveryPath;

  const send = async (out: { to: string; text: string }): Promise<void> => {
    // The cap holds for direct sends too, not only for conversation replies:
    // a message over it is an error here, never sent or cut.
    budgetSms(out.text, options.maxSegments !== undefined ? { maxSegments: options.maxSegments } : {});
    await sendOne(transport, out, options.senderId);
  };

  const incoming = (req: Request, agent: RouteAgent) => handleIncoming(req, agent, id, send, options);
  const routes: Route[] = [];
  if (path) routes.push({ path, handle: incoming });
  if (deliveryPath) routes.push({ path: deliveryPath, handle: (req, agent) => handleDelivery(req, agent, options) });

  const base = smsChannel({
    id,
    ...(options.maxSegments !== undefined ? { budget: { maxSegments: options.maxSegments } } : {}),
    send,
    routes,
  });
  return {
    ...base,
    send,
    transport,
    handler: (agent) => (req) => incoming(req, agent),
  };
}

function httpTransport(options: AfricasTalkingSmsOptions): SmsTransport {
  if (!options.username || !options.apiKey) {
    throw new TypeError("africasTalkingSms needs `username` and `apiKey`, or a custom `transport`");
  }
  if (options.sandbox && options.username !== "sandbox") {
    console.warn('[kalangu] Africa\'s Talking sandbox requests normally use the username "sandbox"');
  }
  return legacyTransport({
    username: options.username,
    apiKey: options.apiKey,
    ...(options.sandbox !== undefined ? { sandbox: options.sandbox } : {}),
    ...(options.bulkSmsMode !== undefined ? { bulkSmsMode: options.bulkSmsMode } : {}),
    ...(options.enqueue !== undefined ? { enqueue: options.enqueue } : {}),
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
}

async function sendOne(
  transport: SmsTransport,
  out: { to: string; text: string },
  from: string | undefined,
): Promise<SendResult> {
  return transport.send({ to: [out.to], message: out.text, ...(from ? { from } : {}) });
}

/** Reads an incoming-message callback's form fields. */
export function parseIncoming(form: FormData | URLSearchParams): IncomingSms {
  const field = fieldReader(form);
  const message: IncomingSms = {
    from: field("from"),
    to: field("to"),
    text: field("text"),
    id: field("id"),
    date: field("date"),
  };
  if (field("linkId")) message.linkId = field("linkId");
  if (field("networkCode")) message.networkCode = field("networkCode");
  return message;
}

/** Reads a delivery-report callback's form fields. */
export function parseDeliveryReport(form: FormData | URLSearchParams): DeliveryReport {
  const field = fieldReader(form);
  const report: DeliveryReport = {
    id: field("id"),
    phoneNumber: field("phoneNumber"),
    networkCode: field("networkCode"),
    status: field("status"),
  };
  if (field("failureReason")) report.failureReason = field("failureReason");
  return report;
}

async function handleIncoming(
  req: Request,
  agent: RouteAgent,
  channelId: string,
  send: (out: { to: string; text: string }) => Promise<void>,
  options: AfricasTalkingSmsOptions,
): Promise<Response> {
  if (req.method !== "POST") return methodNotAllowed();

  let message: IncomingSms;
  try {
    message = parseIncoming(await req.formData());
  } catch (err) {
    agent.logger.warn("Unreadable SMS callback body", { error: String(err) });
    return ok();
  }
  if (!message.from) {
    agent.logger.warn("Incoming SMS without a sender", { id: message.id });
    return ok();
  }

  // Answer the gateway now; the agent's reply goes out as a new message.
  agent.background(async () => {
    await options.onIncoming?.(message);
    const outcome = await agent.handle({ channel: channelId, phone: message.from, input: message.text });
    try {
      await send({ to: message.from, text: outcome.text });
    } catch (err) {
      agent.logger.error("SMS reply failed", { phone: agent.mask(message.from), error: describe(err) });
    }
  });
  return ok();
}

async function handleDelivery(req: Request, agent: RouteAgent, options: AfricasTalkingSmsOptions): Promise<Response> {
  if (req.method !== "POST") return methodNotAllowed();
  try {
    const report = parseDeliveryReport(await req.formData());
    const fields = {
      id: report.id,
      phone: agent.mask(report.phoneNumber),
      status: report.status,
      ...(report.failureReason ? { failureReason: report.failureReason } : {}),
    };
    if (FINAL_FAILURES.has(report.status)) agent.logger.warn("SMS not delivered", fields);
    else agent.logger.info("SMS delivery report", fields);
    await options.onDeliveryReport?.(report);
  } catch (err) {
    agent.logger.error("Delivery report failed", { error: describe(err) });
  }
  return ok();
}

function fieldReader(form: FormData | URLSearchParams) {
  return (name: string) => {
    const value = form.get(name);
    return typeof value === "string" ? value : "";
  };
}

function describe(err: unknown): string {
  if (err instanceof Error) {
    const code = (err as { statusCode?: unknown }).statusCode;
    return code !== undefined ? `${err.name}: ${err.message} (statusCode ${String(code)})` : `${err.name}: ${err.message}`;
  }
  return String(err);
}

function ok(): Response {
  return new Response("OK", { status: 200, headers: { "content-type": "text/plain" } });
}

function methodNotAllowed(): Response {
  return new Response("Method not allowed", { status: 405, headers: { allow: "POST", "content-type": "text/plain" } });
}
