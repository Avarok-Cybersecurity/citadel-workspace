/**
 * Fails the build if the landing route's critical path grows past its budget.
 *
 * "Lightning fast" is easy to achieve once and lose gradually: one eager import
 * in a shared provider pulls a chunk onto the first paint and nobody notices,
 * because nothing was measuring. This measures.
 *
 * The critical path is taken from dist/index.html rather than guessed — the
 * entry script, everything Vite modulepreloads alongside it, and the stylesheet.
 * That is exactly the set a first-time visitor must download before the landing
 * page can render, which is the number worth defending.
 *
 * Note what is NOT in it, and should stay out: the Office route (~128 KB gzip)
 * and the collaborative-editor vendor chunk (~128 KB) are lazy, and the WASM
 * client is fetched after auth. If either shows up here, something started
 * importing them eagerly.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

/**
 * Budget in gzipped KB.
 *
 * Measured at 273 KB when this was introduced. The headroom is deliberate but
 * small: enough that an ordinary feature does not trip it, tight enough that
 * pulling a vendor chunk onto the landing page does. Raising it should be a
 * decision someone makes on purpose, with the breakdown below in front of them.
 *
 * Most of the current total is load-bearing: the landing page itself renders
 * OrphanSessionsNavbar and ManageAccountsButton, so the connection/session layer
 * is genuinely needed there and cannot simply be deferred.
 *
 * Raised from 300 to 310 after thirty hardening rounds put the measured path at
 * 305 KB. I looked for the single import to blame and there isn't one: stubbing
 * out the presence module's service imports moved the number by 0.1 KB, and
 * moving the discard-prompt constant out of an office module moved it by none.
 * The growth is the consolidation itself — one `formatBytes` where there were
 * eleven, one claim path where there were eight — and a shared module the
 * landing page reaches costs what eleven tree-shaken copies did not.
 *
 * Ten, not fifty: the point of the number is that the NEXT ten kilobytes have
 * to be argued for too. A budget raised to whatever the current total happens
 * to be has stopped being a budget.
 *
 * Raised from 310 to 311 for 0.6 KB, and this time there IS a single import to
 * blame — two of them, both bought something:
 *
 *   +0.4 KB  index/         `WorkspaceAppearanceSection` moved onto
 *                           `usePermission`. It had built its own permission
 *                           gate with a fetch-once effect, so one unanswered
 *                           request left the workspace's own owner looking at a
 *                           read-only theme editor captioned "Set by a
 *                           workspace admin", permanently.
 *   +0.1 KB  app-services/  `describeError`. Eight toasts interpolated a raw
 *                           thrown value, and the revfs and websocket layers
 *                           reject with structured payloads, so what a user
 *                           actually read was "Failed to delete: [object
 *                           Object]".
 *
 * One kilobyte, not ten: at 310.3 measured this leaves 0.7 KB, so the next
 * growth has to be argued for as well. `callFailureDetail`, added in the same
 * stretch, is correctly OFF the critical path and cost nothing — checked by
 * grepping the built chunks rather than assumed.
 *
 * 311 -> 312, for `data-testid` on shell components that specs address:
 * the workspace switcher, the shared confirm dialog's action, the group
 * conversation log and each message. Six attributes, and the measured overage
 * was TWELVE gzipped bytes on 318,464.
 *
 * That number is the argument. Removing one of the six -- the confirm dialog's
 * Cancel, which no spec addresses and which should not have been added -- made
 * the total WORSE, 12 bytes over to 40, because deleting text reshuffles gzip's
 * dictionary. At this granularity the reading is compression noise, so trimming
 * attributes is not optimisation, it is guessing. The budget exists to catch a
 * CHUNK arriving on the critical path, which shows up as tens of kilobytes and
 * is still caught with a kilobyte of headroom.
 *
 * Raised from 312 in round 481, deliberately and with the reasoning recorded.
 *
 * CI measured 312.3 KB against 312 after the peer-group work — a real product
 * capability, and an overage of 0.1%. Two experiments in round 476 established
 * that no chunk had arrived, which is what this budget exists to catch: making
 * the RE-VFS delivery path a dynamic import changed the total by nothing, and
 * removing `p2p` and `peer-registration-store` from the `app-services` chunk
 * also changed it by nothing, because they are reachable from the landing
 * ENTRY. Chunk assignment cannot move what the import graph pulls in.
 *
 * The header above already says what a reading at this granularity is worth:
 * twelve gzipped bytes moved the wrong way when text was DELETED, because
 * deleting reshuffles gzip's dictionary. A 0.3 KB overage is that noise, not a
 * regression, and the local build cannot even reproduce it — macOS/Node 20
 * measures 311.0 for the same source CI reads as 312.3.
 *
 * 314 keeps roughly the kilobyte of headroom the header assumes, so a chunk
 * arriving is still caught by tens of kilobytes.
 *
 * The real reduction is recorded rather than done: the landing page — the
 * connect and login screen — eagerly reaches the P2P messenger and the peer
 * registration store, now 87 KB on the critical path. That is an import-graph
 * change worth tens of kilobytes, and verifying it needs the integration suite.
 * Lowering this number back is what finishing that work looks like.
 *
 * ## Raised to 322, deliberately, for rounds 482-510
 *
 * Measured 321.9. The growth is entirely `app-services` — `lib/p2p`,
 * `connection-service`, `peer-registration-store`, kept as one chunk because
 * their barrels cycle — which gained roughly eight gzipped kilobytes across
 * thirty rounds of correctness work: the message-status ladder, the
 * pagination-boundary dedupe, the conversation session reset, the file-transfer
 * delivery path, the peer-failure translator, the per-account metadata filter.
 * Every one of those is a fix with a failing test behind it, and none of them
 * put a new CHUNK on the path — which is the thing this check exists to catch,
 * and it would still catch it by tens of kilobytes.
 *
 * That is the second deliberate raise, and a third should not happen. `app-services`
 * is on the critical path for one reason: `WorkspaceApp` wraps the entire app,
 * landing page included, and reaches those services eagerly. Splitting it is not
 * the answer — it is a provider shell, not a route, so lazy-loading it would
 * delay the landing page it is meant to speed up. Deferring the service
 * initialisation until after auth is, and that returns the whole 87 KB rather
 * than arguing about eight.
 *
 * ## 322.6 -> 309.6 without raising it
 *
 * Most of that 87 KB was never needed on the landing page at all; it was pulled
 * there by three things that did nothing. `MessagingService` was constructed and
 * cleaned up by `useConnectionHandler` and held by `ConnectionService` behind a
 * getter nobody called, and it imported the whole P2P barrel. Two landing
 * modules imported `useRetry`/`useToast`/`useEventListener` through the
 * `@/hooks` barrel, whose side-effect imports reach the messenger and the group
 * stores. And `manualChunks` put every P2P module in `app-services` whatever
 * reached it, so even an unreachable messenger was preloaded. The messenger is
 * still constructed at boot, by main.tsx's dynamic import, after first paint.
 * DEFERRED_MODULES below fails if any of it comes back.
 *
 * 322 -> 323, approved by the owner (2026-09-28): features are not cut to fit this number; it is
 * our own tripwire for a chunk arriving on the landing page by accident, not a Lighthouse limit.
 *
 * CI read 322.0 for the fix that stops polling sessions the agent no longer holds: the session
 * start-up sequence runs on the landing page, so its new "is this session still the agent's?"
 * check is on the critical path. That is a real fix, not a chunk arriving. The way to lower this
 * is skeleton-first loading with the shell in smaller chunks and service initialisation deferred
 * until after sign-in -- worth tens of kilobytes -- not trimming features.
 *
 * 323 -> 324 (2026-09-29), same standing approval: CI read 323.0 once the phone navigation
 * drawer carried its accessible title and description (UI #93). The sidebar renders on the
 * landing page, so those two visually hidden lines are on the critical path. An accessibility
 * fix, not a chunk arriving.
 *
 * 324 -> 325 (2026-10-01), same standing approval: CI read 324.2 for UI #104. The landing page now
 * says which saved accounts the server signed out (agent #92's signed_out list) and waits for the
 * saved-account list before saying there is none (#105's useSavedAccounts). Both run on the
 * landing page by design; DEFERRED_MODULES still passes, so nothing deferred arrived early.
 * 325 -> 326 (2026-10-01), same approval, multi-window sessions (UI #107): the greeting and join check
 * run at start-up; deferring takeover, rejoin, watchers and sender cut 326.5 to 325.2, rest is gzip noise.
 * 326 -> 327 (2026-10-03), same approval: the 0.8.7 release assembly measured 326.002 at UI 3a13c9fd.
 * #114 had already moved its update banner off the path (it renders from the lazy AgentUpdateWatcher;
 * an eager import measured +0.9 KB). The rest is #117 (+49 shared, +28 CSS): a leader tab whose agent
 * socket never opens now ends the sign-in dialog's wait instead of leaving it blank forever. A
 * fix on the landing page by design, not a chunk arriving; DEFERRED_MODULES still passes.
 * 327 -> 328 (2026-10-04), the connection supervisor's UI side: 326.3 -> 327.2. The capability the
 * agent declares (`supervises_p2p`) decides, on the landing path, whether every dial, poll and retry
 * runs at all, so reading it (capabilities.ts, its gates in connection-logic/polling/service) cannot be
 * deferred. Everything else was: Interest, the status listener and the stand-down wiring are lazy and
 * listed in DEFERRED_MODULES, the chat pill's copy moved out of the shared path-copy module, and the
 * Interest builder lives in the lazy module rather than the wire-name module. Measured, not guessed:
 * source-map attribution of app-services put the remaining +1.7 KB raw in capabilities.ts (346 B),
 * supervised.ts (347 B), the wire names (154 B), and the follower's answer (107 B).
 *
 * 328 -> 332 (2026-10-05), once, for N+1 notification ownership (UI #126) and the room the sign-in
 * (#127) and polish (#129) PRs need, both also at the limit: one raise rather than three that conflict.
 * #126 measured 328.2 against master's 327.6. What did not have to be on the landing path was moved
 * off it: the OS notification's delivery (who owns it, the surface, the chime -- interrupt-os.ts,
 * listed in DEFERRED_MODULES) loads with the first notification for a window not in front, and the
 * window is still read as the notification arrives, so nothing is decided late or lost. That took it
 * to 327.9. What remains (+0.3 KB) is state that has to be kept from the moment the socket opens,
 * before any chat loads: whether a notifier is attached to the agent (`notices_heard`, its change
 * notification, the leader's relay to followers) and the announcement of every successful claim,
 * which the landing page's own claims make.
 *
 * 332 -> 334 (2026-10-18), for secure links (UI #166) meeting Citadel Docs on master: master measured
 * 331.6, the merge 333.9. What did not have to be on the landing path was moved off it: resolving a
 * link, its target rules and the secure-links client (3.7 KB raw by source map) now load only when a
 * visitor arrived with one (lib/share/resolve-here.ts; listed in DEFERRED_MODULES). That took it to
 * 332.7. What remains (+1.1 KB) is what must run before render: capturing `?redirect=&server=`
 * before sign-in can drop it (pending-redirect.ts, 1,041 B), the no-link answer every ordinary
 * sign-in takes (resolve-here.ts, 607 B) and the landing page's sign-in prompt for a link (141 B).
 *
 * 334 -> 335 (2026-10-18), for opening a document from the kept workspace tree while the server
 * link is down: r1 measured 334.6 with the tree rules (offline-tree.ts) eager in the landing
 * chunk. They now load with the first save or read (hooks/use-kept-tree.ts; listed in
 * DEFERRED_MODULES), which took it to 334.1. What remains is what the loader must decide before
 * render on a reload with no connection: whether this device kept a tree, so the workspace opens
 * offline instead of spinning on "Reconnecting" (useKeptTree and the loader rule).
 *
 * 335 -> 338 (2026-10-21), for tabs of different builds in one browser (the channel envelope):
 * the base measured 335.0, this 337.3. What did not have to be on the landing path was moved off
 * it: the kill switch loads only when /version.json pulls it (lib/pwa/kill-switch.ts; listed in
 * DEFERRED_MODULES), which took it to 337.2. What remains has to run from the first message on
 * the channel, before any page renders: the envelope, the epoch fence, the ranking of builds and
 * the protocol-1 put-down in the election (+1.4 KB, app-services), and the stale tab's banner and
 * hidden-tab reload with its safety registry (+0.7 KB, index). The stale response is not deferred
 * on purpose: a stale tab is the one whose lazy chunks may be gone, and a failed chunk load
 * reloads at once (main.tsx), during a call or an upload, which is what it exists to avoid.
 *
 * 338 -> 339 (2026-10-21), for Citadel Apps' links: the base measured 337.8, this 338.2. The
 * marketplace, its consent screen, the manifest rules and the app-zone runtime are all off the
 * path (listed in DEFERRED_MODULES), and its new styles reuse classes the landing CSS already
 * has, so the CSS is byte-identical. What remains has to run before sign-in can drop it, like a
 * secure link's: keeping `/workspace?app=…` at boot (citadel-apps/app-link-capture.ts, 339 B raw,
 * judged only when taken), the boot composition of both captures (boot-links.ts, 130 B), and the
 * response handler passing an Apps answer to its waiter (+53 B in app-services).
 *
 * 339 -> 340 (2026-11-15), for calls from any tab (fix/chat-files-calls): master measured 338.0,
 * the files lane 338.2 (the picture bubble's CSS), the calls lane alone 339.8, the merge 340.0.
 * What did not have to be on the landing path was moved off it: the media lifecycle imported one
 * string from the failed-call copy and carried all of it (lib/call/lost-on-takeover.ts now holds
 * the string; call-failure-detail.ts is listed in DEFERRED_MODULES), which took it to 339.7. What
 * remains has to run in every tab from boot, because a call may now ring, be answered or end in
 * any of them: the ringing hand-off (1,037 + 652 B raw by source map), the departure and
 * taken-elsewhere notices (550 + 683, 455 + 335 B), and the follower's media-frame relay (693 B).
 *
 * 340 -> 341 (2026-11-15), for a Connect that names its server (fix/chat-files-calls-switch):
 * the base measured 339.9, this 340.5. Resolving which server a sign-in names, the typed refusals
 * and the registration form's held-username check load with their forms (sign-in-server.ts,
 * connect-refusal.ts, join/use-held-username.ts), and the agent's account list loads when asked
 * (io.ts agentAccounts), all off the path. What remains is what the reconnect paths need from
 * boot: `server_address` on the Connect with its refusal to send an empty one (auth-operations.ts),
 * and the stored record's server, taken from the agent and backfilled when the record has none,
 * with the hand-off to a sign-in when nobody can say (connection/stored-server.ts, +0.5 KB).
 *
 * 341 -> 342 (2026-11-16), for the welcome, call-goodbye and dialog-footer fixes merged onto
 * fix/chat-files-calls: measured 341.1. What each adds runs from boot (raw bytes by source map):
 * the per-account "welcome shown" check made on every connection, including the reconnect a
 * returning user boots into (welcome/welcome-once.ts, 343 B); the goodbye a tab sends before it
 * lets a call's media go, since any tab may be closed mid-call (multi-instance/departure-steps.ts
 * and release-holds.ts, 122 + 268 B); and the shared footer that wraps a dialog's answers so none
 * is clipped at 390px (ui/footer-layout.ts, 97 B, used by Dialog and AlertDialog).
 *
 * 341 -> 344 (2026-11-15), for the Calendar release (fix/chat-files-calls-calendar): the batch
 * at 341 merged with three lanes that each fit their own lane's headroom under 339, and the sum
 * measured 343.7 (343.9 once the batch's 342 above merged too; 344 holds both). What the
 * lanes put on the path runs from boot in every tab: a node's tabs, read
 * when any node renders (node-tabs/tab-list.ts 1,072 + tab-memory.ts 535 + tab-keys.ts 62 B raw
 * by source map, and the service's node-tabs-operations.ts 551); a node channel's reactions,
 * receipts and typing, which arrive whatever page is open (group-conversations/channel-signals.ts
 * 580, workspace-service/group-chat-signals.ts 626, response-handler/group-signal-handlers.ts 446,
 * chat-attachments-event.ts 138); and the Members answer's booking guests (members-event.ts).
 */
