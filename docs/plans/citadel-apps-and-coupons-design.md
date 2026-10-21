# Design: Coupons at checkout, and the Citadel Apps platform

Worktree read: /Users/nologik/avarok/wt/batch-1021 (parent) and /Users/nologik/avarok/wt/batch-1021/citadel-workspaces (UI). No files were modified. Every claim below about current code was verified by reading it; places where the brief's "known facts" were wrong are called out.

Corrections to the brief that change the design:
1. `WorkspaceProtocolRequest::UpdateNode` (citadel-workspace-types/src/lib.rs:334) has NO `metadata` field. Node metadata is written once at `CreateNode` (server_ops/node_metadata.rs, 4 KB cap). Install records therefore cannot live in node metadata; they need a kernel store.
2. control/monitor.mjs:35-41 pushes `entitlements(row)` to every active object every 15 minutes ("drift repair"). Any comp/"infinite" grant that is not a column `entitlements()` reads is silently reverted within 15 minutes. The grant must be in the `tenants` row.
3. There is no per-IP rate limit on any `/api/*` route (grep: only ice.mjs, which is per member in the object). Turnstile on `POST /api/tenants` is the only guess cost today.
4. The cdoc worker already paints into transferred `OffscreenCanvas` slots (citadel-workspaces/src/lib/cdoc/worker/protocol.ts `attachCanvas`/`paintCanvas`). That is the natural app surface; no new display-list format is needed for v1.
5. MDX comments `{/* ... */}` are valid MDX expressions that render nothing with the current `evaluate` setup (no plugin needed); a leading `---` is a thematic break. This decides the hidden-header format.
6. `citadel-support-signature` DOMAIN is `citadel-support-read-v1\0` and its `SupportAction` is read-only by name; `citadel-release-signature` (citadel-internal-service/citadel-release-signature) already binds tag+asset+sha256 under ML-DSA-65. Both are the templates for the two new signed formats below.

---

# PART 1: COUPONS AT CHECKOUT

## 1.1 Where coupons are verified (the SSOT location)

