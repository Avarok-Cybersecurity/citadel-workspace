/**
 * Where a link inside rendered content actually points.
 *
 * Markdown and MDX rendered by this app carry hrefs written by PEOPLE — the
 * author of a workspace document, or the peer who sent you a chat message. The
 * renderers used to hand those straight to a bare `<a href>`, which is wrong in
 * three separate ways at once:
 *
 *  1. A link to another page in the workspace (`/workspace?nodeId=…`, or the
 *     full URL copied out of the address bar) did a FULL DOCUMENT LOAD instead
 *     of a router navigation. In this app that is not merely slow: a reload
 *     tears down the WASM client and the WebSocket to the local agent, so the
 *     app comes back up in its reconnect path and the node you asked for is not
 *     what you end up looking at. To the user, clicking the link "does nothing".
 *  2. External links got no `rel="noopener noreferrer"`, so a page opened from
 *     someone else's document could reach back through `window.opener`.
 *  3. The office/MDX path has no URL sanitisation of any kind — `@mdx-js`
 *     `evaluate()` has no `urlTransform`, unlike react-markdown — so a stored
 *     `javascript:` href from a document written by another workspace member
 *     reached the DOM live.
 *
 * Classification is a pure function of the href and the page it is being read
 * on: the caller passes `currentUrl` rather than this module reaching for
 * `window`, so every branch below is testable without a DOM.
 */

/** What a renderer should do with one href. */
export type DocumentLinkTarget =
  /** Same-origin: hand `to` to the router so the SPA never reloads. */
  | { kind: 'internal'; to: string }
  /** Somewhere else entirely: open in a new tab, severed from this one. */
  | { kind: 'external'; href: string }
  /** An anchor within the page being read; the browser handles it natively. */
  | { kind: 'hash'; href: string }
  /** Refused. Render the text, but not as something clickable. */
  | { kind: 'inert' };

/**
 * Schemes that are safe to hand to the OS but are not web pages, so origin
 * comparison is meaningless for them. Anything NOT listed here and not
 * http(s) is refused, because this is an allowlist: `javascript:`, `data:`,
 * `vbscript:`, `blob:` and `file:` all have to fall through to `inert`, and a
 * denylist of "the bad ones we thought of" would not survive the next scheme.
 */
const SAFE_NON_WEB_SCHEMES: ReadonlySet<string> = new Set(['mailto:', 'tel:', 'sms:']);

export function classifyDocumentLink(
  href: string | undefined,
  /** Absolute URL of the page the link is being rendered on. */
  currentUrl: string,
): DocumentLinkTarget {
  const raw: string = (href ?? '').trim();
  if (raw === '') return { kind: 'inert' };

  // A bare fragment stays a plain anchor. Routing it would push a history entry
  // for what is only a scroll, and the browser already does the right thing.
  if (raw.startsWith('#')) return { kind: 'hash', href: raw };

  let url: URL;
  let base: URL;
  try {
    base = new URL(currentUrl);
    // Resolving against the current page is what makes relative (`sibling`),
    // root-relative (`/workspace?nodeId=…`) and protocol-relative (`//host`)
    // hrefs all reduce to one comparison. It is also why obfuscated schemes are
    // caught: the URL parser strips the tabs and newlines that `java\tscript:`
    // relies on, so `url.protocol` is the real scheme rather than the spelling.
    url = new URL(raw, base);
  } catch {
    // An href the URL parser cannot make sense of is not one we can safely
    // guess at.
    return { kind: 'inert' };
  }

  if (url.protocol === 'http:' || url.protocol === 'https:') {
    return url.origin === base.origin
      // Origin dropped deliberately: the router wants a path, and keeping the
      // origin is how a same-origin link would sneak back into a full load.
      ? { kind: 'internal', to: `${url.pathname}${url.search}${url.hash}` }
      : { kind: 'external', href: url.href };
  }

  if (SAFE_NON_WEB_SCHEMES.has(url.protocol)) return { kind: 'external', href: url.href };

  return { kind: 'inert' };
}
