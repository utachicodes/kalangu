import { describe, expect, it } from "vitest";
import { silentLogger, type SessionStore } from "@kalangu/core";
import { createPhone, type SimSms } from "@kalangu/sim";
import { createClinic } from "../src/clinic.js";
import { fakeNurse } from "../src/nurse.js";

const nextSms = (phone: ReturnType<typeof createPhone>) =>
  new Promise<SimSms>((resolve) => {
    const off = phone.onSms((sms) => {
      off();
      resolve(sms);
    });
  });

function clinicPhone(options: { delayMs: number; deadlineMs: number; sessionStore?: SessionStore }) {
  const clinic = createClinic({
    channels: [],
    model: fakeNurse({ delayMs: options.delayMs }),
    deadlineMs: options.deadlineMs,
    logger: silentLogger,
    ...(options.sessionStore ? { sessionStore: options.sessionStore } : {}),
  });
  return createPhone(clinic, { code: "*384*1#", sender: "CLINIC" });
}

describe("clinic example", () => {
  it("answers opening hours instantly", async () => {
    const phone = clinicPhone({ delayMs: 50, deadlineMs: 20 });
    expect(await phone.dial("*384*1#")).toEqual({
      text: "Clinic line\n1. Opening hours\n2. Ask a nurse\n3. Language",
      end: false,
    });
    expect(await phone.press("1")).toEqual({ text: "Open Monday to Saturday, 8:00 to 18:00.", end: true });
  });

  it("defers a slow nurse answer to SMS (the demo's path)", async () => {
    const phone = clinicPhone({ delayMs: 60, deadlineMs: 20 });
    await phone.dial("*384*1#");
    await phone.press("2");
    const arriving = nextSms(phone);
    expect(await phone.press("Is the clinic open on Sunday?")).toEqual({
      text: "We are working on your question. You will receive an SMS shortly.",
      end: true,
    });
    const sms = await arriving;
    expect(sms.from).toBe("CLINIC");
    expect(sms.text).toBe("The clinic is closed on Sundays. For emergencies, go to the district hospital.");
    expect(phone.inbox).toHaveLength(1);
  });

  it("shows a fast nurse answer on screen", async () => {
    const phone = clinicPhone({ delayMs: 1, deadlineMs: 500 });
    await phone.dial("*384*1#");
    await phone.press("2");
    expect(await phone.press("Do you do vaccinations?")).toMatchObject({
      text: "Vaccinations are on Tuesday and Thursday mornings. Bring the child's health card.",
      end: true,
    });
    expect(phone.inbox).toHaveLength(0);
  });

  it("switches to French, safe for USSD on screen and accented by SMS", async () => {
    const phone = clinicPhone({ delayMs: 60, deadlineMs: 20 });
    await phone.dial("*384*1#");
    await phone.press("3");
    expect(await phone.press("2")).toEqual({
      text: "Ligne de la clinique\n1. Horaires\n2. Question a une infirmiere\n3. Langue",
      end: false,
    });
    await phone.press("2");
    const arriving = nextSms(phone);
    expect((await phone.press("Ouvert le dimanche ?")).text).toBe(
      "Nous traitons votre question. Vous recevrez un SMS sous peu.",
    );
    expect((await arriving).text).toBe(
      "La clinique est fermée le dimanche. En cas d'urgence, allez à l'hôpital de district.",
    );
  });

  it("resumes after a hang-up", async () => {
    const phone = clinicPhone({ delayMs: 1, deadlineMs: 500 });
    await phone.dial("*384*1#");
    await phone.press("2");
    phone.hangUp();
    expect(await phone.dial("*384*1#")).toEqual({ text: "Type your question", end: false });
  });
});
