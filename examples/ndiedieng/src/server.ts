/**
 * The Ndiédieng prototype, served with Node's http module.
 *
 *   pnpm build && pnpm --filter @kalangu/example-ndiedieng build:web
 *   pnpm --filter @kalangu/example-ndiedieng start      # then open http://localhost:3000
 *
 * It serves the same page as the website (site/ndiedieng), talking to this
 * server's API instead of running the prototype in the browser.
 *
 * Optional, from the environment:
 *   GEMINI_API_KEY (and GEMINI_MODEL)   SMS sorting and free questions by Gemini
 *   AT_USERNAME, AT_API_KEY, AT_SANDBOX=1, USSD_CODE, AT_SENDER_ID
 *                                        real USSD and SMS through Africa's Talking,
 *                                        callbacks at /ussd and /sms
 *   CALLBACK_SECRET                      puts those callbacks under /<secret>/
 *   PORT                                 default 3000
 *
 * A prototype: the dashboard has no login. Run it on your own machine or
 * behind access control, never open on the internet with real data.
 */

import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { consoleLogger, type Channel } from "@kalangu/core";
import { africasTalkingSms } from "@kalangu/sms";
import { africasTalkingUssd } from "@kalangu/ussd";
import { createNdiediengAgent } from "./agent.js";
import { createApp, USSD_CODE } from "./app.js";
import { geminiAssistant, ruleAssistant } from "./assistant.js";
import { geminiClassifier, keywordClassifier } from "./classify.js";
import { openCommune } from "./nodeSql.js";

const env = process.env;
const commune = openCommune();
const geminiKey = env["GEMINI_API_KEY"];
const geminiModel = env["GEMINI_MODEL"];
const classifier = geminiKey ? geminiClassifier({ apiKey: geminiKey, ...(geminiModel ? { model: geminiModel } : {}) }) : keywordClassifier();
const assistant = geminiKey ? geminiAssistant(commune, { apiKey: geminiKey, ...(geminiModel ? { model: geminiModel } : {}) }) : ruleAssistant(commune);

// Real gateway, only when configured.
const secret = env["CALLBACK_SECRET"];
if (secret && !/^[A-Za-z0-9_-]{16,}$/.test(secret)) {
  console.error("CALLBACK_SECRET must be at least 16 letters, digits, - or _ (for example: openssl rand -hex 16)");
  process.exit(1);
}
const route = (path: string) => (secret ? `/${secret}${path}` : path);
const live = Boolean(env["AT_USERNAME"] && env["AT_API_KEY"]);
const sms = live
  ? africasTalkingSms({
      username: env["AT_USERNAME"]!,
      apiKey: env["AT_API_KEY"]!,
      sandbox: env["AT_SANDBOX"] === "1",
      ...(env["AT_SENDER_ID"] ? { senderId: env["AT_SENDER_ID"] } : {}),
      path: route("/sms"),
      deliveryPath: route("/sms/delivery"),
    })
  : null;
const channels: Channel[] = sms
  ? [africasTalkingUssd({ code: env["USSD_CODE"] ?? USSD_CODE, path: route("/ussd"), endPath: route("/ussd/end") }), sms]
  : [];

const agent = createNdiediengAgent({ commune, classifier, channels, logger: consoleLogger("warn") });
const app = createApp({
  commune,
  agent,
  assistant,
  classifier,
  mode: `${geminiKey ? "classement et assistant par Gemini" : "classement par mots-clés, assistant par règles"}${live ? ", passerelle Africa's Talking active" : ""}`,
  ...(sms ? { notify: (to: string, text: string) => sms.send({ to, text }) } : {}),
});
// The page, from the website's build of it, told to use this server's API.
const SITE = fileURLToPath(new URL("../../../site/ndiedieng/", import.meta.url));
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};
async function staticFile(path: string): Promise<Response> {
  // A folder serves its index.html: / is the dashboard, /assistant/ the assistant.
  const file = resolve(SITE, `.${decodeURIComponent(path)}${path.endsWith("/") ? "index.html" : ""}`);
  // Nothing outside the page's own folder.
  if (!file.startsWith(SITE.endsWith(sep) ? SITE : SITE + sep)) return new Response("Not found", { status: 404 });
  try {
    let body: string | Buffer = await readFile(file);
    if (file.endsWith("index.html")) {
      body = body
        .toString("utf8")
        .replace('<base href="/ndiedieng/">', '<base href="/">')
        .replace('<meta name="ndiedieng-mode" content="local">', '<meta name="ndiedieng-mode" content="server">');
    }
    return new Response(body, { headers: { "content-type": TYPES[extname(file)] ?? "application/octet-stream" } });
  } catch {
    return new Response(path === "/" ? "Build the page first: pnpm --filter @kalangu/example-ndiedieng build:web" : "Not found", { status: 404 });
  }
}

const isGateway = (path: string) => live && [route("/ussd"), route("/ussd/end"), route("/sms"), route("/sms/delivery")].includes(path);

const port = Number(env["PORT"] ?? 3000);
createServer(async (req, res) => {
  try {
    const request = await toRequest(req, port);
    const path = new URL(request.url).pathname;
    const response = isGateway(path)
      ? await agent.requestHandler(request)
      : path.startsWith("/api/")
        ? await app(request)
        : request.method === "GET"
          ? await staticFile(path)
          : new Response("Not found", { status: 404 });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (err) {
    console.error(err);
    res.writeHead(500).end();
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`Ndiédieng prototype: http://localhost:${port}`);
  console.log(geminiKey ? "SMS sorting and the assistant use Gemini." : "SMS sorting by keywords, assistant by rules (set GEMINI_API_KEY for Gemini).");
  console.log(live ? "Africa's Talking callbacks are live." : "Demo only: the phones are simulated (set AT_USERNAME and AT_API_KEY for a real gateway).");
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
