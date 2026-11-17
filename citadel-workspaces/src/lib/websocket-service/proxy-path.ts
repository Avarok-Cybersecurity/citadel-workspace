/**
 * Path rewriting for the local `/ws` dev proxy.
 *
 * This exists as a tested module rather than an inline arrow in vite.config.ts because of what it
 * is FOR: keeping the local dev/preview servers byte-identical to production at the agent boundary.
 * Production nginx uses `proxy_pass http://<upstream>/`, whose trailing slash strips the matched
 * `/ws` prefix, so the agent sees `/`. Vite must send the same thing.
 *
 * If that silently drifts, dev and production disagree about what reaches the agent - and a
 * dev/production divergence is exactly how the CSP bug this whole change fixes stayed invisible for
 * so long (dev's laxer policy allowed an off-origin socket, production's did not, and nothing
 * exercised the production path). Leaving the one piece of parity logic untested would repeat that
 * mistake in miniature.
 */

/**
 * Strip the `/ws` prefix a request arrived on, yielding the path to forward to the agent.
 *
 * `/ws` -> `/`, `/ws/foo` -> `/foo`, `/ws?t=1` -> `/?t=1`.
 *
 * The result ALWAYS begins with `/`. Two inputs would otherwise not: the bare prefix (`/ws`, which
 * strips to an empty string) and a prefix carrying only a query (`/ws?t=1`, which strips to
 * `?t=1`). Neither is a valid HTTP request target, and more to the point neither is what production
 * sends - nginx was observed emitting `GET / HTTP/1.1` and `GET /?token=abc HTTP/1.1` for those two
 * requests. Since this function exists solely to keep dev byte-identical to production at the agent
 * boundary, it has to match that.
 */
export function stripWsPrefix(path: string): string {
  // The lookahead is the whole correctness of this function. `/^\/ws/` alone matches any path
  // merely BEGINNING with those two letters, so `/wsfoo` would strip to `/foo` - silently
  // rewriting an unrelated route into a different one. Requiring `/ws` to be followed by `/`, `?`
  // or the end of the string makes it a segment match, which is what nginx's `location = /ws`
  // does. The caller passes only `/ws` today (the proxy key is an exact match), but this is an
  // exported function with its own contract and should not depend on that.
  const rest: string = path.replace(/^\/ws(?=[/?]|$)/, '');
  if (rest === path) return path; // No prefix matched - leave it completely alone.
  return rest.startsWith('/') ? rest : `/${rest}`;
}
