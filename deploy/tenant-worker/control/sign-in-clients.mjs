/**
 * The return-origin allowlist of "Sign in with Citadel" (sign-in-with-citadel.md §2), served
 * publicly at /sign-in/clients.json: the SSOT for the page and the issuer. A client's `aud` and
 * `display_name` come from here and nowhere else; a `return` not listed for its client is refused
 * before any state exists. Return URLs are https, host, optional port, an absolute path, and no
 * query, fragment, wildcard or userinfo; matching is exact.
 */

export const SIGN_IN_CLIENTS = Object.freeze({
  v: 1,
  clients: Object.freeze({
    "sw-mcp": Object.freeze({ display_name: "synchronized.work MCP", aud: "sw-mcp", returns: Object.freeze(["https://work.avarok.net/sign-in/code"]) }),
    "synchronized.work": Object.freeze({ display_name: "synchronized.work", aud: "synchronized.work", returns: Object.freeze(["https://synchronized.work/auth/return"]) }),
  }),
});

/** The schema's shape of a return URL (sign-in-with-citadel.schema.json `ReturnUrl`). */
export const RETURN_SHAPE = /^https:\/\/[a-z0-9.-]+(?::[1-9][0-9]{0,4})?\/[A-Za-z0-9._~/-]*$/;

/** The registered client, or null. */
export const clientOf = (id) => (Object.hasOwn(SIGN_IN_CLIENTS.clients, id) ? SIGN_IN_CLIENTS.clients[id] : null);

/** Whether `url` is one of `client`'s returns, exactly. */
export const returnAllowed = (client, url) => typeof url === "string" && RETURN_SHAPE.test(url) && client.returns.includes(url);

/** The origins a browser client completes from (§5: CORS allows exactly these). */
export const completionOrigins = () =>
  new Set(Object.values(SIGN_IN_CLIENTS.clients).flatMap((c) => c.returns.map((r) => new URL(r).origin)));
