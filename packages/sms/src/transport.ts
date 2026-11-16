/**
 * The HTTP call that sends an SMS, behind a seam (docs/design.md §7.2) so
 * the newer JSON bulk endpoint can replace the legacy one without touching
 * the channel.
 */

export interface OutboundSms {
  to: readonly string[];
  message: string;
  /** Sender ID or short code. */
  from?: string;
}

export interface SmsRecipient {
  number: string;
  status: string;
  statusCode: number;
  cost: string;
  messageId: string;
}

export interface SendResult {
  /** The gateway's summary line, e.g. "Sent to 1/1 Total Cost: KES 0.8000". */
  message: string;
  recipients: SmsRecipient[];
}

export interface SmsTransport {
  send(sms: OutboundSms): Promise<SendResult>;
}

/**
 * A send the gateway refused, with its own codes kept verbatim, e.g.
 * `statusCode: 409, status: "DoNotDisturbRejection"` for Nigeria's DND rules.
 */
export class SmsSendError extends Error {
  override readonly name = "SmsSendError";
  readonly httpStatus: number | undefined;
  readonly statusCode: number | undefined;
  readonly status: string | undefined;
  readonly recipients: SmsRecipient[];

  constructor(
    message: string,
    details: { httpStatus?: number; statusCode?: number; status?: string; recipients?: SmsRecipient[] } = {},
  ) {
    super(message);
    this.httpStatus = details.httpStatus;
    this.statusCode = details.statusCode;
    this.status = details.status;
    this.recipients = details.recipients ?? [];
  }
}

/** Recipient codes that mean the gateway accepted the message (not that it was delivered). */
export const ACCEPTED_STATUS_CODES: readonly number[] = [100, 101, 102];

export interface LegacyTransportOptions {
  username: string;
  apiKey: string;
  /** Use api.sandbox.africastalking.com. Default false. */
  sandbox?: boolean;
  /** 1 bills as bulk SMS, matching the official SDK default. */
  bulkSmsMode?: 0 | 1;
  /** Passed only when set. */
  enqueue?: boolean;
  fetch?: typeof fetch;
}

export function legacyEndpoint(sandbox = false): string {
  return `https://api.${sandbox ? "sandbox." : ""}africastalking.com/version1/messaging`;
}

/**
 * `POST /version1/messaging`, form-encoded: the endpoint the official SDK
 * uses and the sandbox supports. Success is HTTP 201.
 */
export function legacyTransport(options: LegacyTransportOptions): SmsTransport {
  const doFetch = options.fetch ?? globalThis.fetch;
  const url = legacyEndpoint(options.sandbox);

  return {
    async send(sms) {
      if (sms.to.length === 0) throw new TypeError("An SMS needs at least one recipient");
      const body = new URLSearchParams({
        username: options.username,
        to: sms.to.join(","),
        message: sms.message,
        bulkSMSMode: String(options.bulkSmsMode ?? 1),
      });
      if (sms.from) body.set("from", sms.from);
      if (options.enqueue !== undefined) body.set("enqueue", options.enqueue ? "1" : "0");

      const res = await doFetch(url, {
        method: "POST",
        headers: {
          apiKey: options.apiKey,
          accept: "application/json",
          "content-type": "application/x-www-form-urlencoded",
        },
        body,
      });
      const raw = await res.text();

      if (res.status !== 201 && res.status !== 200) {
        throw new SmsSendError(`SMS send failed with HTTP ${res.status}: ${raw.slice(0, 200)}`, {
          httpStatus: res.status,
        });
      }

      const result = parseSendResponse(raw, res.status);
      const refused = result.recipients.filter((r) => !ACCEPTED_STATUS_CODES.includes(r.statusCode));
      if (result.recipients.length === 0) {
        throw new SmsSendError(`SMS send accepted no recipients: ${result.message}`, { httpStatus: res.status });
      }
      if (refused.length > 0) {
        const first = refused[0] as SmsRecipient;
        throw new SmsSendError(
          `SMS refused for ${refused.length} recipient(s): ${first.statusCode} ${first.status}`,
          { httpStatus: res.status, statusCode: first.statusCode, status: first.status, recipients: result.recipients },
        );
      }
      return result;
    },
  };
}

/** Reads the legacy endpoint's JSON response. */
export function parseSendResponse(raw: string, httpStatus = 201): SendResult {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new SmsSendError(`SMS send returned a body that isn't JSON: ${raw.slice(0, 200)}`, { httpStatus });
  }
  const data = (json as { SMSMessageData?: { Message?: unknown; Recipients?: unknown } }).SMSMessageData;
  if (!data || typeof data !== "object") {
    throw new SmsSendError("SMS send response has no SMSMessageData", { httpStatus });
  }
  const recipients = Array.isArray(data.Recipients) ? data.Recipients : [];
  return {
    message: typeof data.Message === "string" ? data.Message : "",
    recipients: recipients.map((r: Record<string, unknown>) => ({
      number: String(r["number"] ?? ""),
      status: String(r["status"] ?? ""),
      statusCode: Number(r["statusCode"]),
      cost: String(r["cost"] ?? ""),
      messageId: String(r["messageId"] ?? ""),
    })),
  };
}
