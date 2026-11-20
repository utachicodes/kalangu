/**
 * Work that outlives the request (docs/design.md §4.4): deferred answers
 * and SMS replies. The default runs in this process, which is right for a
 * long-running server. On serverless platforms the process may be frozen
 * once the response is sent, so pass something that keeps it alive, e.g.
 * `{ run: (task) => ctx.waitUntil(task()) }` on Cloudflare Workers, or a
 * queue hand-off. Without one, deferred answers are never sent.
 */
/** Fire-and-forget in this process; failures are logged, never thrown. */
export function inProcessBackground(logger) {
    return {
        run(task) {
            Promise.resolve()
                .then(task)
                .catch((err) => {
                logger.error("Background task failed", {
                    error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
                });
            });
        },
    };
}