/**
 * `pnpm smoke`: runs the compiled packages end to end without the test
 * runner, so CI can check them on the oldest supported Node version.
 */

import { silentLogger } from "@kalangu/core";
import { createPhone } from "@kalangu/sim";
import { createClinic } from "./clinic.js";
import { fakeNurse } from "./nurse.js";

const fail = (message: string): never => {
  console.error(`smoke: ${message}`);
  process.exit(1);
};

const clinic = createClinic({
  channels: [],
  model: fakeNurse({ delayMs: 200 }),
  deadlineMs: 50,
  logger: silentLogger,
});
const phone = createPhone(clinic, { code: "*384*1#", sender: "CLINIC" });

const menuScreen = await phone.dial("*384*1#");
if (!menuScreen.text.startsWith("Clinic line\n1. Opening hours")) fail(`unexpected menu: ${menuScreen.text}`);

await phone.press("2");
const sms = new Promise<string>((resolve) => phone.onSms((m) => resolve(m.text)));
const notice = await phone.press("Is the clinic open on Sunday?");
if (!notice.end || !notice.text.includes("SMS")) fail(`expected the deferred notice, got: ${notice.text}`);

const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("no SMS within 5 s")), 5000));
const answer = await Promise.race([sms, timeout]).catch((err: Error) => fail(err.message));
if (!answer.startsWith("The clinic is closed on Sundays")) fail(`unexpected SMS: ${answer}`);

console.log(`smoke: ok on Node ${process.versions.node}`);