The control-plane Worker (deploy/tenant-worker/control/*, D1 `CONTROL_DB`, already bound, free tier) is the only place a code is ever judged. The UI never computes a discount from a local table; it renders what the Worker answered. Pure rules in one module with no I/O; D1 access in a store class; routes in a thin module, exactly as `tenants.mjs` / `store.mjs` / `support.mjs` divide today.

## 1.2 One SSOT with static and dynamic coupons, without duplication

Split by what changes at deploy time versus at run time:

- `billing/tiers.json` (the pricing SSOT, public repo) gains a `coupons` block that defines **every shape** a coupon may take, every cap, and the public static codes. Nothing that must stay secret goes here.
- D1 `coupons` table holds **dynamic codes**, each of which is an instance of a shape (`template`) tiers.json defines. A dynamic row can never express a discount or grant that tiers.json does not describe, so Stripe never needs a new object for a dynamic code (the hard rule: Stripe changes only via `scripts/stripe-catalogue.mjs --apply` at deploy).
- One pure normaliser, `control/coupon-rules.mjs`, turns both a static entry and a dynamic row into the same `Coupon` shape; one `redeemable(coupon, plan, now, usage)` decides. Static and dynamic are never two code paths past that point.
- Collision guard: a dynamic code whose hash equals a static code's is refused at issue (negative control in tests), and `billing/coupons-catalogue.test.mjs` refuses duplicate static codes.

Proposed `tiers.json` addition (every field required, PCND):

```json
"coupons": {
  "$comment": "Every discount shape Stripe holds (templates), the trial caps, the comp grant shapes, and the public codes. Comp codes themselves are NEVER here (this file is public); they are issued into D1 by the signed admin tool. A dynamic code is an instance of a template or a grant shape, so the Worker never asks Stripe for a new object.",
  "code_shape": "^[A-Z0-9][A-Z0-9-]{3,31}$",
  "trial_caps": { "max_days": 30, "members": 5, "storage_gb": 1, "connections": 15, "relay_gb": 2, "secure_links_per_member": 5 },
  "templates": [
    { "id": "pct-10-once",   "discount": { "kind": "percent", "percent_off": 10 },      "duration": "once" },
    { "id": "pct-20-3mo",    "discount": { "kind": "percent", "percent_off": 20 },      "duration": "repeating", "months": 3, "intervals": ["month"] },
    { "id": "usd-10-once",   "discount": { "kind": "amount",  "amount_off": 1000 },     "duration": "once" },
    { "id": "trial-14",      "trial_days": 14 }
  ],
  "grants": [
    { "id": "design-partner", "tier_as": "business", "seats": 25,  "storage_gb": 500,  "unmetered_relay": true },
    { "id": "owner-internal", "tier_as": "business", "seats": 100, "storage_gb": 1000, "unmetered_relay": true }
  ],
  "static": [
    { "code": "LAUNCH10", "template": "pct-10-once", "available_on": ["team","business"], "max_redemptions": 500, "redeem_by": "2026-12-31T23:59:59Z" }
  ]
}
```

Rules enforced when the catalogue loads (throw at module load, like `addons.mjs`): `percent_off` in 1..100, `amount_off` positive cents <= a `flat_max_cents` field (recommend 10000), `trial_days` in 1..`trial_caps.max_days`, `repeating` only with `intervals: ["month"]` (Stripe applies `duration_in_months` to a yearly subscription's first invoice only, which would silently mean "once"), `tier_as` a real paid tier, a grant's numbers <= the business tier's own ceilings (there is no literal "infinite": the hard ceiling is the tier table), `available_on` names real paid tiers only (the free tier takes no coupon).

"Infinite usage" for design partners and the owner therefore means: the `tier_as` tier's limits at the grant's seat count, with relay overage neither billed nor cut (`unmetered_relay`), under the same `max_frame_bytes` and connection ceilings every tenant has. If the owner truly wants numbers beyond the business ceiling, that is a tiers.json edit, reviewed like any price. (Question Q1.)

## 1.3 Mapping to Stripe

| Coupon shape | Stripe object | How applied at Checkout |
|---|---|---|
| percent / amount discount template | one Stripe `Coupon` per template, id content-addressed: `citadel-coupon-<template.id>-<first 8 hex of sha256(JSON of the template)>`, `metadata[citadel_coupon]=<template.id>`, `applies_to[products][]` = the tier products the static code allows (Stripe-side backstop), `max_redemptions` NOT set at Stripe (D1 is the counter; Stripe's counter would be shared with nothing else but cannot be reset or read atomically) | `discounts[0][coupon]=<id>` on the Checkout Session |
| trial template | none | `subscription_data[trial_period_days]=<days>`; `payment_method_collection` left at its default `always` so a trial needs a card (Q3) |
| comp grant | none | no Checkout at all: the tenant is activated like a free tenant (`activateFree`) but with `tier`, `seats`, `grant_id`, `coupon_hash` set; `stripe_customer`/`stripe_subscription` stay NULL, so the portal answers its existing `no-subscription` and the webhook's ENDED path can never downgrade it |

Never `allow_promotion_codes`: that would make Stripe the verifier, codes would be shared-account-wide (the Stripe account is shared with another product), and the SSOT would leave the repo.

`scripts/stripe-catalogue.mjs` is 147 lines; coupon sync goes in `scripts/lib/stripe-coupons.mjs` (pure diff from `billing/coupons-catalogue.mjs` `deriveCoupons(table)` + `couponDiffs(want, have)`), called from the script. A template whose content hash changed gets a new coupon id; the old one is deleted only if `metadata[citadel_coupon]` names a template this file no longer derives (deleting a Stripe coupon leaves existing subscriptions' discounts intact). The script never touches a coupon without `metadata[citadel_coupon]` (shared account). The Worker computes the same id with the same pure function, so no lookup call is needed at checkout; a missing coupon (deploy not applied) surfaces as the existing StripeError -> `provisioning-failed` 502 with the reservation released.

Stripe Tax: discounts are applied before tax by Stripe; nothing to do. Refunds: comp tenants have no invoices; discounted ones refund through the dashboard as today; `max_redemptions` is not decremented on refund (document it; Q8).

## 1.4 Request flow and atomicity

`POST /api/tenants` gains one optional field `coupon_code` in `CREATE_FIELDS` (string matching `code_shape` after `normaliseCode` = trim + uppercase). Order inside `createTenant`:
1. `readCreate` (shape only; free tier + coupon_code -> 400 "the free tier takes no coupon_code", the same uniform wording as PAID_ONLY).
2. Turnstile verified (unchanged; every guess through creation costs a Turnstile solve).
3. `io.coupons.find(codeHash)` -> static map (`digestsEqual` over hashes) else D1 row. `redeemable(...)` returns one of: `ok(coupon)` or a refusal. **All refusals (unknown, expired, exhausted, revoked, wrong tier/interval, already used by this slug) answer the same 400 `coupon-unavailable` "that code cannot be applied to this plan"** so the route is no oracle.
4. Reserve the slug AND the redemption in ONE D1 batch (extend `Store.#insertAfter` with a third statement: `INSERT INTO coupon_redemptions (coupon_hash, tenant_id, slug, state='pending', reserved_at)`, preceded by `DELETE FROM coupon_redemptions WHERE tenant_id IN (SELECT tenant_id FROM tenants WHERE status='pending' AND expires_at <= ?)` and a guard `SELECT COUNT(*) ... WHERE coupon_hash=? AND state IN ('pending','redeemed')` compared in JS against `max_redemptions` before the batch; the PRIMARY KEY `(coupon_hash, tenant_id)` plus a per-slug uniqueness index make a double reserve roll the batch back, so the race loses safely (same pattern as `reserve`).
5. Comp grant: `activateFree`-style activation with grant columns; return 201 `{status:'active', claim_code}`; redemption `state='redeemed'` in the same batch.
6. Discount/trial: `openCheckout` adds `discounts[0][coupon]` or `trial_period_days`; redemption stays `pending` until `checkout.session.completed` (webhook `applyEvent` batch adds `UPDATE coupon_redemptions SET state='redeemed'`), and is deleted by `supersede`/`release`/expiry cleanup. Idempotency key stays `checkout-<tenant_id>`.

Entitlements (`plans.mjs`, pure): `entitlements(plan, now)` gains three inputs read from the row (`grant_id`, `trial_end`, `stripe_status`), each required (null when none). Grant: limits come from the grant shape at `tier_as`/`seats`, plus `relay_unmetered: true` in the entitlements object (the object stops cutting relay; the monitor skips the report when `relay_unmetered`). Trial clamp: while `trial_end !== null && stripe_status !== 'active'` (trialing, or past_due at trial end with no successful payment yet), every limit is `min(plan limit, trial_caps)`; this is what makes a trial unable to run up a backend bill. `enforcedEntitlements` and the monitor pass `io.now()`.

Webhook (`webhook.mjs`): `subscriptionChanged` records `stripe_status: sub.status` and `trial_end: sub.trial_end ?? null` (add to `EVENT_FIELDS`), and `checkoutCompleted` confirms the redemption. Everything else unchanged; `trialing` is already in LIVE.

## 1.5 Preview endpoint and abuse limits

`POST /api/coupons/preview` body `{code, tier, interval, seats, storage_blocks, link_packs}` (same validators as readCreate, reused), answers `{applies: true, kind: 'discount'|'trial'|'comp', ...the quote inputs}` or the uniform 400. It is the guessing surface, so:
- Same-origin only (`readJson` already checks Origin).
- Per-IP cap in D1 without KV: `coupon_attempts (ip_hash, hour, count)`; one batch increments and reads; over `MAX_PREVIEWS_PER_HOUR` (recommend 20) -> 429 `coupon-rate-limited`, checked BEFORE any lookup. Rows for past hours deleted in the same batch (the support_nonces pattern). IP hash = sha256(ip + daily salt derived from a Worker secret? there is none for this; use sha256 of ip alone, retained one hour, and document it in the privacy notice, Q9).
- Codes compared by hash only; both static and dynamic lookups run the same number of D1 statements whether or not the code exists (one SELECT by hash; the static map is checked after, in constant structure), so timing does not distinguish.
- Creation re-validates independently: if the preview and the create disagree (code revoked between), create answers the uniform 400 and the UI clears the code and re-previews.

## 1.6 Admin add/revoke (dynamic coupons)

Signed requests, the `support.mjs` pattern, but under a distinct signing domain so a support-read key can never issue a coupon:
- `citadel-support-signature` crate: add `pub const ADMIN_DOMAIN: &[u8] = b"citadel-control-admin-v1\0"`, `AdminAction::{IssueCoupon{code, template|grant, available_on, intervals, max_redemptions, redeem_by_ms, note}, RevokeCoupon{code, also_revoke_grants: bool}, ListCoupons, ListRedemptions{code}}`, `AdminRequest{audience, nonce, expires_at_ms, action}`, `verify_admin(...)`. Keep the file under 250 lines by moving the shared verify core into `src/verify.rs` (the two formats differ only in domain and payload type).
- server-wasm: `verify_admin_request` beside `verify_support_request`; `control/support-verifier.mjs` exports both.
- Worker: `control/coupon-admin.mjs` routes `POST /api/admin/coupons/{issue,revoke,list,redemptions}`; same order as support: verify -> claim nonce in `support_nonces` -> act. Config: `CITADEL_ADMIN_MLDSA_PUBLIC_KEY` secret (503 when unset; deploy.sh may stay permissive about it; Q2 asks whether the same key as support may be used; recommended default: a separate key).
- Tool: `tools/coupon-admin` (copy the `tools/telemetry-read` shape: keygen, sign+send).
- `RevokeCoupon{also_revoke_grants:true}` also clears `grant_id` on tenants redeemed with it, pushes new entitlements to each object immediately (`setEntitlements`) and the monitor reconciles any miss. With `false`, existing design partners keep their grant and only new redemptions stop. PCND: the field is required.
- Audit: `coupon_events (id, at, action, coupon_hash, tenant_id?, nonce, detail)` written in the same batch as every issue/revoke/reserve/redeem/release; `ListRedemptions` reads it. No separate audit store exists today; this table is the one for billing.

## 1.7 D1 migration `0009_coupons.sql`

```
CREATE TABLE coupons (code_hash TEXT PK, template TEXT NULL, grant_id TEXT NULL, available_on TEXT NOT NULL, intervals TEXT NOT NULL, max_redemptions INTEGER NOT NULL, redeem_by INTEGER NULL, revoked_at INTEGER NULL, issued_at INTEGER NOT NULL, issued_nonce TEXT NOT NULL, note TEXT NOT NULL, CHECK ((template IS NULL) <> (grant_id IS NULL)));
CREATE TABLE coupon_redemptions (coupon_hash TEXT, tenant_id TEXT, slug TEXT NOT NULL, state TEXT NOT NULL CHECK (state IN ('pending','redeemed')), reserved_at INTEGER NOT NULL, PRIMARY KEY (coupon_hash, tenant_id));
CREATE UNIQUE INDEX coupon_redemptions_slug ON coupon_redemptions (coupon_hash, slug);
CREATE TABLE coupon_attempts (ip_hash TEXT, hour INTEGER, count INTEGER NOT NULL, PRIMARY KEY (ip_hash, hour));
CREATE TABLE coupon_events (...);
ALTER TABLE tenants ADD COLUMN coupon_hash TEXT NULL; ADD COLUMN grant_id TEXT NULL; ADD COLUMN trial_end INTEGER NULL; ADD COLUMN stripe_status TEXT NULL;
```
`store.mjs` COLUMNS/INSERT_COLUMNS/EVENT_FIELDS gain the four columns (store.mjs is 156 lines; the coupon statements go in `control/coupon-store.mjs`, not here).

## 1.8 UI

- `src/lib/onboarding/control-plane-client.ts`: `CreateTenantRequest.coupon_code?: string`; new `previewCoupon(request): Promise<CouponPreview>` with a typed `CouponPreview` union `{kind:'discount', percentOff|amountOffCents, duration, months} | {kind:'trial', days} | {kind:'comp', tierAs, seats}` and a `CouponRefusal` ('unavailable' | 'rate-limited').
- `src/lib/onboarding/coupon-quote.ts` (new, pure): `applyCoupon(quote: Quote, preview: CouponPreview | null): PricedQuote` -> `{...quote, discountCents, dueTodayCents, trialDays, recurringAfterTrialCents}`. `tiers.ts` `quote()` stays untouched so `tiers-match-the-catalogue.test.ts` keeps its meaning; `code_shape` is mirrored as `COUPON_CODE_SHAPE` in `coupon-code.ts` with a drift test against tiers.json (same pattern as the tiers test).
- `create-flow.ts` `FlowDraft.coupon?: { code: string; preview: CouponPreview }` (sessionStorage; `isDraft` validates it).
- `PlanStep.tsx` is 206 lines: add `src/components/create-workspace/CouponField.tsx` ("Have a code?" disclosure, input with uppercase normalisation, Apply button, states: idle / checking / applied (shows the preview line) / unavailable ("This code can't be applied to this plan.") / rate-limited ("Too many attempts. Try again in an hour.") / offline). `ReviewStep.tsx` shows "Code LAUNCH10: 10% off the first payment" and the due-today line. `CreateWorkspace.tsx` `requestFor` adds `coupon_code` when the draft holds one.
- Comp preview on a paid tier renders "$0 — covered by your code" and the create path goes straight to the claim screen (`kind:'created'`), which the flow already handles.

## 1.9 Tests and negative controls (TDD order)

Parent `billing/coupons-catalogue.test.mjs`: derive ids are stable; every malformed template throws (negative control: a valid one does not); `repeating` with `year` throws.
Worker `test/coupons.test.mjs` (real Worker via `cloudflare:test`, the create.test.mjs style): unknown/expired/exhausted/revoked/wrong-tier/free-tier all answer the identical 400 body (assert deep-equal across cases) and write no redemption row; control: a valid code reserves exactly one row; two concurrent creates on a `max_redemptions: 1` code -> one 201, one 400, one row; cancelled Checkout then retry releases and re-reserves; webhook `checkout.session.completed` marks redeemed; comp grant creates an active tenant with no Stripe call (assert `outbound` calls empty) and the object's stats show `relay_unmetered`; trial Checkout carries `trial_period_days` and the object's entitlements are clamped to `trial_caps` while `stripe_status='trialing'` and unclamped after `active` (control); monitor does not revert a grant (`sameEntitlements` includes the grant); preview rate limit: 21st call 429, 20th 200 (control); timing structure test: static-miss and dynamic-miss run the same statement count.
`test/coupon-admin.test.mjs`: unsigned/other-domain/support-key-signed issue -> 401 and no row (negative control against domain confusion); replayed nonce 409; issue of a code colliding with a static code refused; revoke with `also_revoke_grants` pushes entitlements.
UI vitest: `applyCoupon` arithmetic incl. amount_off > total clamps to 0; CouponField state machine; draft round-trip; drift test for `COUPON_CODE_SHAPE`.
Rust: `citadel-support-signature` tests that a support signature does not verify as admin and vice versa (the two-domain negative control already exists for release vs support; copy it).

Files <= 250 lines: `tenants.mjs` (238) must shed `openCheckout`/`expireCheckout` into `control/checkout.mjs` before the coupon lines are added.

---

# PART 2: CITADEL APPS

## 2.1 Artifact format

An app is two files published together, `manifest.json` and `app.wasm`, plus a detached signature.

Manifest (JSON, every field required unless marked optional; the exact published bytes are what is signed, stored and shown):
```
{
  "format": 1,
  "id": "com.acme.kanban",                 // reverse-DNS, ^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$, <= 64 chars
  "version": "1.4.0",                      // semver, strictly increasing per id
  "sdk": { "abi": "citadel-app-abi-1", "min": "1.0.0", "max": "1.x" },
  "publisher": { "name": "Acme", "mldsa65_public_key": "<3904 hex>", "contact": "https://..." },
  "name": "Kanban", "summary": "<= 140 chars plain text", "description": "plain text, \n only",
  "icon": { "png_base64": "...", "max_bytes": 65536 },   // validated PNG magic, decoded size cap
  "categories": ["planning"],              // from a closed list in the catalogue schema
  "audience": { "kind": "global" } | { "kind": "workspace" } | { "kind": "node_viewers", "node_id": ".." } | { "kind": "node_tree_viewers", "node_id": ".." } | { "kind": "members", "usernames": [..] } | { "kind": "roles", "role_ids": [..] },
  "surfaces": ["canvas_pane", "md_zone"],
  "scopes": ["workspace", "node", "node_tree", "users", "self"],   // which install scopes the app supports
  "capabilities": [ { "cap": "nodes.read", "why": "Lists cards from child nodes" }, { "cap": "storage.user", "why": "Remembers your column widths" }, { "cap": "network", "hosts": ["api.acme.com"], "why": "Syncs with Acme" } ],
  "limits": { "memory_pages": 1024, "max_call_rate_per_s": 200, "frame_budget_ms": 16, "storage_user_bytes": 1048576, "storage_shared_bytes": 8388608 },
  "artifact": { "sha256": "<64 hex>", "bytes": 1234567, "locations": [ { "kind": "https", "url": "https://github.com/acme/kanban/releases/download/v1.4.0/app.wasm" }, { "kind": "github_pinned", "repo": "acme/kanban", "commit": "<40 hex>", "path": "dist/app.wasm" } ] },
  "previous_versions": ["1.3.2"]           // optional, informational
}
```
Detached signature `app.mldsa.sig`: ML-DSA-65 over `b"citadel-app-v1\0" || id || b"\0" || version || b"\0" || sha256(manifest bytes) || sha256(wasm)`; new crate `citadel-app-signature` (copy of `citadel-release-signature`'s shape: DOMAIN, `signed_message`, `sign`, `verify`, hex seed/public key, `Refusal` enum), compiled into server-wasm, the browser wasm client and the native agent, so verification is Rust everywhere and never JS.

Location is a hint; identity is the hash. The loader is origin-agnostic and integrity-pinned: whichever location served the bytes, they are accepted only if sha256 matches and the signature verifies under the key pinned in the install record.

Core module, not the component model: wasm32-unknown-unknown, no WASI, the module may import only from one namespace, `citadel_app_abi_1`, and must import its memory from it (`memory`), so the host constructs `WebAssembly.Memory({initial, maximum: manifest.limits.memory_pages})` and the cap is real. Exports required: `app_alloc(len)->ptr`, `app_free(ptr,len)`, `app_init(ptr,len)->i32` (receives the CBOR `AppContext`), `app_event(ptr,len)` (one CBOR `AppEvent`), `app_frame(dt_ms)` (optional). Imports: one function per capability group, all with signature `(op:i32, ptr:i32, len:i32) -> i32` returning a reply handle the app reads with `reply_read(handle, ptr, cap) -> len`: groups `canvas`, `ui`, `events`, `navigate`, `nodes`, `md`, `files`, `chat`, `members`, `storage`, `net`, `clipboard`, `notify`, `documents`, `log`. **An ungranted group is still present as an import but every call answers `ERR_UNGRANTED` (CBOR `{refused:"ungranted"}`)**, so the module instantiates and the app can degrade; and at load the host reads `WebAssembly.Module.imports(module)` and refuses a module importing a group its manifest does not declare (test fixture: a module importing `net` with no `network` capability is refused; control: the same module with the capability loads). CBOR both ways (the repo's wire standard; `cbor-x` in the host, `ciborium` in the guest).

Why this over a component/WIT: the repo already generates TS from Rust with ts-rs and gates parity with scripts; one Rust crate of message types (`citadel-app-sdk-types`, `#[derive(TS)]`) is the single interface definition, exported to `citadel-workspaces/src/lib/citadel-apps/sdk/generated/` and parity-checked by `scripts/check-committed-bindings-match-the-rust.mjs`; no `jco`/`wasm-tools` toolchain, no generated JS glue to review (glue is executable code from a third party, which is exactly what must never run).

Load / verify / cache / update / roll back / uninstall:
- Install: the installer picks the app; the **workspace server** fetches `artifact.locations` in order (new kernel host capability `ArtifactFetcher`, `Option<Arc<dyn>>`, https only, 8 MiB cap, 15 s, no redirects off-host; DO impl = `fetch`, native = reqwest; a kernel built without one refuses URL installs with a typed `ServerFeatureRefusal`-style reason) OR receives an upload from the installer over the protocol in 1 MiB chunks (for a self-hosted single-scope app). Either way the kernel verifies sha256 + signature in Rust, then stores the blob content-addressed (`apps/artifacts/<sha256>`) in its backend; the blob counts against `storage_gb`.
- Client load: `AppsRequest::FetchArtifact{sha256}` -> chunks over the existing socket (under `max_frame_bytes`); the browser re-hashes and re-verifies the signature in the wasm client against the pinned key from the install record before instantiating; caches by sha256 in IndexedDB (structured clone of the bytes) with the verified flag recomputed on every load (hash is cheap; the signature check too).
- Update: manual "Check for updates" (no polling, no always-on cost): the server re-fetches `manifest.json` from the install's listing source, requires `version >` installed, same publisher key, signature valid; if `capabilities` grew or the key changed the install enters `NeedsConsent` and keeps running the installed version. Rollback: `AppsRequest::Rollback{install_id}` by `AppManage` to `previous` (kept until the next update replaces it).
- Uninstall: `{install_id, purge_storage: bool}` (required). Artifact blob is dropped when no install references its hash.

## 2.2 The app-sdk

- `citadel-app-sdk-types` (Rust, no_std-friendly, ts-rs): `HostCall` (enum per group with ops), `HostReply`, `AppEvent` (`Init`, `Resize`, `Pointer`, `Key`, `Wheel`, `Focus`, `Visibility`, `NodeChanged`, `StorageChanged`, `UiAction{id}`, `DeepLink{query}`, `Frame`), `AppContext` (install id, scope, granted caps, surface, size, dpr, theme tokens, locale, acting username, node id of the pane/zone), `Capability` (closed enum), `Refusal`.
- `citadel-app-sdk` (Rust guest crate): `#[citadel_app]` entry macro or plain trait `App { fn init(ctx) ; fn event(e) ; fn frame(dt) }`, safe wrappers `canvas::fill_rect`, `nodes::read(id)` returning `Result<_, Refused>`; implements the exports and the alloc protocol; builds for wasm32-unknown-unknown only (`compile_error!` on any other target except test).
- TS host: `src/lib/citadel-apps/host/` — `imports.ts` builds the import object from `granted: Set<Capability>` (pure: input a grant set, output an object whose ungranted entries are the refusing stub); `dispatch.ts` decodes CBOR and forwards to port interfaces (`NodesPort`, `StoragePort`, ...) that the React layer injects (SBIO: the dispatcher is pure over ports; tests pass fakes); `app-host.worker.ts` instantiates inside a dedicated Worker; `instance.ts` main-thread handle (post, terminate, watchdog).
- Server re-check: every server-backed call travels as `AppsRequest::Call{install_id, call: HostCall}`; the kernel validates (install active, capability granted on the install, scope covers the target, the acting user holds the underlying human permission on the target, the installer still holds the matching `AppInstallAllow*`), then executes through the existing ops (`async_node_ops`, documents relay, files, messaging). The host's gating is a courtesy; the kernel's is the control.

Surface list and permission mapping (capability -> installer must hold / acting user must hold):

| Capability | Installer must hold | Acting user must hold at call | Third-party |
|---|---|---|---|
| canvas, ui, events, navigate (internal links only, through `classifyDocumentLink`), log | AppInstall (intrinsic) | ViewContent on the host node | yes |
| nodes.read (tree, names, metadata, mdx of nodes in scope) | AppInstallAllowNodeRead | ViewContent on each node | yes |
| nodes.write (create/rename/move within scope) | AppInstallAllowNodeWrite | CreateNode / EditTreeStructure | yes |
| md.edit (replace a zone's own region or append; never the header) | AppInstallAllowMdEdit | EditMdx | yes |
| files.read / files.write (server storage under scope) | AppInstallAllowFiles | DownloadFiles / UploadFiles | yes |
| chat.read / chat.send (the node's channel only) | AppInstallAllowChat | ReadMessages / SendMessages | yes |
| members.list / presence | AppInstallAllowMembers | ViewMembers | yes |
| storage.user / storage.shared | AppInstallAllowStorage | ViewContent (user) / EditContent (shared) | yes |
| network (explicit hosts, via server egress) | AppInstallAllowNetwork | none extra | hosts explicit only, <= 8, no wildcards |
| clipboard.read / clipboard.write (host-mediated, user gesture required) | AppInstallAllowClipboard | none | yes |
| notifications (host toast only) | AppInstallAllowNotifications | none | yes |
| documents (CRDT relay, Docs) | first-party key only | EditMdx | no (until the relay is generalised) |
| roles, secure links, telemetry, workspace config, sign-in, keys, support | not a capability | – | never: not in the SDK |

## 2.3 Isolation and runtime

- One dedicated module Worker per app instance (`new Worker(new URL('./app-host.worker.ts', import.meta.url), {type:'module'})`, same-origin, allowed by `worker-src 'self'`; `'wasm-unsafe-eval'` is already in script-src; **no CSP change**). The worker script first deletes `fetch`, `XMLHttpRequest`, `WebSocket`, `importScripts`, `indexedDB`, `caches`, `BroadcastChannel` from `self` (belt and braces; a core wasm module can reach nothing but its import object, which is the actual guarantee of no ambient authority).
- Canvas pane: the host creates a `<canvas>` in `DocumentHost`'s editor region, transfers `OffscreenCanvas` to the worker (the cdoc pattern), forwards pointer/keyboard events as `AppEvent`s with coordinates only. The app never touches DOM.
- md zone: `<AppZone app="..." zone="..." height={n} />` registered in `mdxComponents.tsx`; the component mounts a host-owned canvas of fixed height (apps request resize via `ui.request_height`, clamped to 2000 px) and the same worker protocol. Never page DOM, never HTML from the app.
- UI primitives: host-rendered from data: `ui.set_toolbar([{id,label,icon_name}])`, `ui.open_menu`, `ui.dialog({title, body_text, actions})`, `ui.toast` — React renders them with the app's name badge so chrome is never spoofable; strings are text nodes only.
- Resource caps (host policy constants in `src/lib/citadel-apps/host/limits.ts`, PCND): memory max 64 MiB default, 256 MiB ceiling regardless of manifest; watchdog: a host call or frame not returning in 2000 ms terminates the worker and shows "Kanban stopped responding" with Restart; token buckets per instance: 200 host calls/s, 20 server calls/s (the kernel's per-CID limiter applies on top); max 8 live instances per page (zones beyond that show "Click to activate"); storage quotas from the manifest capped by host policy (1 MiB user, 8 MiB shared per app+scope, both inside `storage_gb`); egress 1 MiB response, 10 s, 60/min per install, bytes counted into the tenant's `bytes_in` meter so network use is billed like relay.
- Accessibility: `ui.set_a11y_tree` optional in v1 (Q12).

## 2.4 Permission model

Representation: **flat enum, naming convention `App*`, one new TS category "Apps"**. A nested `Permission::App(_)` would break `ALL_VARIANTS` (array of unit variants), the ts-rs enum export, `has_permission` matches and the parity script's `^\s*(\w+),` regex at once; the convention costs 14 lines and nothing else. New variants (append; `ALL_VARIANTS` becomes `[Permission; 45]`; `exhaustiveness_guard` forces it):

| Variant | Meaning | Who may grant | Risk |
|---|---|---|---|
| AppInstall | install for yourself ("Just for me") | ManageRoles | low |
| AppInstallScoped | install at workspace / node / node-tree / users scope (also needs UpdateNodeSettings on the scope node, ancestor grants count; workspace scope = root) | ManageRoles | high |
| AppPublish | register an app in this workspace's private registry (audience ≠ global) | ManageRoles | high |
| AppManage | uninstall/suspend any install, roll back, read the apps audit log, write the md required-apps header | ManageRoles | high |
| AppInstallAllowNodeRead | may grant `nodes.read` | ManageRoles | medium |
| AppInstallAllowNodeWrite | may grant `nodes.write` | ManageRoles | high |
| AppInstallAllowMdEdit | may grant `md.edit` | ManageRoles | high |
| AppInstallAllowFiles | may grant files.* | ManageRoles | high |
| AppInstallAllowChat | may grant chat.* | ManageRoles | medium |
| AppInstallAllowMembers | may grant members/presence | ManageRoles | medium |
| AppInstallAllowStorage | may grant storage.* | ManageRoles | low |
| AppInstallAllowNetwork | may grant network | ManageRoles; never held by Member seed | critical |
| AppInstallAllowClipboard | may grant clipboard | ManageRoles | medium |
| AppInstallAllowNotifications | may grant notifications | ManageRoles | low |

Owner holds all (derived). Admin has `All`. Role migration: `ROLE_TABLE_VERSION = 2`; `upgrade()` gives `AppInstall` to every non-Owner, non-Guest role that grants `ViewContent` (the v1 pattern for ShareSecureLinks); nothing else is added by migration. Seed Member gains `AppInstall`. TS mirror: `types.ts` enum + `PERMISSION_LABELS` (plain words: "Install apps for yourself", "Let an app read pages", ...) + `PERMISSION_CATEGORIES.Apps`. Parity script: each variant is matched literally in `kernel/command_processor/apps.rs` and `kernel/apps/rules.rs`, so no `GATED_BY` entries; add a test that the Apps category has every `App*` variant.

Install-time consent screen (one scrollable panel, not a wizard): app name/version/publisher name + key fingerprint (first 16 hex of sha256(public key), grouped by 4) + "first time you trust this key" or "same key as 3 apps you already use"; the scope sentence with the people count ("Everyone in Engineering and the 12 pages below it: 42 people"); each requested capability as a row: plain-language label, the publisher's `why`, risk tier colour, and a toggle for capabilities the manifest marks optional; a "This app can never:" list (manage roles, read other workspaces, change who sees what, reach the network [when not granted]); the artifact hash; the Install button enabled only after the panel has been visible 600 ms and the pointer moved (clickjacking is already blocked by `frame-ancestors 'none'`; this is for overlay attacks within the page).

## 2.5 Scopes and the Apps store

Kernel module `kernel/apps/` (mirrors `secure_links/`: `mod.rs`, `records.rs`, `rules.rs` pure, `audience.rs` pure, `md_header.rs` pure, `egress.rs`, `fetcher.rs` capability trait, `test_support.rs`), store `kernel/transaction/apps_store.rs` under a static `APPS_LOCK`, handler `kernel/command_processor/apps.rs`, types `citadel-workspace-types/src/apps.rs` (ts-rs), dispatched as `WorkspaceProtocolRequest::Apps(AppsRequest)` beside SecureLinks at async_process_command.rs:1303.

```rust
pub struct AppInstall {
  pub id: String, pub app_id: String, pub version: String,
  pub manifest_sha256: String, pub artifact_sha256: String,
  pub pinned_publisher_key: String,            // 3904 hex, the key the installer accepted
  pub scope: InstallScope,                     // Workspace | Node(id) | NodeTree(id) | Users(Vec<String>) | SelfOnly(username)
  pub granted: BTreeSet<Capability>,
  pub network_hosts: Vec<String>,
  pub installed_by: String, pub installed_at_ms: u64,
  pub state: InstallState,                     // Active | NeedsConsent{version, reason} | Suspended{reason} 
  pub previous: Option<(String, String)>,      // (version, artifact_sha256) for rollback
  pub injected_header_into: Vec<String>,       // node ids whose md header this install wrote
  pub source: ListingSource,                   // Global{catalogue_version} | WorkspaceRegistry{entry_id} | Upload
}
```
Keys: `apps/install/<id>`, index `apps/scope/<scope key>` -> ids, `apps/user/<username>` -> ids (self installs), `apps/registry/<entry id>` (workspace listings), `apps/artifact/<sha256>`, `apps/storage/<app_id>/<scope key>/<username|_shared>`, `apps/audit` capped vector (the telemetry access-log pattern, 2000 entries).

How scopes combine and attenuate:
- Effective capability set for a call = `install.granted ∩ caps the installer may still grant (AppInstallAllow*) ∩ caps implied by the acting user's own permissions on the target ∩ scope reach`. Any factor empty -> refused; the refusal is logged to `apps/audit` as a counter per (install, cap, day), never per call.
- `SelfOnly` ("Just For Me"): visible and runnable only by the installing user; storage is `storage.user` only (no `_shared`); zones in shared pages render for that user and the placeholder for everyone else. `Users(list)`: the installer must hold `AppInstallScoped` and each listed user must be in the app's audience. `Node` covers that node only; `NodeTree` covers the node and every descendant by `parent_id` walk (the existing `check_entity_permission` walk, so an install at the root is the same as `Workspace`). Overlapping installs: the most specific scope wins for configuration; a user matches an install if any covering install admits them.
- Who may install where: the installer's own authority must cover everything the app asks (each requested capability needs its `AppInstallAllow*`; the scope needs `AppInstallScoped` + `UpdateNodeSettings` on the scope node; `Workspace` scope needs those at the root). Owner/Admin satisfy all. A user may always refuse an app installed for them (per-user `disabled` flag in `apps/user/<username>`), which hides it but does not uninstall.
- Uninstall: installer or `AppManage`; `purge_storage` required. Update with grown capabilities: `NeedsConsent` until someone with authority re-consents; every member sees "Kanban 1.5 needs a new permission; waiting for an admin". Key change: same, with reason `PublisherKeyChanged`, and the consent screen shows both fingerprints.
- Audit: `AppsRequest::ListAudit` (AppManage): install, consent, update, rollback, suspend, uninstall, header injection/removal, refused-call counters.

## 2.6 The md SSOT: hidden required-apps header

Format: the first line of `mdx_content`, an MDX expression comment with a fixed grammar, inert to the current renderer (no plugin, `---` would be a thematic break and remark-frontmatter would change how every existing document starting with `---` renders):

```
{/* @citadel-apps 1 {"require":[{"app":"com.acme.kanban","min":"1.2.0","surface":"none"},{"app":"com.acme.lint","min":"0.9.0","surface":"none"}]} */}
```
- Parsed by a pure Rust module `types/src/apps_md_header.rs` (serde, strict: exactly one header, first line, JSON object, no `*/` inside strings, app ids by regex) with a ts-rs twin used by the UI through the wasm client, plus a tiny TS `md-header.ts` that only does `split(content) -> {header: string | null, body}` / `join(header, body)` and is drift-tested against Rust fixtures (`md-header-fixtures.json`, shared).
- Who may write it: only the kernel, on `AppsRequest::Install{..., inject_requirement: true}` at `Node`/`NodeTree` scope by a user holding `AppManage` AND `EditMdx` on that node. On `UpdateNode{mdx_content}` the kernel compares the incoming header with the stored one: a caller without `AppManage` must send it byte-identical (negative control: EditMdx-only user adding/removing a requirement -> refused with "the apps header is managed by workspace admins"; control: the same user changing the body with the header intact -> accepted). Hash is computed where stored, so integrity is unchanged.
- Editor: `BaseOffice.tsx` strips the header from the editing buffer and re-joins it on save, so people never see or delete it; the hash shown/verified is of the full stored string as today.
- Semantics: the header lists requirements that do NOT paint (background apps, version floors). Zones declare their own app inline, so a document with only zones needs no header. Inheritance: a `NodeTree` install injects into the scope root node only; descendants inherit the *install*, not the header; a child that needs its own silent requirement gets its own header. On uninstall the kernel removes exactly the entries it injected (recorded in `injected_header_into`), never user-authored ones; collisions: the same app twice -> the higher `min` wins and the header is normalised on write.
- Placeholder: `AppZoneRequired` (new, in `src/components/office/app-zone/`): a bordered panel with the app icon from the listing (only if the listing is visible to the user; otherwise a generic icon), "This zone requires Kanban 1.2+", then one of: Install (user holds AppInstall and is in the audience -> opens the marketplace modal via the deep link); "Installed for you but disabled" -> Enable; "Ask an admin": copies the deep link and, in v2, sends `AppsRequest::RequestInstall{app_id, node_id}` which AppManage holders see as a badge in the modal's Requests tab; "Not available to you" when the app is outside the user's audience (uniform wording with "no such app" so audience membership is not probed). Zone ids collide -> the second zone renders an inline error, never two instances.

## 2.7 Marketplace

- Global catalogue source: repo file `apps/catalogue/catalogue.json` (SSOT, reviewed by PR), one entry per app = the manifest's listing fields + `manifest_url` + `signature`; built into the UI assets at deploy as `/apps/catalogue.json` with `catalogue.mldsa.sig` signed by an Avarok catalogue key (the release-sign tool with a new domain `citadel-app-catalogue-v1\0`). Served by the Worker's `[assets]` (free, same origin, `connect-src 'self'` satisfied, cacheable with the asset hash); self-hosted deployments ship the same file in the UI image. Verified in the wasm client before display. No D1, no R2, no cron.
- Workspace catalogue: the kernel registry (`AppsRequest::Publish{manifest_bytes, signature, artifact}` by `AppPublish`); entries carry the publisher's manifest with audience ≠ global. `AppsRequest::ListCatalogue` returns the global entries (always) plus registry entries whose audience admits the caller (`audience.rs`: `Workspace` -> any member; `NodeViewers`/`NodeTreeViewers` -> ViewContent on the node (ancestor grants count); `Members` -> named; `Roles` -> role id held). `GetListing{app_id}` for an entry the caller may not see answers the same `Unavailable` as a missing id.
- Audience vs install scope: audience = who may *see and be given* the app; scope = where an install *runs*. Rule: `reach(scope) ⊆ audience(app)` or the install is refused (a `Workspace` scope install of a `Members([alice,bob])` app is refused because others would run it; `Users([alice])` is fine). Global audience admits every scope. A user outside the audience never gets the app from an install, sees the generic placeholder, and cannot enumerate it.
- Modal: `src/components/citadel-apps/marketplace/AppsModal.tsx` (shadcn Dialog, lazy like SettingsModal tabs), tabs Global / This workspace / Installed / Requests (AppManage), search over name+summary+categories, listing card -> detail -> scope picker ("Just for me" / "Workspace..." which expands to workspace, this page, this page and below, chosen people) -> consent -> progress (server fetch + verify) -> done. All metadata rendered as text nodes; icons as `data:` PNG validated by magic bytes and byte cap (`img-src data:` already allowed). Versions: the detail shows the listed version, the installed version, and "update available" when the server's last check found one.
- Pricing hooks: `listing.pricing: {kind:'free'} | {kind:'external', url}` in v1; paid apps are out of scope (Q13).
- Third-party publishing: anyone with a key can publish to a workspace registry if that workspace grants them `AppPublish`; global listing is a PR to `apps/catalogue/catalogue.json` where CI (`scripts/check-app-catalogue.mjs`) verifies each entry's signature, manifest schema, import set ⊆ declared capabilities, size caps, no network wildcards, and the Avarok signature is produced at deploy.

## 2.8 Deep links

`/workspace?app=<id>[&scope=node:<nodeId>][&v=<version>]` on the same origin. Chat and document links already classify as `internal` through `classifyDocumentLink` (same-origin http(s) -> router path), so no new scheme. `App.tsx`'s `/workspace` route reads `app` and opens `AppsModal` on that listing; a listing the user may not see shows the uniform "This app is not available to you". Captured before sign-in exactly like `src/lib/share/pending-redirect.ts`: a sibling `src/lib/citadel-apps/app-link.ts` (`readAppLinkParams`: exactly `app` [+ `scope`, `v`, `server`], shape-checked; sessionStorage key `citadel.apps.pending-link`; taken once when a session is ready). External share form: `https://work.avarok.net/workspace?app=com.acme.kanban&server=acme.work.avarok.net`.

