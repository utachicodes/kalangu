/**
 * `pnpm demo`: the clinic agent on a simulated keypad phone. No gateway
 * account, no API key, no network.
 */

import { consoleLogger } from "@kalangu/core";
import { runTerminal } from "@kalangu/sim";
import { createClinic } from "./clinic.js";
import { nurseFromEnv } from "./nurses.js";

const code = "*384*1#";
// GEMINI_MODEL=... (with GEMINI_API_KEY) or OLLAMA_MODEL=... picks a real model instead of the fake nurse.
const nurse = nurseFromEnv();

// The simulator swaps in its own USSD and SMS channels.
const clinic = createClinic({ channels: [], model: nurse.model, logger: consoleLogger("warn") });

console.log("Try: dial *384*1#, choose 2, and ask \"Is the clinic open on Sunday?\"");
console.log(`The nurse is ${nurse.description}. Answers slower than the 4 s deadline come by SMS.\n`);

await runTerminal(clinic, { code, sender: "CLINIC" });
process.exit(0);
