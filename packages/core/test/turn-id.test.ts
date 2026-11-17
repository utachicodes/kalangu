import { describe, expect, it } from "vitest";
import {
  ask,
  confirm,
  createAgent,
  memoryStore,
  menu,
  say,
  silentLogger,
  smsChannel,
  type Channel,
  type RenderContext,
} from "../src/index.js";

const PHONE = "+254700000001";

function setup() {
  const sessions = memoryStore();
  const seen: Array<number | undefined> = [];
  const base = smsChannel({ id: "wa" });
  // A channel that, like a tappable one, is handed the turn counter to put in button ids.
  const channel: Channel = {
    ...base,
    render(turn, ctx: RenderContext) {
      seen.push(ctx.turnId);
      return base.render(turn, ctx);
    },
  };
  const ran: string[] = [];
  const start = menu("Clinic", {
    "Book a visit": confirm("Book for Monday?", {
      onYes: () => {
        ran.push("yes");
        return "Booked.";
      },
      onNo: () => {
        ran.push("no");
        return "Not booked.";
      },
    }),
    "Ask a nurse": ask("Your question?", (q) => {
      ran.push(`ask:${q}`);
      return "Answered.";
    }),
  });
  const agent = createAgent({ start, channels: [channel], logger: silentLogger, sessionStore: sessions });
  const send = (input: string, turnId?: number) =>
    agent.handle({ channel: "wa", phone: PHONE, input, ...(turnId !== undefined ? { turnId } : {}) });
  const seq = async () => (await sessions.load(PHONE))?.turnId;
  return { send, seq, sessions, ran, seen };
}

describe("turnId", () => {
  it("gives each new turn a fresh positive token, never 0", async () => {
    const t = setup();
    await t.send("hi");
    const first = await t.seq();
    expect(first).toBeGreaterThan(0);
    expect(Number.isInteger(first)).toBe(true);
    await t.send("1"); // the confirm screen
    const second = await t.seq();
    expect(second).toBeGreaterThan(0);
    expect(second).not.toBe(first);
  });

  it("is not a counter: tokens do not follow one another", async () => {
    const t = setup();
    const seen = new Set<number | undefined>();
    for (const phone of ["+254700000010", "+254700000011", "+254700000012", "+254700000013"]) {
      const agent = createAgent({ start: say("hi"), channels: [smsChannel({ id: "wa" })], logger: silentLogger, sessionStore: t.sessions });
      await agent.handle({ channel: "wa", phone, input: "x" });
      seen.add((await t.sessions.load(phone))?.turnId);
    }
    expect(seen.size).toBe(4); // four fresh sessions, four different first tokens
  });

  it("refuses a tap from a session that was cleared and started again", async () => {
    const t = setup();
    await t.send("hi");
    const oldToken = await t.seq();
    await t.sessions.clear(PHONE); // or a restart of an in-memory store
    await t.send("hi");
    const out = await t.send("1", oldToken);
    expect(out.text).toContain("That choice has expired.");
    expect(t.ran).toEqual([]);
  });

  it("is not bumped when the same turn is shown again", async () => {
    const t = setup();
    await t.send("hi");
    await t.send("1");
    const before = await t.seq();
    await t.send("nonsense"); // an invalid answer re-shows the confirm with a notice
    await t.send("what?");
    expect(await t.seq()).toBe(before);
  });

  it("hands the renderer the current token", async () => {
    const t = setup();
    await t.send("hi");
    await t.send("1");
    expect(t.seen.at(-1)).toBe(await t.seq());
  });

  it("treats a tap carrying the current token as typed input", async () => {
    const t = setup();
    await t.send("hi");
    await t.send("1");
    const out = await t.send("1", await t.seq());
    expect(out.text).toBe("Booked.");
    expect(t.ran).toEqual(["yes"]);
  });

  it("refuses a tap from an earlier turn, shows the current turn, and runs nothing", async () => {
    const t = setup();
    await t.send("hi");
    const menuSeq = await t.seq(); // the menu's token
    await t.send("1"); // now on the confirm, with a new token
    const out = await t.send("1", menuSeq); // a tap on the old menu's "Book a visit"
    expect(out.text).toBe("That choice has expired.\nBook for Monday?\nReply YES or NO");
    expect(out.end).toBe(false);
    expect(t.ran).toEqual([]);
    // The current turn still works afterwards.
    expect((await t.send("2", await t.seq())).text).toBe("Not booked.");
    expect(t.ran).toEqual(["no"]);
  });

  it("an old Yes cannot answer a later question", async () => {
    const t = setup();
    await t.send("hi");
    await t.send("1");
    const confirmSeq = await t.seq();
    await t.send("2"); // No: the conversation ends
    await t.send("hi");
    await t.send("1"); // a new confirm, a new turn
    const out = await t.send("1", confirmSeq); // a tap on the first confirm's Yes
    expect(out.text).toContain("That choice has expired.");
    expect(t.ran).toEqual(["no"]);
  });

  it("refuses a tap that is ahead of the session too", async () => {
    const t = setup();
    await t.send("hi");
    const out = await t.send("1", 99);
    expect(out.text).toContain("That choice has expired.");
    expect(t.ran).toEqual([]);
  });

  it("does not touch typed input, whatever the token says", async () => {
    const t = setup();
    await t.send("hi");
    await t.send("1");
    expect((await t.send("1")).text).toBe("Booked."); // no turnId: answers what is on screen
  });

  it("reads a session stored before turnId existed as 0", async () => {
    const t = setup();
    await t.send("hi");
    const record = (await t.sessions.load(PHONE))!;
    delete record.turnId;
    await t.sessions.save(record);
    // 0 matches a legacy session; the menu on screen is answered normally.
    expect((await t.send("1", 0)).text).toContain("Book for Monday?");
  });

  it("shows the start menu for an expired tap when nothing is on screen", async () => {
    const t = setup();
    const out = await t.send("1", 5);
    expect(out.text).toContain("Clinic");
    expect(t.ran).toEqual([]);
  });

  it("says it in French for a French user", async () => {
    const sessions = memoryStore();
    const agent = createAgent({
      start: menu("Clinique", { Rendez: say("Ok") }),
      channels: [smsChannel({ id: "wa" })],
      logger: silentLogger,
      sessionStore: sessions,
      defaultLocale: "fr",
    });
    await agent.handle({ channel: "wa", phone: PHONE, input: "hi" });
    const out = await agent.handle({ channel: "wa", phone: PHONE, input: "1", turnId: 9 });
    expect(out.text).toContain("Ce choix a expiré.");
  });
});