## 2.9 Threat model

| Threat | Mitigation |
|---|---|
| Malicious app code | core wasm, no ambient authority: only the import object; imported memory with hard max; no DOM, no fetch, no JS; every server-backed call re-checked by the kernel against install, scope, acting user, installer authority; watchdog termination |
| Confused deputy via md header injection | header writable only by the kernel on an AppManage+EditMdx install; UpdateNode from non-AppManage must preserve it byte-for-byte; a header can only *require*, never grant: a zone still runs only where an install covers the viewer |
| Installer escalation | effective caps are an intersection with the installer's `AppInstallAllow*` at call time, so a role demotion revokes live; scope requires node-level authority; `Users` scope must stay inside audience |
| Replay of old artifact versions | signature binds id+version+hashes; updates require strictly greater version; rollback is an explicit AppManage action to the recorded previous |
| Supply chain (compromised location) | integrity is hash+signature under the pinned key; locations are hints; key change forces re-consent; catalogue itself signed by Avarok; the manifest is signed bytes, stored verbatim |
| Resource exhaustion | memory max, watchdog, token buckets, instance cap, storage quotas inside `storage_gb`, egress caps metered as bytes_in, artifact 8 MiB, kernel per-CID limiter |
| Cross-app data access | storage keys namespaced by app_id and scope from the install record, never from the call; no capability enumerates other installs' storage |
| Clickjacking of install modal | `frame-ancestors 'none'` (already); visible-delay + pointer-move gate on Install |
| XSS via app metadata | all strings rendered as React text; description plain text; icon validated PNG bytes with size cap; ids regex-checked at publish and at parse; no markdown rendering of listings in v1 |
| Audience probing | uniform refusals for missing vs not-in-audience; ListCatalogue filters server-side |
| Network exfiltration | no page-side network; egress only through the kernel to manifest-listed explicit hosts the installer accepted; third-party apps cannot list wildcards; responses capped and metered |

