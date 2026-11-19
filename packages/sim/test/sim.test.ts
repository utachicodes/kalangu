import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { ask, createAgent, menu, say, silentLogger, ussdChannel } from "@kalangu/core";
import { box, createPhone, formatSms, runTerminal } from "../src/index.js";

const clinic = menu("Clinic line", {
  "Opening hours": say("Open Monday to Saturday, 8:00 to 18:00."),
  "Ask a nurse": ask("Type your question", (q) => `You asked: ${q}`),
});

const agent = () => createAgent({ start: clinic, channels: [ussdChannel()], logger: silentLogger });

describe("SimPhone", () => {
  it("dials, answers and ends like a USSD session", async () => {
    const phone = createPhone(agent(), { code: "*384*1#" });
    expect(await phone.dial("*384*1#")).toEqual({
      text: "Clinic line\n1. Opening hours\n2. Ask a nurse",
      end: false,
    });
    expect(phone.inSession).toBe(true);
    expect(await phone.press("1")).toEqual({ text: "Open Monday to Saturday, 8:00 to 18:00.", end: true });
    expect(phone.inSession).toBe(false);
  });

  it("rejects codes that don't reach the agent", async () => {
    const phone = createPhone(agent(), { code: "*384*1#" });
    expect(await phone.dial("*100#")).toMatchObject({ end: true, text: expect.stringContaining("invalid MMI") });
    expect(await phone.dial("hello")).toMatchObject({ end: true });
    expect(phone.inSession).toBe(false);
  });

  it("carries choices typed into the dial string", async () => {
    const phone = createPhone(agent(), { code: "*384*1#" });
    expect(await phone.dial("*384*1*2#")).toEqual({ text: "Type your question", end: false });
  });

  it("resumes after hanging up", async () => {
    const phone = createPhone(agent());
    await phone.dial("*384#");
    await phone.press("2");
    phone.hangUp();
    expect(await phone.dial("*384#")).toEqual({ text: "Type your question", end: false });
  });

  it("texts the agent and receives the reply in the inbox", async () => {
    const phone = createPhone(agent(), { sender: "CLINIC" });
    const seen: string[] = [];
    phone.onSms((sms) => seen.push(sms.text));
    await phone.sendSms("hi");
    await phone.sendSms("1");
    expect(phone.inbox.map((m) => m.from)).toEqual(["CLINIC", "CLINIC"]);
    expect(seen).toEqual(["Clinic line\n1. Opening hours\n2. Ask a nurse", "Open Monday to Saturday, 8:00 to 18:00."]);
  });

  it("delivers messages the agent sends through its SMS channel", async () => {
    const phone = createPhone(agent());
    const sms = phone.agent.channel("sim-sms");
    await sms?.send?.({ to: phone.number, text: "Your answer" });
    await sms?.send?.({ to: "+254799999999", text: "Someone else's" });
    expect(phone.inbox.map((m) => m.text)).toEqual(["Your answer"]);
  });

  it("refuses press without a session", async () => {
    await expect(createPhone(agent()).press("1")).rejects.toThrow(/dial/);
  });
});

describe("box", () => {
  it("frames and wraps a screen", () => {
    expect(box({ text: "Type your question:", end: false }, 20)).toBe(
      ["┌──────────────────────┐", "│ Type your question:  │", "└──────────────────────┘"].join("\n"),
    );
    const wrapped = box({ text: "We are working on your question. You will get an SMS shortly.", end: true }, 20);
    for (const line of wrapped.split("\n")) expect(line.length).toBe(24);
    expect(wrapped).toContain("END We are working");
  });
});

describe("formatSms", () => {
  it("says what a message costs, and why when it is UCS-2", () => {
    expect(formatSms({ from: "CLINIC", at: new Date(0), text: "Open 8 to 18." })).toBe("✉ SMS from CLINIC (1 segment): Open 8 to 18.");
    expect(formatSms({ from: "CLINIC", at: new Date(0), text: "x".repeat(161) })).toMatch(/^✉ SMS from CLINIC \(2 segments\): /);
    const wolof = "Ñu ngi topp sa laaj. Dina nga jot SMS su gën yàgg.";
    expect(formatSms({ from: "CLINIC", at: new Date(0), text: wolof })).toBe(`✉ SMS from CLINIC (1 segment, UCS-2 because of ë): ${wolof}`);
    expect(formatSms({ from: "CLINIC", at: new Date(0), text: "ë".repeat(71) })).toMatch(/^✉ SMS from CLINIC \(2 segments, UCS-2 because of ë\)/);
  });
});

describe("runTerminal", () => {
  it("runs a scripted session", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    let printed = "";
    output.on("data", (chunk: Buffer) => (printed += chunk.toString()));

    const done = runTerminal(agent(), { input, output, code: "*384*1#" });
    input.end(["*384*1#", "2", "Is it open on Sunday?", "sms hi", "q", ""].join("\n"));
    const phone = await done;

    expect(printed).toContain("Simulated phone: +254 700 000 001 (Safaricom KE)");
    expect(printed).toContain("│ 1. Opening hours");
    expect(printed).toContain("Choice> ");
    expect(printed).toContain("Input> ");
    expect(printed).toContain("END You asked: Is it open on");
    expect(printed).toContain("✉ SMS from AGENT (1 segment): Clinic line");
    expect(phone.inbox).toHaveLength(1);
  });

  it("explains a number typed where a code was expected", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    let printed = "";
    output.on("data", (chunk: Buffer) => (printed += chunk.toString()));

    const done = runTerminal(agent(), { input, output, code: "*384*1#" });
    input.end(["1", "*99#", "q", ""].join("\n"));
    await done;

    expect(printed).toContain("END Connection problem or invalid");
    expect(printed).toContain("→ Not a code. Dial *384*1# to start, or reply by SMS with: sms 1");
    // A mistyped code gets the phone's own error and no hint.
    expect(printed.match(/→ Not a code/g)).toHaveLength(1);
  });
});
