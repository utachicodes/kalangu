/**
 * The clinic agent on Africa's Talking, served with Node's http module.
 *
 *   AT_USERNAME=sandbox AT_API_KEY=... AT_SANDBOX=1 pnpm --filter @kalangu/example-clinic start
 *
 * Point the USSD callback at /ussd (and /ussd/end), incoming SMS at /sms and
 * delivery reports at /sms/delivery. Callbacks are not signed. In
 * production set CALLBACK_SECRET (the paths become /<secret>/ussd and so on)
 * and, behind your own proxy, ALLOWED_IPS (see callbackGuard.ts).
 */

import { createServer, type IncomingMessage } from "node:http";
import { allowOnly, forwardedFor, secretPath } from "./callbackGuard.js";
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
// Callbacks are not signed: an optional secret path segment, and an optional address allowlist.
const secret = process.env["CALLBACK_SECRET"];
const route = (path: string) => secretPath(secret, path);
const clinic = createClinic({
  ...(sessionStore ? { sessionStore } : {}),
  model: nurse.model,
  channels: [
    africasTalkingUssd({ code: env("USSD_CODE", "*384*1#"), path: route("/ussd"), endPath: route("/ussd/end") }),
    africasTalkingSms({
      username: env("AT_USERNAME"),
      apiKey: env("AT_API_KEY"),
      ...(process.env["AT_SENDER_ID"] ? { senderId: process.env["AT_SENDER_ID"] } : {}),
      sandbox,
      path: route("/sms"),
      deliveryPath: route("/sms/delivery"),
    }),
  ],
});

const port = Number(env("PORT", "3000"));
// ALLOWED_IPS=a,b: only behind a proxy you control that sets X-Forwarded-For.
const allowedIps = process.env["ALLOWED_IPS"]?.split(",") ?? [];
const handle = allowedIps.length ? allowOnly(clinic.requestHandler, { ips: allowedIps, ipOf: forwardedFor }) : clinic.requestHandler;

createServer(async (req, res) => {
  try {
    const response = await handle(await toRequest(req, port));
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
  // The secret is part of the URLs; print where it goes, never the secret itself.
  console.log(secret ? "Callbacks are under the secret path: /<CALLBACK_SECRET>/ussd and so on." : "Callbacks are at /ussd and /sms (set CALLBACK_SECRET in production).");
  if (allowedIps.length) console.log(`Only ${allowedIps.length} allowed address(es) can call, read from X-Forwarded-For.`);
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
