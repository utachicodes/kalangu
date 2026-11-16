/**
 * `pnpm demo`: the clinic agent on a simulated keypad phone. No gateway
 * account, no API key, no network.
 */

import { consoleLogger } from "@kalangu/core";
import { runTerminal } from "@kalangu/sim";
import { createClinic } from "./clinic.js";

const code = "*384*1#";

// The simulator swaps in its own USSD and SMS channels.
const clinic = createClinic({ channels: [], logger: consoleLogger("warn") });

console.log("Try: dial *384*1#, choose 2, and ask \"Is the clinic open on Sunday?\"");
console.log("The fake nurse takes 6 s; the deadline is 4 s, so the answer comes by SMS.\n");

await runTerminal(clinic, { code, sender: "CLINIC" });
process.exit(0);
