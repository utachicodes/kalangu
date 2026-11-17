import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeProvider } from "../src/index.js";

const payment = {
  id: "pay-1",
  phone: "+254700000001",
  provider: "FAKE_MOMO",
  providerPhone: "254700000001",
  amount: "1000.00",
  currency: "KES",
  reason: "Consultation",
  stepId: "start.2.yes",
  locale: "en",
  status: "CREATED" as const,
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

describe("createFakeProvider", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves to a provider choice with a sanitised phone", async () => {
    const provider = createFakeProvider({ provider: "FAKE_MOMO", country: "XA" });
    const choice = await provider.resolve("+254700000001", "1000", "KES");
    if ("provider" in choice) {
      expect(choice.provider).toBe("FAKE_MOMO");
      expect(choice.phone).toBe("254700000001");
      expect(choice.country).toBe("XA");
    } else {
      throw new Error("expected a provider choice, got a refusal");
    }
  });

  it("can be configured to always refuse", async () => {
    const provider = createFakeProvider({ alwaysRefuse: true });
    const choice = await provider.resolve("+254700000001", "1000", "KES");
    if ("kind" in choice) {
      expect(choice.kind).toBe("provider-closed");
    } else {
      throw new Error("expected a refusal, got a provider choice");
    }
  });

  it("initiates and returns ACCEPTED", async () => {
    const provider = createFakeProvider();
    const result = await provider.initiate(payment);
    expect(result.status).toBe("ACCEPTED");
  });

  it("reports PROCESSING until the delay has passed, then COMPLETED", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1_000_000);
    const provider = createFakeProvider({ settleAfterMs: 3000 });
    await provider.initiate(payment);
    expect(await provider.status("pay-1")).toMatchObject({ found: true, status: "PROCESSING" });
    vi.setSystemTime(1_000_000 + 2999);
    expect(await provider.status("pay-1")).toMatchObject({ found: true, status: "PROCESSING" });
    vi.setSystemTime(1_000_000 + 3000);
    expect(await provider.status("pay-1")).toMatchObject({ found: true, status: "COMPLETED" });
  });

  it("does not find a payment that was never initiated", async () => {
    const provider = createFakeProvider();
    expect(await provider.status("never-initiated")).toEqual({ found: false });
  });

  it("can be configured to always fail", async () => {
    const provider = createFakeProvider({ alwaysFail: true, settleAfterMs: 0 });
    const result = await provider.initiate(payment);
    expect(result.status).toBe("ACCEPTED");
    expect(await provider.status("pay-1")).toMatchObject({ found: true, status: "FAILED" });
  });

  it("has the id \"fake\"", async () => {
    expect(createFakeProvider().id).toBe("fake");
  });
});
