import { describe, expect, it } from "vitest";
import { allowOnly, forwardedFor, secretPath } from "../src/callbackGuard.js";

const ok = async () => new Response("CON Clinic line");
const from = (ip?: string) => new Request("http://localhost/ussd", { method: "POST", headers: ip ? { "x-forwarded-for": ip } : {} });

describe("callback protection", () => {
  it("lets an allowed address through and refuses others without reaching the agent", async () => {
    let reached = 0;
    const handler = allowOnly(
      async () => {
        reached++;
        return ok();
      },
      { ips: ["196.201.214.10", " 196.201.214.11 "], ipOf: forwardedFor },
    );
    expect((await handler(from("196.201.214.11, 10.0.0.1"))).status).toBe(200);
    expect((await handler(from("203.0.113.9"))).status).toBe(403);
    expect((await handler(from())).status).toBe(403);
    expect(reached).toBe(1);
  });

  it("refuses an empty allowlist rather than allowing everyone", () => {
    expect(() => allowOnly(ok, { ips: [" "], ipOf: forwardedFor })).toThrow(/at least one address/);
  });

  it("puts routes under a secret, and refuses a guessable one", () => {
    expect(secretPath(undefined, "/ussd")).toBe("/ussd");
    expect(secretPath("3f9a1c0e7b2d4a6f", "/ussd")).toBe("/3f9a1c0e7b2d4a6f/ussd");
    expect(() => secretPath("short", "/ussd")).toThrow(/at least 16/);
    expect(() => secretPath("has/slash/in/it/xx", "/ussd")).toThrow();
  });
});
