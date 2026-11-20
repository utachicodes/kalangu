/**
 * The website's demo: the whole prototype in the visitor's browser. Kalangu's
 * agent, the commune's SQLite database and the API run here; the page talks to
 * them through `api`, exactly as it talks to server.ts over HTTP.
 */
import { silentLogger } from "@kalangu/core";
import { createNdiediengAgent } from "../src/agent.js";
import { createApp } from "../src/app.js";
import { ruleAssistant } from "../src/assistant.js";
import { keywordClassifier } from "../src/classify.js";
import { createCommune } from "../src/db.js";
import { loadSqlJs, sqlJsDb } from "./sqljs.js";
export async function boot() {
    const commune = createCommune(sqlJsDb(await loadSqlJs()));
    const classifier = keywordClassifier();
    const agent = createNdiediengAgent({ commune, classifier, channels: [], logger: silentLogger });
    const app = createApp({
        commune,
        agent,
        classifier,
        assistant: ruleAssistant(commune),
        mode: "dans votre navigateur · classement par mots-clés · assistant par règles",
    });
    return async (method, path, body) => {
        const res = await app(new Request(new URL(path, "https://ndiedieng.local/"), {
            method,
            ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
        }));
        return { status: res.status, body: await res.json() };
    };
}
