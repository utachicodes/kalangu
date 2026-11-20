/**
 * The website's Gemini endpoint (`/api/ndiedieng/gemini`), as a standard
 * Request -> Response handler for a serverless function. It holds the key;
 * the browser sends a task from gemini.ts and gets the model's JSON back.
 *
 * It is not an open proxy: only the fixed tasks run, with fixed prompts and
 * size limits, from the site's own pages, and each visitor is rate limited.
 * GET says whether Gemini is available, so the page can choose.
 */
import { DEFAULT_MODEL, generate, promptFor } from "./gemini.mjs";
const SITE = /^https:\/\/(kalangu\.utachi\.website|kalangu-site[a-z0-9-]*\.vercel\.app)$|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const MAX_BODY = 32_000;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
export function geminiHandler(options) {
    const allow = options.allowOrigin ?? ((o) => SITE.test(o));
    // A question costs up to three calls (query, answer, speech).
    const perMinute = options.perMinute ?? 30;
    const perDay = options.perDay ?? 450;
    const now = options.now ?? Date.now;
    const model = options.model || DEFAULT_MODEL;
    // In memory, per instance: a speed bump, not an accounting system. Set a
    // quota on the key in Google AI Studio as well.
    const seen = new Map();
    const limited = (visitor) => {
        const t = now();
        const recent = (seen.get(visitor) ?? []).filter((at) => t - at < 24 * 60 * 60 * 1000);
        if (recent.length >= perDay || recent.filter((at) => t - at < 60_000).length >= perMinute) {
            seen.set(visitor, recent);
            return true;
        }
        recent.push(t);
        seen.set(visitor, recent);
        if (seen.size > 5000)
            seen.clear();
        return false;
    };
    return async (req) => {
        if (req.method === "GET")
            return json({ available: Boolean(options.apiKey), model: options.apiKey ? model : null, speech: Boolean(options.apiKey) });
        if (req.method !== "POST")
            return json({ error: "method not allowed" }, 405);
        if (!options.apiKey)
            return json({ error: "Gemini is not configured" }, 503);
        const origin = req.headers.get("origin") ?? "";
        if (!allow(origin))
            return json({ error: "origin not allowed" }, 403);
        const visitor = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
        if (limited(visitor))
            return json({ error: "too many requests, try again in a minute" }, 429);
        const raw = await req.text();
        if (raw.length > MAX_BODY)
            return json({ error: "request too large" }, 413);
        let task;
        try {
            task = JSON.parse(raw);
        }
        catch {
            return json({ error: "invalid JSON" }, 400);
        }
        const prompt = promptFor(task);
        if (typeof prompt === "string")
            return json({ error: prompt }, 400);
        try {
            const result = await generate({
                apiKey: options.apiKey,
                model,
                ...(options.speechModel ? { speechModel: options.speechModel } : {}),
                ...(options.voice ? { voice: options.voice } : {}),
                ...(options.fetch ? { fetch: options.fetch } : {}),
            }, prompt);
            return json({ result });
        }
        catch (err) {
            // Never the key, never Google's full error: just that it failed.
            return json({ error: `Gemini failed: ${err instanceof Error ? err.message.slice(0, 80) : "unknown"}` }, 502);
        }
    };
}