## 2.10 Migration path for Docs

Docs today = wasm-bindgen glue + two wasm artefacts served from `/cdoc/` + a bespoke worker protocol (`open/paint/attachCanvas/...`). Path: (1) list Docs in the global catalogue as a first-party app with `publisher = Avarok`, `abi: "wasm-bindgen-glue-firstparty"` (an ABI value the loader accepts only when the pinned key is the Avarok first-party key, since glue is JS), `capabilities: [canvas, ui, documents, files, clipboard]`, seeded as an `Active` `Workspace`-scope install on provisioning (so existing documents keep opening; `nodeAppState` keeps reading `citadel_app` metadata); (2) generalise `CitadelAppId` from the closed union to "an installed app id" (registry.ts keeps the three first-party entries as the fallback catalogue); `DocumentHost.tsx`'s hard-coded `appId === 'docs'` becomes a lookup of the install's surface and ABI; (3) in citadel-docs, add the `citadel_app_abi_1` exports beside the wasm-bindgen ones (the editor protocol kinds map 1:1 to `AppEvent`s and `HostCall::documents`), then flip the catalogue entry to `abi: "citadel-app-abi-1"` and delete the glue path. PDF/LaTeX ("coming soon") arrive as ordinary catalogue apps.

## 2.11 Phased delivery

