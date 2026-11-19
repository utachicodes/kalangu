/**
 * The clinic agent on Africa's Talking, served with Node's http module.
 *
 *   AT_USERNAME=sandbox AT_API_KEY=... AT_SANDBOX=1 pnpm --filter @kalangu/example-clinic start
 *
 * Point the USSD callback at /ussd (and /ussd/end), incoming SMS at /sms and
 * delivery reports at /sms/delivery. Callbacks are not signed; in
 * production, put a hard-to-guess prefix on these paths and allow only the
 * gateway's IP addresses.
 */

import { createServer, type IncomingMessage } from "node:http";
import { africasTalkingSms } from "@kalangu/sms";
import { africasTalkingUssd } from "@kalangu/ussd";
import { createClinic } from "./clinic.js";
import { nurseFromEnv } from "./nurses.js";
import { sqliteSessionStore } from "./sqliteStore.js";

const env = (name: string, fallback?: string): string => {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    console.error(`Set ${name} to run the server (see the comment at the top of server.ts).`);
    process.exit(1);
  }
  return value;
};

const sandbox = env("AT_SANDBOX", "0") === "1";
// Set GEMINI_MODEL (with GEMINI_API_KEY) or OLLAMA_MODEL to answer with a real model.
const nurse = nurseFromEnv();
// SESSION_DB=sessions.db keeps conversations in SQLite across restarts; without it they are in memory.
const sessionDb = process.env["SESSION_DB"];
const sessionStore = sessionDb ? await sqliteSessionStore(sessionDb) : undefined;
const clinic = createClinic({
  ...(sessionStore ? { sessionStore } : {}),
  model: nurse.model,
  channels: [
    africasTalkingUssd({ code: env("USSD_CODE", "*384*1#"), path: "/ussd" }),
    africasTalkingSms({
      username: env("AT_USERNAME"),
      apiKey: env("AT_API_KEY"),
      ...(process.env["AT_SENDER_ID"] ? { senderId: process.env["AT_SENDER_ID"] } : {}),
      sandbox,
      path: "/sms",
    }),
  ],
});

const port = Number(env("PORT", "3000"));

createServer(async (req, res) => {
  try {
    const response = await clinic.requestHandler(await toRequest(req, port));
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (err) {
    console.error(err);
    res.writeHead(500).end();
  }
}).listen(port, () => {
  console.log(`Clinic agent listening on http://localhost:${port} (${sandbox ? "sandbox" : "live"})`);
  console.log(`The nurse is ${nurse.description}.`);
  console.log(sessionDb ? `Sessions are stored in ${sessionDb}.` : "Sessions are in memory and are lost on restart (set SESSION_DB to keep them).");
});

async function toRequest(req: IncomingMessage, port: number): Promise<Request> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (typeof value === "string") headers.set(name, value);
    else if (Array.isArray(value)) headers.set(name, value.join(", "));
  }
  const method = req.method ?? "GET";
  return new Request(`http://localhost:${port}${req.url ?? "/"}`, {
    method,
    headers,
    ...(method === "GET" || method === "HEAD" ? {} : { body: Buffer.concat(chunks) }),
  });
}