const BUDGET_KB = 344;

/**
 * Modules that must stay OFF the critical path, checked against the source
 * maps of the assets index.html loads. Each must also appear in SOME map, so a
 * rename cannot turn this into a check of nothing.
 */
const DEFERRED_MODULES = [
  'src/lib/p2p/p2p-messenger-manager.ts',
  'src/lib/agent-supervisor/interest.ts',
  'src/lib/agent-supervisor/status.ts',
  'src/lib/agent-supervisor/wire-up.ts',
  'src/lib/notification-service/interrupt-os.ts',
  // Citadel Docs: the page view, the worker and the decoder load when a document opens.
  'src/components/documents/DocsCanvas.tsx',
  'src/lib/cdoc/worker/cdoc.worker.ts',
  'src/lib/cdoc/display-list/decoder.ts',
  // Secure links: resolving one, its target rules and the client load only when a visitor
  // arrived with a link (lib/share/resolve-here.ts); boot keeps just the capture.
  'src/lib/share/resolve-pending-redirect.ts',
  'src/lib/share/target-rules.ts',
  'src/lib/workspace-service/secure-links-operations.ts',
  // The kept workspace tree: its rules load with its first save or read (hooks/use-kept-tree.ts).
  'src/lib/offline-tree.ts',
  // Encryption at rest: sealing, sweeps and the agent's root load with the first sealed record
  // read or the setting turned on (lib/document-replica-cache.ts).
  'src/lib/at-rest/at-rest-records.ts',
  'src/lib/at-rest/record-crypto.ts',
  'src/lib/at-rest/agent-root-store.ts',
  // Its shapes and errors too: the kept-tree hook reads the lock lazily (hooks/use-kept-tree.ts).
  'src/lib/at-rest/at-rest-shape.ts',
  // A failed call's copy loads with the call stage; the landing page's media lifecycle needs only
  // the takeover reason (lib/call/lost-on-takeover.ts).
  'src/lib/call/call-failure-detail.ts',
  // The kill switch loads only when /version.json pulls it (lib/pwa/watch-deployed-version.ts).
  'src/lib/pwa/kill-switch.ts',
  // Console capture for opt-in diagnostic logs: it runs while a workspace is open (TermsGate),
  // and does nothing until a consent answer allows uploads (lib/telemetry/console-capture).
  'src/lib/telemetry/console-capture/capture.ts',
  // Citadel Apps: the marketplace, its consent screen and the manifest rules load when the Apps
  // modal first opens or a page with an app zone renders (App.tsx's lazy AppsModalHost); boot
  // keeps just the app-link capture and the menu item's open request.
  'src/components/citadel-apps/marketplace/AppsModal.tsx',
  'src/components/citadel-apps/marketplace/ConsentPanel.tsx',
  'src/lib/citadel-apps/manifest/manifest-rules.ts',
  // The required-apps header is read when a document opens (Office), and an app link is judged
  // once the workspace has the apps client (apps-api); boot only keeps the link (app-link-capture).
  'src/lib/citadel-apps/md-header.ts',
  'src/lib/citadel-apps/app-link.ts',
  // The sandbox host: the zone runtime, the instance handle and the worker's host load with the
  // first app zone that has an app to run (components/office/app-zone/lazy-runtime.ts).
  'src/lib/citadel-apps/runtime/page-runtime.ts',
  'src/lib/citadel-apps/host/instance.ts',
  'src/lib/citadel-apps/host/worker-host.ts',
  // Coupons: the plan step's code field, its quote and the re-check load with the create-workspace
  // page (pages/CreateWorkspace), never on the landing page.
  'src/components/create-workspace/CouponField.tsx',
  'src/lib/onboarding/coupon-quote.ts',
  'src/lib/onboarding/coupon-recheck.ts',
  // The chat-document migration: the walker, the runner and the engine's importer load by dynamic
  // import after sign-in (hooks/use-live-doc-migration-sweep.ts), never on the landing page.
  'src/lib/live-doc-migration/boot.ts',
  'src/lib/live-doc-migration/runner.ts',
  'src/lib/live-doc-migration/yjs-walker.ts',
  'src/lib/live-doc-migration/cdoc-mapper.ts',
  // Chat documents kept in step peer to peer: what records a closed one's incoming edits loads
  // with the first CdocChatSync command (lib/p2p/chat-document-inbox.ts, in the messenger's
  // chunk); the message handler only recognises the envelope (types/cdoc-chat-sync.ts).
  'src/lib/cdoc/chat/chat-inbox.ts',
  'src/lib/cdoc/chat/chat-local-db.ts',
  'src/lib/cdoc/chat/chat-wire.ts',
  // A chat document's canvas, its keeper and its sync load when its tab opens
  // (components/p2p/chat-document/use-chat-documents.ts, by dynamic import), never before.
  'src/components/documents/chat-replica.ts',
  'src/lib/cdoc/chat/chat-replica-keeper.ts',
  'src/lib/cdoc/chat/chat-sync.ts',
  'src/lib/cdoc/chat/chat-migration-gate.ts',
  'src/lib/live-doc-migration/held-apart.ts',
];

