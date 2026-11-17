import type { Plugin, ViteDevServer } from 'vite';
import type { OutputAsset, OutputChunk } from 'rollup';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { defineConfig } from 'vite';
import react from "@vitejs/plugin-react-swc";
import { VitePWA } from 'vite-plugin-pwa';
import path from "path";
import { stripWsPrefix } from "./src/lib/websocket-service/proxy-path";
import { manifestForBuild, checkedMinSeq } from "./src/lib/pwa/version-manifest";
import { MIN_BUILD_SEQ } from "./src/lib/pwa/min-build-seq";
import { VERSION_MANIFEST_PATH } from "./src/lib/pwa/deployed-version";
import { KIT_MANIFEST } from "./src/pwa/kit-manifest.generated";
import { serviceChunkFor, sharedServiceDependencyChunkFor } from "./src/build/service-chunks";
import { appCataloguePlugin } from "./src/build/app-catalogue-asset";
import { readFileSync } from "node:fs";

/**
 * The Content-Security-Policy the app ships under.
 *
 * PRODUCTION_CSP is byte-identical to the policy nginx sends in
 * docker/ui/nginx.conf.template. That is the whole point: `npm run preview` is the only
 * command that serves the real production bundle, so it is the only local place a CSP
 * violation can surface before deploy. It previously allowed `'unsafe-inline'` in
 * script-src plus https://cdn.gpteng.co and https://images.unsplash.com - none of which
 * nginx allows - which made preview STRICTLY MORE PERMISSIVE than production and unable
 * to catch the very class of bug it exists to catch. The gpteng/unsplash origins were
 * scaffold residue: nothing in the app loads from either.
 *
 * https://static.cloudflareinsights.com (script-src) and https://cloudflareinsights.com
 * (connect-src) are Cloudflare Web Analytics, whose beacon the hosted edge injects into every page.
 * https://challenges.cloudflare.com (script-src, frame-src) is Cloudflare Turnstile, which the
 * "Create new workspace" flow loads and renders in an iframe; the hosted Worker serves the same
 * policy (deploy/tenant-worker/control/ui.mjs in the parent repo).
 *
 * `img-src blob:` is the chat's pictures: shown from object URLs of bytes already sniffed as a
 * raster image (lib/received-files/picture-io.ts). Without it every one was refused and broken.
 *
 * `connect-src 'self'` is the load-bearing part: the agent socket is same-origin (`/ws`),
 * so 'self' covers it and no `ws:`/`wss:` wildcard is needed. A bare scheme source would
 * match ANY host, which would let an XSS payload exfiltrate to an attacker's socket.
 */
const PRODUCTION_CSP =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval' https://challenges.cloudflare.com https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' https://cloudflareinsights.com; frame-src https://challenges.cloudflare.com; worker-src 'self' blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

/**
 * Identical to production except for the two script-src sources Vite's dev transform
 * genuinely requires: 'unsafe-eval' and 'unsafe-inline' (the HMR client and the
 * react-refresh preamble are injected inline). Production has neither and must not.
 * Every other directive - and `connect-src` in particular - is deliberately the SAME,
 * so a violation fails in dev, where someone will notice.
 */
const DEV_CSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' https://challenges.cloudflare.com https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' https://cloudflareinsights.com; frame-src https://challenges.cloudflare.com; worker-src 'self' blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

/**
 * Proxy the agent's WebSocket so a locally-served app reaches it at the same same-origin `/ws`
 * path production uses.
 *
 * The app resolves its socket URL to `ws(s)://<page-host>/ws` (see
 * lib/websocket-service/resolve-url.ts). In production nginx proxies that to the agent; here Vite
 * does. Without it, local serving would need its own special-case URL - and a divergence between
 * how dev and production reach the agent is exactly how the CSP bug this replaces went unnoticed
 * for so long: dev's permissive CSP allowed `ws://localhost:12345`, production's `connect-src
 * 'self'` did not, and nothing exercised the production path.
 *
 * This is shared by BOTH `server` and `preview`. `preview` does not inherit `server.proxy`, and it
 * is the one command that serves the real production bundle - so without this, the closest thing we
 * have to a local production rehearsal would be the only place `/ws` 404s.
 *
 * AGENT_PORT lets a developer point at an agent on a non-default port without editing this file; it
 * defaults to the port the dev compose file binds.
 */
