import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ask, createAgent, menu, say, type Logger } from "@kalangu/core";
import {
  SmsSendError,
  africasTalkingSms,
  legacyEndpoint,
  legacyTransport,
  parseDeliveryReport,
  parseIncoming,
  parseSendResponse,
  type DeliveryReport,
  type OutboundSms,
  type SmsTransport,
} from "../src/index.js";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

const post = (body: string, path: string) =>
  new Request(`https://example.test${path}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });

function fakeFetch(status: number, body: string) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(body, { status });
  }) as typeof fetch;
  return { fn, calls };
}

function recordingLogger() {
  const lines: Array<{ level: string; message: string; fields?: unknown }> = [];
  const at = (level: string) => (message: string, fields?: unknown) => lines.push({ level, message, fields });
  const logger: Logger = { debug: at("debug"), info: at("info"), warn: at("warn"), error: at("error") };
  return { logger, lines };
}

function memoryTransport() {
  const sent: OutboundSms[] = [];
  const transport: SmsTransport = {
    async send(sms) {
      sent.push(sms);
      return { message: "ok", recipients: [] };
    },
  };
  return { transport, sent };
}

const clinic = menu("Clinic line", {
  "Opening hours": say("Open Monday to Saturday, 8:00 to 18:00."),
  "Ask a nurse": ask("Type your question", (q) => `You asked: ${q}`),
});

/** Runs background work inline and lets tests wait for it. */
function drainable() {
  const pending: Promise<void>[] = [];
  return {
    track: (agent: ReturnType<typeof createAgent>) => {
      const original = agent.background;
      return {
        ...agent,
        background: (task: () => Promise<void>) => {
          const p = new Promise<void>((resolve) => original(() => task().finally(resolve)));
          pending.push(p);
        },
      };
    },
    drain: () => Promise.all(pending),
  };
}

describe("legacy transport", () => {
  it("posts the documented form to the legacy endpoint", async () => {
    const { fn, calls } = fakeFetch(201, fixture("send-201.json"));
    const transport = legacyTransport({ username: "clinic", apiKey: "k3y", fetch: fn });
    const result = await transport.send({ to: ["+254700000001"], message: "Hello", from: "CLINIC" });

    expect(calls[0]?.url).toBe("https://api.africastalking.com/version1/messaging");
    const init = calls[0]?.init as RequestInit;
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      apiKey: "k3y",
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    });
    expect(Object.fromEntries(init.body as URLSearchParams)).toEqual({
      username: "clinic",
      to: "+254700000001",
      message: "Hello",
      from: "CLINIC",
      bulkSMSMode: "1",
    });
    expect(result.recipients[0]).toEqual({
      number: "+254700000001",
      status: "Success",
      statusCode: 101,
      cost: "KES 0.8000",
      messageId: "ATXid_test_0101",
    });
  });

  it("uses the sandbox domain and passes enqueue only when set", async () => {
    const { fn, calls } = fakeFetch(201, fixture("send-201.json"));
    await legacyTransport({ username: "sandbox", apiKey: "k", sandbox: true, enqueue: true, fetch: fn }).send({
      to: ["+254700000001", "+254700000002"],
      message: "Hi",
    });
    expect(calls[0]?.url).toBe(legacyEndpoint(true));
    expect(calls[0]?.url).toBe("https://api.sandbox.africastalking.com/version1/messaging");
    const body = calls[0]?.init.body as URLSearchParams;
    expect(body.get("enqueue")).toBe("1");
    expect(body.get("to")).toBe("+254700000001,+254700000002");
    expect(body.has("from")).toBe(false);
  });

  it("surfaces a recipient refusal verbatim, including Nigeria's DND 409", async () => {
    const { fn } = fakeFetch(201, fixture("send-409-dnd.json"));
    const err = await legacyTransport({ username: "u", apiKey: "k", fetch: fn })
      .send({ to: ["+234800000001"], message: "Promo" })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SmsSendError);
    expect(err).toMatchObject({ statusCode: 409, status: "DoNotDisturbRejection", httpStatus: 201 });
  });

  it("surfaces HTTP errors with the body", async () => {
    const { fn } = fakeFetch(401, "The supplied authentication is invalid");
    await expect(
      legacyTransport({ username: "u", apiKey: "bad", fetch: fn }).send({ to: ["+254700000001"], message: "x" }),
    ).rejects.toMatchObject({ httpStatus: 401, message: expect.stringContaining("authentication is invalid") });
  });

  it("rejects malformed responses and empty recipient lists", async () => {
    expect(() => parseSendResponse("<html>")).toThrow(SmsSendError);
    expect(() => parseSendResponse("{}")).toThrow(/SMSMessageData/);
    const { fn } = fakeFetch(201, '{"SMSMessageData":{"Message":"InvalidSenderId","Recipients":[]}}');
    await expect(
      legacyTransport({ username: "u", apiKey: "k", fetch: fn }).send({ to: ["+254700000001"], message: "x" }),
    ).rejects.toThrow(/InvalidSenderId/);
  });

  it("refuses to send to nobody", async () => {
    const { fn } = fakeFetch(201, fixture("send-201.json"));
    await expect(legacyTransport({ username: "u", apiKey: "k", fetch: fn }).send({ to: [], message: "x" })).rejects.toThrow(
      TypeError,
    );
  });
});

describe("channel", () => {
  it("needs credentials or a transport", () => {
    expect(() => africasTalkingSms({})).toThrow(/username/);
    expect(() => africasTalkingSms({ transport: memoryTransport().transport })).not.toThrow();
  });

  it("sends with the sender id", async () => {
    const { transport, sent } = memoryTransport();
    await africasTalkingSms({ transport, senderId: "CLINIC" }).send({ to: "+254700000001", text: "Hi" });
    expect(sent).toEqual([{ to: ["+254700000001"], message: "Hi", from: "CLINIC" }]);
  });

  it("refuses a direct send over its segment cap, sending nothing", async () => {
    const { transport, sent } = memoryTransport();
    const channel = africasTalkingSms({ transport, maxSegments: 1 });
    await expect(channel.send({ to: "+254700000001", text: "x".repeat(161) })).rejects.toThrow(/cap is 1/);
    expect(sent).toEqual([]);
  });

  it("uses its segment cap when rendering", () => {
    const channel = africasTalkingSms({ transport: memoryTransport().transport, maxSegments: 1 });
    const t = () => "";
    expect(() => channel.render({ kind: "say", text: "x".repeat(161) }, { t, page: 0 })).toThrow(/cap is 1/);
  });
});

describe("incoming messages", () => {
  it("parses the documented fields", () => {
    expect(parseIncoming(new URLSearchParams(fixture("incoming.form")))).toEqual({
      from: "+254700000001",
      to: "12345",
      text: "hello",
      id: "ATXid_test_0001",
      date: "2026-11-16 10:00:00",
      networkCode: "63902",
    });
  });

  it("answers 200 at once and replies by SMS", async () => {
    const { transport, sent } = memoryTransport();
    const sms = africasTalkingSms({ transport, senderId: "CLINIC" });
    const { logger } = recordingLogger();
    const { track, drain } = drainable();
    const agent = track(createAgent({ start: clinic, channels: [sms], logger }));

    const res = await sms.handler(agent)(post(fixture("incoming.form"), "/sms"));
    expect(res.status).toBe(200);
    await drain();
    expect(sent[0]).toEqual({
      to: ["+254700000001"],
      from: "CLINIC",
      message: "Clinic line\n1. Opening hours\n2. Ask a nurse",
    });

    await sms.handler(agent)(post(fixture("incoming.form").replace("text=hello", "text=1"), "/sms"));
    await drain();
    expect(sent[1]?.message).toBe("Open Monday to Saturday, 8:00 to 18:00.");
  });

  it("is reachable through the agent's request handler", async () => {
    const { transport } = memoryTransport();
    const agent = createAgent({ start: clinic, channels: [africasTalkingSms({ transport })] });
    expect((await agent.requestHandler(post(fixture("incoming.form"), "/sms"))).status).toBe(200);
  });

  it("logs a failed reply with a masked number", async () => {
    const failing: SmsTransport = {
      send: async () => {
        throw new SmsSendError("refused", { statusCode: 406, status: "UserInBlacklist" });
      },
    };
    const sms = africasTalkingSms({ transport: failing });
    const { logger, lines } = recordingLogger();
    const { track, drain } = drainable();
    const agent = track(createAgent({ start: clinic, channels: [sms], logger }));
    await sms.handler(agent)(post(fixture("incoming.form"), "/sms"));
    await drain();
    expect(lines.find((l) => l.message === "SMS reply failed")?.fields).toEqual({
      phone: "+254•••••0001",
      error: "SmsSendError: refused (statusCode 406)",
    });
    expect(JSON.stringify(lines)).not.toContain("+254700000001");
  });

  it("ignores messages without a sender", async () => {
    const { transport, sent } = memoryTransport();
    const sms = africasTalkingSms({ transport });
    const { logger, lines } = recordingLogger();
    const agent = createAgent({ start: clinic, channels: [sms], logger });
    expect((await sms.handler(agent)(post("text=hi", "/sms"))).status).toBe(200);
    expect(sent).toHaveLength(0);
    expect(lines.some((l) => l.message === "Incoming SMS without a sender")).toBe(true);
  });

  it("refuses non-POST requests", async () => {
    const sms = africasTalkingSms({ transport: memoryTransport().transport });
    const agent = createAgent({ start: clinic, channels: [sms] });
    expect((await agent.requestHandler(new Request("https://example.test/sms"))).status).toBe(405);
  });
});

describe("delivery reports", () => {
  it("parses reports", () => {
    expect(parseDeliveryReport(new URLSearchParams(fixture("delivery-rejected.form")))).toEqual({
      id: "ATXid_test_0102",
      phoneNumber: "+234800000001",
      networkCode: "62120",
      status: "Rejected",
      failureReason: "DeliveryFailure",
    });
  });

  it("logs success as info and final failures as warnings, then calls the hook", async () => {
    const seen: DeliveryReport[] = [];
    const sms = africasTalkingSms({ transport: memoryTransport().transport, onDeliveryReport: (r) => void seen.push(r) });
    const { logger, lines } = recordingLogger();
    const agent = createAgent({ start: clinic, channels: [sms], logger });

    await agent.requestHandler(post(fixture("delivery-success.form"), "/sms/delivery"));
    await agent.requestHandler(post(fixture("delivery-rejected.form"), "/sms/delivery"));

    expect(seen.map((r) => r.status)).toEqual(["Success", "Rejected"]);
    expect(lines.find((l) => l.message === "SMS delivery report")?.level).toBe("info");
    expect(lines.find((l) => l.message === "SMS not delivered")).toMatchObject({
      level: "warn",
      fields: { phone: "+234•••••0001", status: "Rejected", failureReason: "DeliveryFailure" },
    });
  });

  it("can be turned off", async () => {
    const sms = africasTalkingSms({ transport: memoryTransport().transport, deliveryPath: false });
    const agent = createAgent({ start: clinic, channels: [sms] });
    expect((await agent.requestHandler(post(fixture("delivery-success.form"), "/sms/delivery"))).status).toBe(404);
  });
});
