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
      seen.push(ctx.turnSeq);
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
  const send = (input: string, turnSeq?: number) =>
    agent.handle({ channel: "wa", phone: PHONE, input, ...(turnSeq !== undefined ? { turnSeq } : {}) });
  const seq = async () => (await sessions.load(PHONE))?.turnSeq;
  return { send, seq, sessions, ran, seen };
}

describe("turnSeq", () => {
  it("starts at 1 for the first turn and is bumped by each new turn", async () => {
    const t = setup();
    await t.send("hi");
    expect(await t.seq()).toBe(1);
    await t.send("1"); // the confirm screen
    expect(await t.seq()).toBe(2);
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

  it("hands the renderer the current counter", async () => {
    const t = setup();
    await t.send("hi");
    await t.send("1");
    expect(t.seen.at(-1)).toBe(2);
  });

  it("treats a tap carrying the current counter as typed input", async () => {
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
    const menuSeq = await t.seq(); // 1: the menu
    await t.send("1"); // now on the confirm, seq 2
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

  it("does not touch typed input, whatever the counter says", async () => {
    const t = setup();
    await t.send("hi");
    await t.send("1");
    expect((await t.send("1")).text).toBe("Booked."); // no turnSeq: answers what is on screen
  });

  it("reads a session stored before turnSeq existed as 0", async () => {
    const t = setup();
    await t.send("hi");
    const record = (await t.sessions.load(PHONE))!;
    delete record.turnSeq;
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
    const out = await agent.handle({ channel: "wa", phone: PHONE, input: "1", turnSeq: 9 });
    expect(out.text).toContain("Ce choix a expiré.");
  });
});