const agentProxy = {
  // `^/ws$` — an EXACT match, not a prefix. A plain '/ws' key is a prefix match in Vite, so it also
  // captures /wsfoo, /wsettings, and any future route that merely begins with those two letters,
  // forwarding them to the agent. Production does not: nginx uses `location = /ws`, which is exact,
  // and serves such paths from the SPA. Measured both ways - dev proxied /wsfoo (500) while nginx
  // returned the SPA (200) - so this was a real divergence in the one place that must not have one.
  // (Vite treats a key beginning with `^` as a RegExp.)
  '^/ws$': {
    // 127.0.0.1, NOT localhost. `localhost` resolves to ::1 before 127.0.0.1 on macOS
    // (and Node 17+ stopped reordering DNS results to prefer IPv4), while the agent
    // binds IPv4 only — so the proxy dialled ::1, got ECONNREFUSED, and every dev
    // WebSocket died with a bare "socket hang up". The app itself, test.config.json
    // and the compose healthchecks all already use 127.0.0.1; this was the one place
    // that did not.
    target: `ws://127.0.0.1:${process.env.AGENT_PORT ?? '12345'}`,
    ws: true,
    // Strip `/ws`, so the agent sees `/` - byte-identical to what the production nginx sends it
    // (`proxy_pass http://<upstream>/`, whose trailing slash does the same strip). The agent
    // accepts a handshake on ANY path today, so nothing is broken without this; the point is that
    // dev and production must not differ at the agent boundary. It lives in its own module so that
    // parity is pinned by unit tests rather than asserted in a comment - see proxy-path.ts.
    rewrite: stripWsPrefix,
  },
};

/**
 * This build's clock, `__BUILD_SEQ__` in the bundle and `seq` in `/version.json`: tabs of one
 * browser compare it to agree that the newest build leads (src/lib/multi-instance/build-identity.ts).
 */
const BUILD_SEQ: number = Math.floor(Date.now() / 1000);

/**
 * Emit `/version.json` so an open page can tell that a newer build is deployed
 * without a service worker (see src/lib/pwa/deployed-version.ts for why, and why the entry
 * chunk is the id).
 */
