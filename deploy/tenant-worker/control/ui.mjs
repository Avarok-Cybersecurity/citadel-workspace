/**
 * The UI, served from this Worker's static assets on the control host. It replaces the nginx
 * image (docker/ui/nginx.conf.template) for the hosted deployment, so it sends what that image
 * sent -- the same security headers, the same cache rules per kind of file, the same index.html
 * meta tags filled in -- plus what hosting here adds: Turnstile allowed by the CSP, the control
 * plane switched on, and HSTS (nginx sat behind a TLS terminator that owned it; this is that
 * terminator's origin now).
 *
 * No I/O of its own: the assets binding is passed in.
 */

/** Cloudflare Turnstile: its script and its challenge iframe (the creation flow's widget). */
export const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";

/**
 * Cloudflare Web Analytics: the edge injects its beacon script from the first origin into every
 * HTML page, and the beacon reports to the second. Cookie-less, page views and load timings only.
 * Without these the policy blocked the injected script on every page load.
 */
export const WEB_ANALYTICS_SCRIPT_ORIGIN = "https://static.cloudflareinsights.com";
export const WEB_ANALYTICS_REPORT_ORIGIN = "https://cloudflareinsights.com";

/** Where the page finds the control plane (dispatch.mjs answers `/api/*` on this host). */
export const CONTROL_PLANE_PATH = "/api";

/**
 * The policy nginx sends, with Turnstile added. `loopbackAgent` is the one off-origin socket the
 * page may open -- the visitor's own agent -- and is the same value the page is told to dial, so
 * the two cannot disagree. scripts/check-preview-csp-matches-production.mjs holds this, nginx's
 * and vite's PRODUCTION_CSP to one policy.
 */
export function contentSecurityPolicy(loopbackAgent) {
  const connect = ["'self'", loopbackAgent, WEB_ANALYTICS_REPORT_ORIGIN].filter(Boolean).join(" ");
  return [
    "default-src 'self'",
    `script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval' ${TURNSTILE_ORIGIN} ${WEB_ANALYTICS_SCRIPT_ORIGIN}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    `connect-src ${connect}`,
    `frame-src ${TURNSTILE_ORIGIN}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}

/** The headers every UI response carries, whatever the file (nginx: every location). */
export function securityHeaders(loopbackAgent) {
  return {
    "strict-transport-security": "max-age=31536000; includeSubDomains",
    "x-frame-options": "DENY",
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
    "permissions-policy": "geolocation=(), microphone=(self), camera=(self), display-capture=(self)",
    "content-security-policy": contentSecurityPolicy(loopbackAgent),
  };
}

/**
 * Cache policy and, where the default is wrong, content type, per path -- nginx's locations, in
 * its order of precedence (exact matches, then the `.wasm` regex, then the `/assets/` prefix).
 * `strict` marks paths nginx served without the SPA fallback: a miss there is a 404, never
 * index.html (which would otherwise be cached a year under a hashed asset's name).
 */
export function fileRule(pathname) {
  if (pathname === "/sw.js") return { cache: "no-cache, no-store, must-revalidate", strict: false };
  if (pathname === "/manifest.webmanifest") {
    return { cache: "public, max-age=3600", type: "application/manifest+json", strict: false };
  }
  // The WASM client's URL is stable while its bytes change: revalidate, never `immutable`.
  if (/\.wasm$/i.test(pathname)) return { cache: "public, no-cache", type: "application/wasm", strict: true };
  // Vite's content-hashed bundles.
  if (pathname.startsWith("/assets/")) return { cache: "public, max-age=31536000, immutable", strict: true };
  // index.html (and the SPA fallback) names the hashed bundles, so it must revalidate.
  return { cache: "public, no-cache", strict: false };
}

/** The values index.html's empty meta tags are given (nginx's sub_filter lines). */
export function pageMeta(ui) {
  return {
    "citadel-loopback-agent": ui.loopbackAgent,
    "citadel-default-server": ui.defaultServer,
    "citadel-control-plane": CONTROL_PLANE_PATH,
  };
}

const isHtml = (response) => (response.headers.get("content-type") ?? "").toLowerCase().startsWith("text/html");

/**
 * The Web Analytics beacon, placed in the page by this Worker rather than injected by the edge.
 * The service worker serves every later visit from its own cache, which the edge never sees, so
 * edge injection counted first visits only; a beacon in the page itself is cached with it.
 */
export function webAnalyticsBeacon(token) {
  return `<script defer src="${WEB_ANALYTICS_SCRIPT_ORIGIN}/beacon.min.js" data-cf-beacon='{"token":"${token}"}'></script>`;
}

/** Fills the page's meta tags in, and adds the analytics beacon, as the page is streamed. */
function withMeta(response, meta, analyticsToken) {
  let rewriter = new HTMLRewriter();
  if (analyticsToken) {
    rewriter = rewriter.on("head", {
      element: (el) => {
        el.append(webAnalyticsBeacon(analyticsToken), { html: true });
      },
    });
  }
  for (const [name, content] of Object.entries(meta)) {
    rewriter = rewriter.on(`meta[name="${name}"]`, {
      element: (el) => {
        el.setAttribute("content", content);
      },
    });
  }
  return rewriter.transform(response);
}

/**
 * A UI request: `assets` is the Worker's static-assets binding, `ui` the deployment's
 * `{loopbackAgent, defaultServer}` (config()).
 */
export async function serveUi(assets, ui, request) {
  if (!assets) throw new Error("the ASSETS binding is not configured (wrangler.toml [assets])");
  const url = new URL(request.url);
  const rule = fileRule(url.pathname);
  const found = await assets.fetch(request);
  // The SPA fallback answers a missing hashed bundle or binary with index.html; nginx 404'd those.
  const missing = rule.strict && isHtml(found);
  const body = missing ? new Response("not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } }) : found;
  const response = new Response(body.body, body);
  for (const [name, value] of Object.entries(securityHeaders(ui.loopbackAgent))) response.headers.set(name, value);
  if (!missing) {
    response.headers.set("cache-control", rule.cache);
    if (rule.type) response.headers.set("content-type", rule.type);
  } else {
    response.headers.set("cache-control", "no-store");
  }
  if (missing || !isHtml(response)) return response;
  // The page already carries the beacon (above), so the edge must not add a second one; no-transform
  // is the header Cloudflare honours for that. Caching is unchanged.
  if (ui.webAnalyticsToken) response.headers.set("cache-control", `${rule.cache}, no-transform`);
  return withMeta(response, pageMeta(ui), ui.webAnalyticsToken);
}
