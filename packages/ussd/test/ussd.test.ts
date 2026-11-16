import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ask, createAgent, menu, say, type Logger } from "@kalangu/core";
import {
  africasTalkingUssd,
  parseSessionEnd,
  parseUssdRequest,
  ussdBody,
  ussdInputs,
  type SessionEndNotification,
} from "../src/index.js";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

const post = (body: string, path = "/ussd") =>
  new Request(`https://example.test${path}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });

function recordingLogger() {
  const lines: Array<{ level: string; message: string; fields?: unknown }> = [];
  const at = (level: string) => (message: string, fields?: unknown) => lines.push({ level, message, fields });
  const logger: Logger = { debug: at("debug"), info: at("info"), warn: at("warn"), error: at("error") };
  return { logger, lines };
}

const clinic = menu("Clinic line", {
  "Opening hours": menu("Hours", { Weekdays: say("8:00 to 18:00"), Sunday: say("Closed") }),
  "Ask a nurse": ask("Type your question", (q) => `You asked: ${q}`),
});

function setup(options: Parameters<typeof africasTalkingUssd>[0] = {}) {
  const { logger, lines } = recordingLogger();
  const ussd = africasTalkingUssd({ code: "*384*1#", ...options });
  const agent = createAgent({ start: clinic, channels: [ussd], logger });
  return { agent, ussd, lines };
}

describe("parsing", () => {
  it("reads the documented callback fields", () => {
    expect(parseUssdRequest(new URLSearchParams(fixture("first-request.form")))).toEqual({
      sessionId: "ATUid_test_0001",
      phoneNumber: "+254700000001",
      networkCode: "63902",
      serviceCode: "*384*1#",
      text: "",
    });
  });

  it("splits cumulative input on *", () => {
    expect(ussdInputs("")).toEqual([]);
    expect(ussdInputs("1*1*abc")).toEqual(["1", "1", "abc"]);
    expect(ussdInputs("2*")).toEqual(["2", ""]);
  });

  it("prefixes CON and END with a trailing space", () => {
    expect(ussdBody({ text: "Hi", end: false })).toBe("CON Hi");
    expect(ussdBody({ text: "Bye", end: true })).toBe("END Bye");
  });

  it("reads session-end notifications", () => {
    const ok = parseSessionEnd(new URLSearchParams(fixture("session-end-success.form")));
    expect(ok).toMatchObject({
      status: "Success",
      durationInMillis: 14250,
      hopsCount: 3,
      hopsMetadata: ["start", "start.2", "start.2"],
      input: "2*Is the clinic open on Sunday?",
      lastAppResponse: "END You asked",
    });
    expect(ok.errorMessage).toBeUndefined();

    const failed = parseSessionEnd(new URLSearchParams(fixture("session-end-failed.form")));
    expect(failed).toMatchObject({ status: "Failed", hopsMetadata: [], errorMessage: "App response timeout" });
  });
});

describe("callback", () => {
  it("answers the first request with the start menu", async () => {
    const { agent } = setup();
    const res = await agent.requestHandler(post(fixture("first-request.form")));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(await res.text()).toBe("CON Clinic line\n1. Opening hours\n2. Ask a nurse");
    expect(res.headers.get("at-ussd-hop-metadata")).toBeNull();
  });

  it("takes the last * segment as this turn's input", async () => {
    const { agent } = setup();
    await agent.requestHandler(post(fixture("first-request.form")));
    expect(await (await agent.requestHandler(post(fixture("menu-choice.form")))).text()).toBe(
      "CON Type your question",
    );
    expect(await (await agent.requestHandler(post(fixture("free-text.form")))).text()).toBe(
      "END You asked: Is the clinic open on Sunday?",
    );
  });

  it("replays a dial string whose first request already has choices", async () => {
    const { agent } = setup();
    expect(await (await agent.requestHandler(post(fixture("dial-string.form")))).text()).toBe("END 8:00 to 18:00");
  });

  it("resumes a dropped session when the user redials", async () => {
    const { agent } = setup();
    await agent.requestHandler(post(fixture("first-request.form")));
    await agent.requestHandler(post(fixture("menu-choice.form")));
    const redial = fixture("first-request.form").replace("ATUid_test_0001", "ATUid_test_0009");
    expect(await (await agent.requestHandler(post(redial))).text()).toBe("CON Type your question");
  });

  it("sends the step id as hop metadata when enabled", async () => {
    const { agent } = setup({ hopMetadata: true });
    await agent.requestHandler(post(fixture("first-request.form")));
    const res = await agent.requestHandler(post(fixture("menu-choice.form")));
    expect(res.headers.get("at-ussd-hop-metadata")).toBe("start.2");
  });

  it("respects a larger screen limit", async () => {
    const long = menu(
      "Pick",
      Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`Option with a longish label ${i + 1}`, say("ok")])),
    );
    const small = createAgent({ start: long, channels: [africasTalkingUssd({ maxScreenChars: 160 })] });
    const large = createAgent({ start: long, channels: [africasTalkingUssd({ maxScreenChars: 400 })] });
    const first = fixture("first-request.form");
    expect(await (await small.requestHandler(post(first))).text()).toContain("98. More");
    expect(await (await large.requestHandler(post(first))).text()).not.toContain("98. More");
  });

  it("always answers 200 with END on bad input", async () => {
    const { agent, lines } = setup();
    const noPhone = await agent.requestHandler(post("sessionId=x&text="));
    expect(noPhone.status).toBe(200);
    expect(await noPhone.text()).toBe("END Sorry, something went wrong. Please try again later.");
    expect(lines.some((l) => l.message === "USSD callback without a phone number")).toBe(true);

    const garbage = await agent.requestHandler(
      new Request("https://example.test/ussd", {
        method: "POST",
        headers: { "content-type": "multipart/form-data; boundary=x" },
        body: "not multipart",
      }),
    );
    expect(garbage.status).toBe(200);
    expect(await garbage.text()).toMatch(/^END /);
  });

  it("answers END when the engine itself throws", async () => {
    const { logger, lines } = recordingLogger();
    const ussd = africasTalkingUssd();
    const agent = createAgent({ start: clinic, channels: [ussd], logger });
    const broken = { ...agent, handle: async () => Promise.reject(new Error("store down")) };
    const res = await ussd.handler(broken)(post(fixture("first-request.form")));
    expect(await res.text()).toBe("END Sorry, something went wrong. Please try again later.");
    expect(JSON.stringify(lines)).not.toContain("+254700000001");
  });

  it("logs an unexpected service code but still answers", async () => {
    const { agent, lines } = setup({ code: "*999#" });
    const res = await agent.requestHandler(post(fixture("first-request.form")));
    expect(await res.text()).toMatch(/^CON /);
    expect(lines.some((l) => l.message === "USSD callback for an unexpected service code")).toBe(true);
  });

  it("refuses non-POST requests", async () => {
    const { agent } = setup();
    const res = await agent.requestHandler(new Request("https://example.test/ussd"));
    expect(res.status).toBe(405);
  });

  it("can be mounted without the agent's dispatcher", async () => {
    const { agent, ussd } = setup();
    const res = await ussd.handler(agent)(post(fixture("first-request.form"), "/anything"));
    expect(await res.text()).toMatch(/^CON Clinic line/);
  });
});

describe("session-end notifications", () => {
  it("logs with a masked number and calls the hook", async () => {
    const seen: SessionEndNotification[] = [];
    const { agent, lines } = setup({ onSessionEnd: (n) => void seen.push(n) });
    const res = await agent.requestHandler(post(fixture("session-end-failed.form"), "/ussd/end"));
    expect(res.status).toBe(200);
    expect(seen[0]?.status).toBe("Failed");
    expect(lines.find((l) => l.message === "USSD session ended")?.fields).toMatchObject({
      phone: "+254•••••0001",
      status: "Failed",
      errorMessage: "App response timeout",
    });
    expect(JSON.stringify(lines)).not.toContain("+254700000001");
  });

  it("can be turned off or moved", async () => {
    const off = setup({ endPath: false });
    expect((await off.agent.requestHandler(post("", "/ussd/end"))).status).toBe(404);
    const moved = setup({ endPath: "/hooks/ussd-end" });
    expect((await moved.agent.requestHandler(post(fixture("session-end-success.form"), "/hooks/ussd-end"))).status).toBe(200);
  });
});