Decide before any code: Q1-Q7 below (signing key custody, network via egress, Docs seeding, Member seed gets AppInstall, catalogue in repo, artifact caps, header grammar).

Phase A (types + guards; Rust agent + UI agent + security review): `citadel-app-signature` crate (+ tests incl. cross-domain negative control); `types/src/apps.rs` (AppsRequest/Response, AppInstall, Capability, InstallScope, AppAudience, manifest structs with strict serde); `apps_md_header.rs` + fixtures; Permission variants + `ALL_VARIANTS` + role v2 migration + `roles_upgrade_tests.rs`; TS mirror + labels + category; bindings regenerated; parity script green. Tests: manifest schema refusals (each malformed field, with a valid control), header parse/split round-trip, migration gives AppInstall to Member-like roles and not Guest.

Phase B (kernel store + marketplace without runtime; Rust + UI agents): `kernel/apps/*`, `apps_store.rs`, `command_processor/apps.rs` (List/Get/Publish/Install/Uninstall/Update/Rollback/Consent/FetchArtifact/ListAudit/RequestInstall), `ArtifactFetcher` trait + DO and native impls; UI `apps-operations.ts` (the secure-links-operations pattern), `AppsModal`, consent screen, scope picker, deep link capture, `apps/catalogue/catalogue.json` + check script + signed build. Tests: every refusal has a control; audience filtering; scope ⊆ audience; header injection/removal and the EditMdx-only preservation guard; artifact fetch hash mismatch refused; signature by another key refused; version monotonicity; UX oracle on the modal.