/**
 * The Citadel Docs binaries (public/cdoc, vendored by scripts/sync-cdoc-wasm.sh), in bytes:
 * the editor artefact, which the worker fetches when a document opens, and the PDF artefact,
 * fetched on the first PDF export. Never on the critical path, but each is precached with its
 * glue, so it is part of every install and must stay under workbox's per-file cap
 * (vite.config.ts, maximumFileSizeToCacheInBytes), above which workbox drops it from the
 * precache SILENTLY.
 *
 * 3,000,000 (2026-10-17): introduced at 2,679,138 bytes (1.0 MB gzipped; wasm-opt -Oz over
 * citadel-docs 84182f3: model, ProseMirror mapping, layout, shaping, display list, DOCX, MD,
 * TXT and PDF).
 * 4,400,000 (2026-10-18): the editor arrived. citadel-docs aff63f9 (cdoc-edit, cdoc-crdt with
 * its codec, the faster DOCX reader) is 4,222,829 bytes (1.5 MB gzipped); measured plus ~4%,
 * with the precache cap raised to 4,500,000 beside it. It comes back down with the per-app
 * wasm split (formats, editing and PDF loaded lazily); raise it on purpose, with the reason here.
 *   Re-measured at citadel-docs 59d18eb (EditorHandle gc and addImage, result v2 with caret
 *   formatting): 4,323,294 bytes, 1.8% under; held, not raised.
 * 4,600,000 (2026-10-18): citadel-docs b5cd990 adds file open and export on the live replica
 * (cdoc-edit-io with the DOCX, ODT, MD, TXT and PDF writers reachable from EditorHandle), the
 * chunked diff, styles and the clipboard text: 4,429,022 bytes; measured plus ~4%, the cap
 * raised to 4,700,000 beside it. Still down with the per-app wasm split.
 * 5,300,000 (2026-10-18): citadel-docs f8656c6 shapes every run (cdoc-shape, Knuth-Plass line
 *   breaking, display list v2): 5,086,603 bytes; measured plus ~4%, the cap raised to 5,400,000
 *   beside it. The editor/pdf split (citadel-docs #39) is what brings it back under 4 MiB.
 * Split (2026-10-18, citadel-docs 791ffeb, #39 and #43 with the patterns out of the binary):
 *   the editor artefact is 3,731,952 bytes, budget 3,900,000 (measured plus ~4.5%), under the
 *   restored 4 MiB cap; the PDF artefact is 2,248,236, budget 2,350,000 (plus ~4.5%).
 */
