/**
 * Protecting gateway callbacks, which Africa's Talking does not sign: anyone
 * who knows a callback URL can call it. Two mitigations, both optional:
 *
 * - a secret path segment (CALLBACK_SECRET): the routes become
 *   /<secret>/ussd and so on, so the URL itself is hard to guess;
 * - an allowlist of the gateway's source addresses (ALLOWED_IPS). Africa's
 *   Talking does not publish them; its support shares them on request. Only
 *   use this behind a proxy you control that sets X-Forwarded-For, or the
 *   header can be forged.
 *
 * Neither is authentication. They make a callback hard to fake, not impossible.
 */

type Handler = (req: Request) => Promise<Response>;

/** Answers 403, without reaching the agent, unless the request comes from an allowed address. */
export function allowOnly(handler: Handler, options: { ips: readonly string[]; ipOf: (req: Request) => string | undefined }): Handler {
  const allowed = new Set(options.ips.map((ip) => ip.trim()).filter(Boolean));
  if (allowed.size === 0) throw new TypeError("allowOnly needs at least one address");
  return async (req) => {
    const ip = options.ipOf(req);
    if (!ip || !allowed.has(ip)) return new Response("Forbidden", { status: 403, headers: { "content-type": "text/plain" } });
    return handler(req);
  };
}

/** The client address a proxy put first in X-Forwarded-For. Trust it only behind your own proxy. */
export function forwardedFor(req: Request): string | undefined {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || undefined;
}

/** "/ussd" under a secret: "/<secret>/ussd". A secret must be URL-safe and long enough to guess at no cost. */
export function secretPath(secret: string | undefined, path: string): string {
  if (!secret) return path;
  if (!/^[A-Za-z0-9_-]{16,}$/.test(secret)) {
    throw new TypeError("CALLBACK_SECRET must be at least 16 letters, digits, - or _ (for example: openssl rand -hex 16)");
  }
  return `/${secret}${path}`;
}