Phase C (runtime; SDK agent + UI agent): `citadel-app-sdk-types`, `citadel-app-sdk`, `apps/sdk-fixtures/{hello-canvas, over-memory, undeclared-import, slow-frame}` built in CI for wasm32-unknown-unknown; host (`imports.ts`, `dispatch.ts`, worker, limits, watchdog); canvas pane via DocumentHost; md zone + placeholder + BaseOffice header preservation. Tests: fixtures prove each cap (undeclared import refused, memory growth traps at max, slow frame terminated; hello-canvas paints — the control); ungranted group answers `ungranted`; dispatcher over fake ports.

Phase D (capabilities): nodes/md/files/chat/members/storage/clipboard/notifications ports + kernel `Call` handlers with re-checks; egress proxy. Tests per capability: refused without grant, refused when the acting user lacks the human permission, refused outside scope, allowed with all three (control); egress host not in manifest refused.

Phase E: Docs on the SDK; publisher tooling (`tools/app-sign`), workspace registry UI, Requests tab, audit UI.

---

# RANKED QUESTIONS FOR THE OWNER (with recommended defaults)

1. **Comp "infinite" means the business tier's ceilings (1000 members, 500 connections) with relay unmetered, defined as grant shapes in tiers.json** — accept? Default: yes; anything beyond is a tiers.json edit.
2. **Admin coupon signing key: separate `CITADEL_ADMIN_MLDSA_PUBLIC_KEY` or reuse the support key?** Default: separate key, separate domain (a support reader must not mint grants).
3. **Trials require a card at Checkout?** Default: yes (`payment_method_collection: always`); trial caps apply until the first successful payment.
4. **Trial cap numbers** (`max_days` 30, limits = free tier's). Default: as proposed.
5. **Preview rate limit 20/hour per IP, hashed IP kept one hour** — acceptable for the privacy notice? Default: yes, note it in the privacy notice.
6. **App network access via a kernel egress proxy to explicit hosts (metered as bytes_in) vs deny in v1?** Default: deny in v1 (ship Phase C/D without `network`), proxy in Phase D after the first third-party app needs it.
7. **Artifact caps**: 8 MiB per artifact, 64 MiB of app storage per workspace inside `storage_gb`. Default: as proposed.
8. **Where the global catalogue lives: repo file signed at deploy (PR = review) vs D1 with a signed admin endpoint?** Default: repo file; no new always-on cost, and every listing passes CI.
9. **Who signs the global catalogue and holds the first-party app key** (same custody as the release key?). Default: a new catalogue key held like the release key; the Docs first-party key = the release key's domain-separated sibling.
10. **Member seed role gets `AppInstall` (self installs) via role migration v2?** Default: yes; nothing else migrated.
11. **Docs seeded as an Active workspace-scope install on provisioning, and allowed on the transitional glue ABI only under the first-party key?** Default: yes.
12. **Accessibility for canvas apps (`set_a11y_tree`) required in v1?** Default: optional in v1, required for global listing by Phase E.
13. **Paid apps / entitlements for apps?** Default: out of scope; `pricing` field reserved as `free | external`.
14. **Hidden header grammar `{/* @citadel-apps 1 {...} */}` on line 1 vs frontmatter?** Default: the comment.
15. **Request-access flow (`RequestInstall` visible to AppManage) in v1 or copy-link only?** Default: copy-link in Phase C, requests in Phase E.
16. **Revoking a coupon: default `also_revoke_grants` must be stated each time** — fine? Default: yes (PCND).
17. **May a third-party global listing be accepted without Avarok reading the source?** Default: yes, CI checks + signature + the consent screen are the control; the catalogue PR is the review moment.

### Critical Files for Implementation
- /Users/nologik/avarok/wt/batch-1021/billing/tiers.json (coupon shapes, caps, static codes; the SSOT both features' billing hooks read)
- /Users/nologik/avarok/wt/batch-1021/deploy/tenant-worker/control/tenants.mjs (coupon_code in CREATE_FIELDS, reservation batch, comp activation; split openCheckout out first)
- /Users/nologik/avarok/wt/batch-1021/deploy/tenant-worker/control/plans.mjs (entitlements with grant/trial clamp; what the monitor pushes)
- /Users/nologik/avarok/wt/batch-1021/citadel-workspace-types/src/structs.rs (Permission enum + ALL_VARIANTS; the apps permission group)
- /Users/nologik/avarok/wt/batch-1021/citadel-workspace-server-kernel/src/kernel/command_processor/async_process_command.rs (Apps sub-protocol dispatch at the SecureLinks site, line ~1303)
- /Users/nologik/avarok/wt/batch-1021/citadel-workspaces/src/components/documents/DocumentHost.tsx (the hard-coded docs branch that becomes the generic app host)
- /Users/nologik/avarok/wt/batch-1021/citadel-workspaces/src/lib/cdoc/worker/protocol.ts (the OffscreenCanvas worker pattern the app host generalises)