const CDOC_ARTEFACTS = [
  { name: 'editor', budget: 3_900_000, loaded: 'loaded on document open' },
  { name: 'pdf', budget: 2_350_000, loaded: 'loaded on the first PDF export' },
];

/**
 * This measures dist/ and does not build it, so a dist/ older than the source
 * measures some other commit. That happened on the first merge of the
 * deferred-messenger change: a build from before the merge, checked by the
 * script from after it, reported the pre-fix 322.6 KB and the messenger "on
 * the critical path again" for a tree where neither was true.
 */
const newestSource = (path) => {
  const info = statSync(path);
  if (!info.isDirectory()) return /[\\/]__tests__[\\/]|\.test\.tsx?$/.test(path) ? 0 : info.mtimeMs;
  return Math.max(0, ...readdirSync(path).map((name) => newestSource(join(path, name))));
};
const builtAt = statSync(join(dist, 'index.html')).mtimeMs;
const sourceAt = Math.max(...['src', 'index.html', 'vite.config.ts', 'scripts/lib'].map((p) => newestSource(join(root, p))));
if (sourceAt > builtAt) {
  console.error(
    `dist/ was built ${((sourceAt - builtAt) / 1000).toFixed(0)}s before the newest source change, so it measures\n` +
    'a different tree. Run `npx vite build` first; nothing below would be about this checkout.'
  );
  process.exit(1);
}