function versionManifestPlugin(): Plugin {
  let base: string | null = null;
  return {
    name: 'citadel-version-manifest',
    apply: 'build',
    configResolved(config: { base: string }): void {
      base = config.base;
    },
    generateBundle(_options: unknown, bundle: Record<string, OutputAsset | OutputChunk>): void {
      if (base === null) this.error('version.json: the config was never resolved');
      try {
        const minSeq: number = checkedMinSeq(MIN_BUILD_SEQ, BUILD_SEQ);
        this.emitFile({ type: 'asset', fileName: VERSION_MANIFEST_PATH.slice(1), source: manifestForBuild(bundle, base, { seq: BUILD_SEQ, minSeq }) });
      } catch (error: unknown) {
        this.error(error instanceof Error ? error.message : String(error));
      }
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  return {
    define: { __BUILD_SEQ__: JSON.stringify(BUILD_SEQ) },
    plugins: [
      react(),
      versionManifestPlugin(),
      // The parent's apps/catalogue/, mounted at /apps/catalogue in the dev container (docker-compose.yml)
      // and copied beside citadel-workspaces/ in the production image (docker/ui/Dockerfile).
      appCataloguePlugin(() => readFileSync(path.resolve(__dirname, '../apps/catalogue/catalogue.json'), 'utf8')),
      /**
       * Installable PWA + offline app shell.
       *
       * `registerType: 'prompt'` rather than 'autoUpdate': this app holds live
       * WebSocket and P2P state, and swapping the running bundle underneath an
       * open session would drop it. The user is asked instead (see PwaUpdatePrompt).
       *
       * The WASM client is deliberately NOT precached. At ~2.3 MB it would dominate
       * the install payload, and it is fetched on demand by the client anyway; it is
       * served from the runtime cache below so a repeat visit still gets it instantly.
       */
      VitePWA({
        registerType: 'prompt',
        includeAssets: ['favicon.ico', 'favicon.svg', 'mask-icon.svg', 'icons/apple-touch-icon-180.png'],
        // The brand kit's site.webmanifest is the base -- name, short_name, display,
        // scope and icons come from it, generated into KIT_MANIFEST -- and only what
        // the kit does not know about is added here. One manifest ships, not two.
        manifest: {
          ...KIT_MANIFEST,
          description: 'Post-quantum secure, peer-to-peer collaborative workspace.',
          id: '/',
          orientation: 'any',
          // The native menu-bar app opens the installed app AT an account. A
          // PWA shim drops https URLs handed to it by another app; a registered
          // scheme is what gets through, and arrives as `/?link=<the URL>`,
          // read by src/lib/onboarding/account-link.ts. `navigate-existing`
          // reuses the open window instead of stacking a second one.
          protocol_handlers: [{ protocol: 'web+citadel', url: '/?link=%s' }],
          launch_handler: { client_mode: 'navigate-existing' },
          // #1B1C27, NOT the kit's #1C1D28: it is what `--background: 235 18% 13%`
          // actually resolves to, and #1C1D28 (the brand ground) is a rounding step away;
          // keeping all three declarations byte-identical means the splash, the
          // titlebar and the painted page cannot disagree even slightly.
          background_color: '#1B1C27',
          // Matches background_color and index.html's meta, so the splash,
          // the install card and the launched window agree instead of the
          // titlebar changing colour a moment after the app appears.
          theme_color: '#1B1C27',
          categories: ['productivity', 'business', 'security'],
          // Jump straight to the two places people actually open the app for,
          // from the installed icon's context menu (right-click on desktop,
          // long-press on Android). An installed app that can only ever open on
          // its home screen makes installation worth less than a bookmark.
          //
          // Both are real routes in App.tsx, not aspirational ones: a shortcut
          // to a route that does not exist lands the user on the 404 page from
          // their own dock, which is worse than having no shortcut.
          shortcuts: [
            {
              name: 'Messages',
              short_name: 'Messages',
              description: 'Open your direct conversations',
              url: '/messages',
              icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
            },
            {
              name: 'Workspace',
              short_name: 'Workspace',
              description: 'Open the workspace and its rooms',
              url: '/workspace',
              icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
            },
          ],
          // Chrome shows its richer install dialog — imagery and description
          // rather than a bare confirm — only when the manifest carries
          // screenshots, and only uses a wide one on desktop when a `wide`
          // form_factor is declared. Both are here for that reason.
          //
          // Regenerate with
          // integration-tests/src/tools/capture-pwa-screenshots.spec.ts. The
          // `sizes` below must match the files on disk exactly; Chrome drops a
          // mismatched screenshot silently, so the install card would quietly
          // fall back to the plain prompt.
          screenshots: [
            {
              src: '/screenshots/wide.png',
              sizes: '1280x800',
              type: 'image/png',
              form_factor: 'wide',
              label: 'The Citadel Workspaces landing page on a desktop',
            },
            {
              src: '/screenshots/narrow.png',
              sizes: '412x915',
              type: 'image/png',
              form_factor: 'narrow',
              label: 'The Citadel Workspaces landing page on a phone',
            },
          ],
        },
        workbox: {
          // Precache the shell AND the WASM binary, together.
          //
          // The binary used to be excluded and runtime-cached instead, on the
          // reasoning that keeping it out kept the install small. That is what
          // made the pair splittable: the glue JS lives in hashed chunks the
          // precache versions atomically, so whichever strategy the binary uses
          // decides whether the two match. Every strategy that answers from a
          // DIFFERENT generation than the precache is wrong in one direction or
          // the other, and this repo has now shipped all three of them.
          //
          // Precaching removes the question. Both halves are revisioned by the
          // same service worker, so an old worker serves an old pair and a new
          // worker serves a new pair, and there is no window in which a page
          // holds one of each. The cost is a 3.3 MB background download during
          // install, which finishes before the update prompt is answered.
          //
          // webp included: the landing hero and the app backdrop are both .webp,
          // so without it every offline launch rendered the whole app with no
          // imagery at all — the one launch where it most wants to look normal.
          //
          // tex: the Citadel Docs hyphenation patterns (public/cdoc/patterns), sha256-pinned
          // by a manifest compiled into the precached JS. From the network, a deploy that
          // changed one would fail every document open from the old generation.
          globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,woff2,wasm,tex}'],
          // The install-card screenshots are fetched by the BROWSER from the
          // manifest, before there is an app to serve them, and are never
          // rendered by it afterwards. Precaching them added ~800 KB to the
          // install for bytes the app itself never asks for.
          //
          // assets/*.wasm is a hashed duplicate the bundler emits and nothing
          // ever requests — WASM init passes the stable /wasm/ URL explicitly.
          // Precaching it would double the install for bytes no page fetches.
          globIgnores: ['assets/*.wasm', '**/screenshots/*'],
          // Per file, 4 MiB: workbox drops an over-cap file from the precache SILENTLY.
          // The Citadel Docs binary grew past it with the editor (4,222,829 bytes at
          // citadel-docs aff63f9, 5,086,603 at f8656c6) and the cap followed it up to
          // 5,400,000; the editor/pdf split (citadel-docs #39) brought it back: the editor
          // artefact is 3,731,952 bytes at 791ffeb and the PDF artefact 2,248,236.
          maximumFileSizeToCacheInBytes: 4_194_304,
          // SPA fallback, minus the endpoints that must always hit the network.
          // `/`, never `/index.html`: the Worker's asset handler answers /index.html with a
          // 307 to `/`. Workbox's precache normally hides that, but when the cached copy is
          // missing it falls back to the network, and a redirected response to a navigation
          // is a network error -- every page failed with ERR_FAILED until site data was
          // cleared. Precaching the shell under `/` means both paths get a plain 200.
          navigateFallback: '/',
          manifestTransforms: [(entries) => ({
            manifest: entries.map((entry) => (entry.url === 'index.html' ? { ...entry, url: '/' } : entry)),
            warnings: [],
          })],
          navigateFallbackDenylist: [/^\/ws$/, /^\/api/],
          cleanupOutdatedCaches: true,
          runtimeCaching: [
            // There is no .wasm runtime-caching rule here on purpose.
            //
            // A runtime rule answers from a generation independent of the
            // precache, which is exactly how the glue and the binary came
            // apart. The binary is precached above, with the glue.
          ],
        },
        devOptions: {
          // Off by default: a service worker intercepting requests during
          // development makes HMR behaviour confusing to reason about.
          enabled: false,
          type: 'module',
        },
      }),
    ].filter(Boolean),

    // Prevent vite from obscuring rust errors
    clearScreen: false,

    // Use a writable cache directory (node_modules may be root-owned from Docker)
    cacheDir: '/tmp/citadel-vite-cache',

    // Handle Node.js modules
    optimizeDeps: {
      exclude: ['events', 'fs', 'path', 'crypto', 'os', 'util', 'citadel-workspace-client-ts'],
      // include: ['citadel-workspace-client-ts'],
    },

    build: {
      // Published source maps.
      //
      // Lighthouse flags `valid-source-maps` without them, but the real reason
      // is triage: a stack trace from a production incident is unreadable
      // against minified output, and this app's hardest failures (WASM init,
      // the P2P handshake) surface as exactly that.
      //
      // No secrecy is traded away — this repository is public, so the maps
      // expose nothing the source does not. They are separate .map files,
      // fetched only when devtools are open, and the landing budget counts
      // only assets referenced from index.html, so the critical path is
      // unaffected.
      sourcemap: true,
      // After splitting all vendor dependencies, the main app chunk (~1.25MB) contains:
      // - Application code (React components, services, hooks)
      // - WASM client bindings
      // This size is reasonable for a complex workspace app with real-time collaboration
      chunkSizeWarningLimit: 1300,
      rollupOptions: {
        external: ['events', 'fs', 'path', 'crypto', 'os', 'util'],
        output: {
          // Split vendor dependencies into separate chunks for better caching
          manualChunks(id, meta) {
            // Keep each of these service directories whole. Their barrel (index.ts)
            // re-exports a module that transitively depends on the barrel again, so
            // if the two land in different route chunks Rollup emits a circular-chunk
            // warning and, in its own words, "will likely lead to broken execution
            // order". Co-locating them removes the cycle at the chunk level and also
            // caches better: these services change far less often than the pages that
            // use them. "Whole" is two halves -- what the landing page statically
            // reaches, and what it does not -- see src/build/service-chunks.ts.
            const serviceChunk: string | undefined = serviceChunkFor(id, meta);
            if (serviceChunk) {
              return serviceChunk;
            }

            if (id.includes('node_modules')) {
              // The whole React runtime in ONE chunk. Splitting react-dom out while
              // leaving `react` itself in the entry chunk produced a genuine cycle
              // (vendor-react -> a vendor chunk that imports React -> vendor-react).
              // Rollup warns that such a cycle "will likely lead to broken execution
              // order", so this is a correctness fix rather than a size one.
              if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) {
                return 'vendor-react';
              }
              // Radix UI components
              if (id.includes('@radix-ui')) {
                return 'vendor-ui';
              }
              // Serialization and storage
              if (id.includes('cbor-x') || id.includes('/idb/')) {
                return 'vendor-data';
              }
              // Icons
              if (id.includes('lucide-react')) {
                return 'vendor-icons';
              }
              // Date utilities
              if (id.includes('date-fns')) {
                return 'vendor-date';
              }
              // Animations
              if (id.includes('framer-motion')) {
                return 'vendor-motion';
              }
              // React Query
              if (id.includes('@tanstack')) {
                return 'vendor-query';
              }
              // Zod validation
              if (id.includes('/zod/')) {
                return 'vendor-zod';
              }
            }
            return sharedServiceDependencyChunkFor(id, meta);
          },
        },
        onwarn(warning, warn) {
          // Suppress mixed dynamic/static import warnings for modules using
          // dynamic imports to avoid circular dependencies (intentional pattern)
          if (warning.code === 'MIXED_IMPORT' ||
            (warning.message && warning.message.includes('dynamically imported by') &&
              warning.message.includes('but also statically imported'))) {
            return;
          }
          warn(warning);
        },
      },
    },

    server: {
      port: 5291,
      strictPort: true,
      // Changed from 'localhost' to '0.0.0.0' for Docker container access
      host: '0.0.0.0',
      hmr: {
        overlay: true,
        // NO hardcoded clientPort. It was pinned to 5291, which silently assumed the page is always
        // served on that port - and when it is not (`vite --port`, a second instance, a port
        // remap), the HMR socket dials 5291 while the page sits elsewhere. That is a genuinely
        // cross-origin request, so the `connect-src 'self'` below now BLOCKS it and hot reload dies
        // with a CSP error rather than a useful one. Verified in a real browser: on a mismatched
        // port Chrome refuses `ws://localhost:5291/`, and with the port inferred there are no CSP
        // violations at all. Letting Vite derive it from the page keeps the two in lockstep by
        // construction, which is the same same-origin discipline the agent socket now follows.
      },

      // Shared with `preview` below - see agentProxy.
      proxy: agentProxy,

      // File watching configuration for Docker volumes
      watch: {
        // Enable polling for Docker volume mounts
        usePolling: true,
        // Poll interval in milliseconds (fallback if env var not set)
        interval: 100,
      },

      // Allow serving files from citadel-internal-service directory
      fs: {
        allow: [
          // Search up for workspace root
          '..',
          // Allow access to workspace mount in Docker
          '/workspace',
        ]
      },

      // Custom headers for your web app.
      //
      // `connect-src` is now IDENTICAL in dev and production. It used to differ: dev additionally
      // allowed `ws://localhost:* http://localhost:*`, which is precisely why the app appeared to
      // work while the production build could not connect at all. The old code pointed the socket
      // at `ws://localhost:12345`; dev's wildcard permitted it, production's `connect-src 'self'`
      // blocked it, and nothing exercised the production path - so the breakage stayed invisible.
      //
      // The socket is now same-origin (`/ws`, proxied to the agent by Vite here and by nginx in
      // production), so `'self'` covers it in both. Keeping the two policies in lockstep means a
      // future CSP violation fails in dev, where someone will notice, rather than only in a
      // shipped artifact. `script-src` now agrees on 'unsafe-eval' too: workspace documents are
      // MDX and rendering one executes it, so production needs what dev always had. That is a
      // deliberate decision with a compensating control — see lib/mdx-integrity.ts. The remaining
      // difference is 'unsafe-inline', which only Vite's dev transform needs.
      headers: {
        'Content-Security-Policy': mode === 'production' ? PRODUCTION_CSP : DEV_CSP
      },

      // Configure middleware for WASM files
      // Typed rather than left implicit: this file is in tsconfig.node.json,
      // which now also covers scripts/, so an untyped parameter here makes that
      // whole project fail to check.
      configure: (server: ViteDevServer) => {
        server.middlewares.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
          if (req.url?.endsWith('.wasm') || req.url?.includes('citadel_internal_service_wasm_client')) {
            res.setHeader('Content-Type', 'application/wasm');
            // Prevent caching of WASM files during development
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
          }
          next();
        });
      },
    },

    // `npm run preview` serves the real production bundle, and is therefore the closest thing to a
    // local production rehearsal. It inherits NOTHING from `server` - not the proxy, not the
    // headers - so both are restated here.
    //
    // The headers matter as much as the proxy. Without them preview serves no CSP at all, so the
    // one command that exercises the production bundle would be the one place a CSP violation
    // CANNOT surface - which is exactly the blind spot that let the original bug ship. Production
    // gets this policy from nginx; preview stands in for nginx, so it has to send it too.
    preview: {
      proxy: agentProxy,
      headers: { 'Content-Security-Policy': PRODUCTION_CSP },
    },

    // Your existing alias configuration
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
        // Explicit alias for WASM client to ensure proper resolution
        // Points to root node_modules since npm workspaces hoists dependencies
        "citadel-internal-service-wasm-client": path.resolve(__dirname, "../node_modules/citadel-internal-service-wasm-client"),
      },
    },

    esbuild: {
      target: "esnext",
      // In production: strip console.log and console.debug (treat as pure/side-effect-free).
      // console.error and console.warn are preserved for runtime error visibility.
      //
      // `debugLog` is on this list for a reason that is easy to miss: in
      // production it is already a `noop`, but the 1,000-plus CALL SITES remain,
      // and their arguments are still evaluated. That is not only dead bytes on
      // a phone's first paint — `formatForDebug(...)` recursively stringifies
      // the serialized session store on every write, in production, to feed a
      // function that discards it. Marking the call pure lets the minifier drop
      // the call and its arguments together.
      //
      // `errorLog` is deliberately NOT here: it logs in every build, because a
      // render crash is the one error a user cannot report themselves.
      ...(mode === 'production' ? {
        pure: ['console.log', 'console.debug', 'console.info', 'debugLog'],
        drop: ['debugger'],
      } : {}),
    },

    // Configure WASM mime type
    assetsInclude: ['**/*.wasm'],

    // The Citadel Docs worker (src/lib/cdoc/worker/cdoc.worker.ts) is a module worker that loads
    // the cdoc glue with a dynamic import, which needs ES output: the default 'iife' cannot
    // split chunks. Every browser the app supports runs module workers.
    worker: {
      format: 'es',
    },
  };
});