const html = readFileSync(join(dist, 'index.html'), 'utf8');

const assets = [
  ...html.matchAll(/<script[^>]+src="([^"]+)"/g),
  ...html.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="([^"]+)"/g),
  ...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g),
].map((m) => m[1]);

if (assets.length === 0) {
  console.error('No critical-path assets found in dist/index.html — has the build output changed shape?');
  process.exit(1);
}

let total = 0;
const rows = assets.map((href) => {
  const bytes = gzipSync(readFileSync(join(dist, href.replace(/^\//, '')))).length;
  total += bytes;
  return { href, kb: bytes / 1024 };
});

rows.sort((a, b) => b.kb - a.kb);
for (const r of rows) {
  console.log(`  ${r.kb.toFixed(1).padStart(7)} KB  ${r.href}`);
}

const totalKb = total / 1024;
console.log(`  ${'-'.repeat(50)}`);
console.log(`  ${totalKb.toFixed(1).padStart(7)} KB  landing critical path (budget ${BUDGET_KB} KB)`);

// Report the lazy chunks too, so their absence above is visibly intentional.
const lazy = readdirSync(join(dist, 'assets'))
  .filter((f) => f.endsWith('.js') && !assets.some((a) => a.endsWith(f)))
  .map((f) => ({ f, kb: gzipSync(readFileSync(join(dist, 'assets', f))).length / 1024 }))
  .sort((a, b) => b.kb - a.kb)
  .slice(0, 3);
if (lazy.length) {
  console.log('\n  Largest chunks kept OFF the critical path:');
  for (const l of lazy) console.log(`  ${l.kb.toFixed(1).padStart(7)} KB  ${l.f}`);
}

const sourcesOf = (file) => {
  const map = join(dist, 'assets', `${file}.map`);
  return existsSync(map) ? JSON.parse(readFileSync(map, 'utf8')).sources : [];
};
const holds = (sources, mod) => sources.some((src) => src.replace(/\\/g, '/').endsWith(mod));
const critical = assets.map((href) => href.split('/').pop()).filter((f) => f.endsWith('.js'));
const everywhere = readdirSync(join(dist, 'assets')).filter((f) => f.endsWith('.js'));
let deferralBroken = false;
for (const mod of DEFERRED_MODULES) {
  const eagerIn = critical.filter((f) => holds(sourcesOf(f), mod));
  if (eagerIn.length > 0) {
    console.error(`\n${mod} is on the landing critical path again (in ${eagerIn.join(', ')}).`);
    deferralBroken = true;
  } else if (!everywhere.some((f) => holds(sourcesOf(f), mod))) {
    console.error(`\n${mod} is in no chunk's source map, so this check examined nothing. Update DEFERRED_MODULES.`);
    deferralBroken = true;
  } else {
    console.log(`\n  off the critical path, as intended: ${mod}`);
  }
}
if (deferralBroken) {
  console.error(
    'Something the landing page imports statically reaches it. Trace the import chain from\n' +
    'src/main.tsx -- a barrel re-export is the usual cause -- and cut it; do not raise BUDGET_KB.'
  );
  process.exit(1);
}

const serviceWorker = readFileSync(join(dist, 'sw.js'), 'utf8');
for (const { name, budget, loaded } of CDOC_ARTEFACTS) {
  const file = `cdoc/cdoc_wasm_${name}_bg.wasm`;
  if (!existsSync(join(dist, file))) {
    console.error(`\n${file} is not in dist/: the Citadel Docs ${name} binary was not served at all.`);
    process.exit(1);
  }
  const bytes = statSync(join(dist, file)).size;
  console.log(`${name === CDOC_ARTEFACTS[0].name ? '\n' : ''}  ${(bytes / 1e6).toFixed(2).padStart(7)} MB  Citadel Docs ${name} binary, precached, ${loaded} (budget ${(budget / 1e6).toFixed(2)} MB)`);
  if (bytes > budget) {
    console.error(`The Citadel Docs ${name} binary is ${bytes} bytes, over its ${budget}-byte budget. Find what grew, or raise the budget on purpose.`);
    process.exit(1);
  }
  if (!serviceWorker.includes(`"${file}"`)) {
    console.error(`The Citadel Docs ${name} binary is not in the service worker precache: its glue would be served without it.`);
    process.exit(1);
  }
}
// The hyphenation patterns are pinned by a manifest in the precached JS: from the network, a
// deploy that changed one would fail every document open from the old generation.
const patternFiles = existsSync(join(dist, 'cdoc', 'patterns')) ? readdirSync(join(dist, 'cdoc', 'patterns')) : [];
if (patternFiles.length === 0) {
  console.error('\ndist/cdoc/patterns holds no hyphenation patterns: the Citadel Docs patterns were not served at all.');
  process.exit(1);
}
const unprecached = patternFiles.filter((file) => !serviceWorker.includes(`"cdoc/patterns/${file}"`));
if (unprecached.length > 0) {
  console.error(`Hyphenation patterns missing from the service worker precache: ${unprecached.join(', ')}. vite.config.ts globPatterns must include tex.`);
  process.exit(1);
}
console.log(`  ${String(patternFiles.length).padStart(7)} hyphenation pattern files, precached with the manifest that pins them`);

if (totalKb > BUDGET_KB) {
  console.error(
    `\nOver budget by ${(totalKb - BUDGET_KB).toFixed(1)} KB.\n` +
    'Something is being downloaded before the landing page can render. Check whether a\n' +
    'newly-imported module pulled a chunk onto the critical path — an eager import in a\n' +
    'shared provider is the usual cause — and lazy-load it, or raise BUDGET_KB on purpose.'
  );
  process.exit(1);
}
