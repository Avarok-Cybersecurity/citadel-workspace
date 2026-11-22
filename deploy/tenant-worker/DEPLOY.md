# Deploying the tenant Worker to work.avarok.net

One Worker, `citadel-tenant`, serves everything that is not the visitor's own agent:

| Host | What answers |
|---|---|
| `work.avarok.net/api/*` | the control plane: slug checks, creation (Turnstile, Stripe Checkout), the Stripe webhook, the billing portal |
| `work.avarok.net/*` (everything else) | the UI, from the Worker's static assets (`ui-dist/`), with the headers and meta tags the nginx image used to send |
| `<slug>.work.avarok.net` | that tenant's Durable Object: a WebSocket upgrade reaches its workspace server; anything else is `426` with no content |

`wrangler.toml` is the production configuration and `deploy.sh` deploys exactly it. Nothing in
this directory has been deployed yet; every step below is the operator's.

## Before the first deploy (once)

### 1. Tooling and checkout

- Node 22 or later, Rust with the `wasm32-unknown-unknown` target, `wasm-pack`.
- The parent repository at the revision to ship, with the `citadel-internal-service` submodule
  checked out (`git submodule update --init citadel-internal-service`). The UI that is built is
  that revision's `citadel-workspaces/` directory.
- A Cloudflare API token in a file only you can read (`chmod 600`), with: Account: Workers
  Scripts Edit, D1 Edit; Zone `avarok.net`: Workers Routes Edit. `deploy.sh` reads it from the
  file named by `CITADEL_CF_TOKEN_FILE`. The commands below take it the same way:

  ```sh
  export CITADEL_CF_TOKEN_FILE=~/cf-token.txt
  cfw() { CLOUDFLARE_API_TOKEN="$(tr -d '\r\n ' < "$CITADEL_CF_TOKEN_FILE")" npx --no-install wrangler "$@"; }
  cd deploy/tenant-worker && npm ci
  ```

### 2. The control plane's database

```sh
cfw d1 create citadel-control
```

Paste the `database_id` it prints over the all-zeros placeholder in `wrangler.toml`
(`[[d1_databases]]`) and commit it. `deploy.sh` refuses to run while the placeholder is there.
The migrations are applied by `deploy.sh` (`d1 migrations apply --remote`), not here.

### 3. DNS (dashboard: avarok.net, DNS, Records)

A Worker route only runs for a proxied hostname, and the tenant hosts need a record to resolve.

| Type | Name | Content | Proxy |
|---|---|---|---|
| `AAAA` | `work` | `100::` | Proxied (replaces today's CNAME to the retired box) |
| `AAAA` | `*.work` | `100::` | Proxied |

`100::` is the discard prefix: with a Worker route on both names the origin is never contacted.
The Advanced Certificate Manager certificate for `work.avarok.net` and `*.work.avarok.net` is
already active; check it still is (SSL/TLS, Edge Certificates) before deploying. Write down the
old `work` record before changing it (see Rollback).

### 4. Secrets

Each one leaves its routes answering `503` until it is set; `deploy.sh` refuses to deploy while
any is missing. Type each value at the prompt (it is not echoed). On the first `secret put`
wrangler offers to create the `citadel-tenant` Worker: say yes (it has no routes until deploy).

```sh
cfw secret put TURNSTILE_SECRET        # the secret of the Turnstile widget whose sitekey is 0x4AAAAAAFAR1uNZSc7lTBiy
cfw secret put STRIPE_SECRET_KEY       # the TEST-mode restricted key (rk_test_...), as in ~/stripe.citadel.test.rk.txt
cfw secret put STRIPE_WEBHOOK_SECRET   # whsec_... from step 5
cfw secret list                        # names only
```

Avarok support's telemetry reads (control/support.mjs) need the support key's PUBLIC half. The
owner generates the pair once, offline, and keeps the private key file off this machine's backups:

```sh
cargo run --release --manifest-path ../../tools/telemetry-read/Cargo.toml -- keygen --private-key <offline path>/support.key
cfw secret put CITADEL_SUPPORT_MLDSA_PUBLIC_KEY   # the 3904 hex characters keygen printed
```

It is a secret only so that wrangler.toml carries no value for it; `deploy.sh` requires it.

work.avarok.net's own server key signs its `/.well-known/citadel` and every "Sign in with
Citadel" assertion (control/control-identity.mjs). Make it ONCE, from the OS CSPRNG, and set
`CONTROL_SERVER_KEY_ISSUED_AT` in wrangler.toml to the same moment (`date -u +%s`) in the same
change. The Worker never makes one: a new key makes every MCP and node that pinned the old one
refuse the issuer (`KeyChanged`), so replacing it is a planned ceremony, never a repair.

```sh
openssl rand -hex 32 | cfw secret put CONTROL_SERVER_KEY_SEED   # 64 lowercase hex characters; never echoed, never stored elsewhere
```

Without it the control host's `/.well-known/citadel` answers 404 and every `/sign-in/*` route
`503 issuer_unavailable`, each with a `[control] ... CONTROL_SERVER_KEY_SEED is not set` log line;
`deploy.sh` requires it.

Two more are OPTIONAL, and `deploy.sh` does not require them until the agent asks for relay
servers: the Cloudflare Realtime TURN key the tenant objects mint members' short-lived relay
credentials from (`GetIceServers`, control/ice.mjs). Without both, a member asking for relay
servers is told none are available; nothing fails. The token never leaves the Worker: members
receive only credentials that expire after `TURN_CREDENTIAL_TTL_SECONDS` (wrangler.toml).

```sh
cfw secret put TURN_KEY_ID             # the TURN key's id (Realtime > TURN in the dashboard)
cfw secret put TURN_KEY_API_TOKEN      # that key's API token
```

Turnstile: in the dashboard (Turnstile, the widget for that sitekey), the widget's hostnames must
include `work.avarok.net`; the Worker also refuses a pass whose hostname is anything else
(`TURNSTILE_HOSTNAMES`).

The same widget serves the sign-in check a workspace admin can turn on ("Require a human check
to sign in"): its site key is the public var `TURNSTILE_SITE_KEY`, which discovery
(`GET /api/admission[/<slug>]`) hands to the sign-in and registration forms, and the object's
admission check verifies its tokens with `TURNSTILE_SECRET` and the actions `sign-in` and
`register`. The widget renders on `work.avarok.net`, so `TURNSTILE_HOSTNAMES` is the hostname
those answers carry too, not the tenant's own host. The widget is rendered with `cData` set to
the tenant's slug, and the check refuses an answer whose `cdata` names another workspace (only
an answer from Cloudflare's testing keys, which carries none, is taken without it). The check
runs for fresh sign-ins, registrations and recoveries (a recovery-phrase sign-in is asked with
action `recover`); a resume-token reconnect is not asked, and a client older than 0.12 is told to update.

### 5. Stripe, in TEST mode

Nothing here reaches live mode: `deploy.sh`'s catalogue audit refuses a live key.

1. **Catalogue.** The prices the Worker sells must exist under their lookup keys
   (`citadel-team-month`, ..., from `billing/tiers.json`):

   ```sh
   node scripts/stripe-catalogue.mjs ~/stripe.citadel.test.rk.txt           # audit, read-only
   node scripts/stripe-catalogue.mjs ~/stripe.citadel.test.rk.txt --apply   # only if the audit differs
   ```

2. **Webhook endpoint.** Dashboard (test mode), Developers, Webhooks, Add destination:
   - Endpoint URL: `https://work.avarok.net/api/stripe/webhook`
   - Events: `checkout.session.completed`, `customer.subscription.created`,
     `customer.subscription.updated`, `customer.subscription.deleted`
   - Reveal the signing secret and set it as `STRIPE_WEBHOOK_SECRET` (step 4).

   The same with the Stripe CLI, if preferred:

   ```sh
   stripe webhook_endpoints create --url https://work.avarok.net/api/stripe/webhook \
     -d "enabled_events[]=checkout.session.completed" -d "enabled_events[]=customer.subscription.created" \
     -d "enabled_events[]=customer.subscription.updated" -d "enabled_events[]=customer.subscription.deleted"
   ```

3. **Customer portal.** The Stripe account is shared with another product, so the Worker never
   opens Stripe's default portal (that one is the other product's). It opens the Citadel-only
   configuration named by `STRIPE_PORTAL_CONFIGURATION` in `wrangler.toml`
   (`bpc_1UIbClCgLMkhvcEsvf9lxARd`, metadata `product=citadel-workspace`); unset, the portal route
   answers 503. That configuration allows:
   - payment methods: updating; invoices: history;
   - subscriptions: cancelling at period end; switching between the Team and Business monthly
     and yearly prices; changing quantities: seats, storage blocks and secure-link packs
     (add-ons 1 to 1000, the Worker's `MAX_STORAGE_BLOCKS` / `MAX_LINK_PACKS`).
   Stripe's portal cannot add an item a subscription does not have, nor take an add-on below 1:
   a workspace first buys packs or storage at checkout. A new add-on in `tiers.json` needs its
   product and prices added to this configuration (`features[subscription_update][products]`).

### 6. Usage metering and relay overage (PROPOSED, awaiting owner approval)

The quota numbers and the overage price in `billing/tiers.json` (`metering`, `metered`, and each
tier's `connections*` / `relay_gb_*`) are proposals. Until they are approved and applied, the
catalogue audit reports the relay-overage meter, product and price (`citadel-relay-overage`) as
missing, and `deploy.sh` stops there -- deliberately. Once approved:

1. `node scripts/stripe-catalogue.mjs <key file> --apply` creates the Billing Meter
   (`citadel_relay_gb`, sum of `value`, customer by `stripe_customer_id`) and the metered price.
   A restricted key needs write on Billing Meters and Meter Events besides what it has.
2. `deploy.sh` then applies D1 migration `0003_usage.sql` (billing period on `tenants`,
   `tenant_usage`) and deploys the Cron trigger (`*/15 * * * *`, the usage monitor).
3. Objects provisioned before this deploy keep serving: a limit their stored entitlements lack
   is derived from their stored plan (tier, seats) through `billing/tiers.json`
   (`control/plans.mjs` `enforcedEntitlements`). The monitor's first run then pushes the full
   entitlements as drift repair. Nothing is refused and nothing needs doing by hand.

Monthly Team and Business Checkouts carry the metered `citadel-relay-overage` price as a second
line item (no quantity), so their overage is billed on the monthly invoice.

**Yearly overage: a usage-only subscription** (decided 2026-09-23, `control/usage-subscription.mjs`).
A Stripe subscription bills every item on one interval, so a yearly plan cannot hold the monthly
metered price. When a yearly Team or Business plan becomes active, the webhook creates a second
subscription holding only the overage price (idempotency key `usage-sub-<tenant_id>`), records it
in `tenants.usage_subscription` (migration 0004) in the same batch as the event, cancels it when
the plan ends, and replaces it if the customer cancels it. The monitor bills a yearly tenant once
it exists; until then its overage is recorded and logged as unbilled.

## Post-quantum sign-in: the OPRF seed

Each tenant's object generates a 32-byte OPRF seed (the server key of the password factor's
hardening) when it is provisioned, or at its first start on a build that has this, and keeps it
in its key-value storage under `control:oprf-seed`, apart from the account rows. It is never
logged, reported or exported, and **there is no copy anywhere else** (an owner decision,
docs/plans/pq-sign-in.md): an object whose seed is lost or replaced can no longer verify any
password factor, which must then be reset; security keys and the recovery phrase keep working. A
stored value that is not 32 bytes stops the object rather than being replaced. Legacy accounts
are upgraded at their next login and cannot go back: rolling the Worker back below this release
locks out every account that signed in since.
`PQ_KSF_*` in `wrangler.toml` is the Argon2id cost clients stretch a password factor with; the
node refuses anything below the SDK's floor. `PQ_SECURITY_KEY_RP_ID` is the WebAuthn relying party every tenant's
security keys are scoped to; the node names it in every sign-in challenge and will not start without
it. It is permanent (a key enrolled under one ID never signs in under another), so it stays
`work.avarok.net`, the ID the UI has enrolled every key under (`rp-id.ts`; a UI test holds them equal). The monitor counts accounts by auth-record version (AUTH-CENSUS.md).

## Server identities

Every tenant's object holds an ML-DSA-65 server key seed (`control:server-key-seed`) and its
provisioning record names its domains (the kernel's `[identity]`); both are made when it is
provisioned, and never when they are read, since a new key makes every client that pinned the old
one refuse the server. An object an earlier release provisioned without them **does not start**
and answers 404 at `/.well-known/citadel`. Nothing upgrades it or falls back to a default; the
reset (RESET-PLAN) replaces such tenants.

## Deploying

```sh
cd deploy/tenant-worker
./deploy.sh --dry-run    # builds, runs the gates, bundles; no token needed, nothing is sent
CITADEL_CF_TOKEN_FILE=~/cf-token.txt CITADEL_STRIPE_KEY_FILE=~/stripe.citadel.test.rk.txt ./deploy.sh
```

A real deploy also needs `CITADEL_FIRST_PARTY_SIGNED_DIR`: the apps every workspace is provisioned
with (the Calendar), signed by `node scripts/build-first-party-apps.mjs --sign <dir>` with the
first-party seed in `CITADEL_APP_SIGNING_SEED_HEX`. The seed is the org secret only the Deploy
workflow's signing step reads, so a deploy is that workflow's; `deploy.sh` refuses to build without
the directory. `--dry-run` builds without it, provisioning no first-party app.

`deploy.sh`, in order, stopping at the first failure:

1. `npm ci`; `build.sh` (the server wasm); `build-ui.sh` (the UI into `ui-dist/`, which it checks
   carries the three empty meta tags the Worker fills in).
2. Gates: the vitest suite (including `test/production-config.test.mjs`: no stats, host routing
   only), `cargo test -p tenant-storage-compat` (the auth-record census counts the records this
   tree's SDK stores) and `scripts/check-preview-csp-matches-production.mjs`
   (nginx, vite and the Worker serve one CSP).
3. The D1 id is not the placeholder.
4. The Stripe catalogue audit passes (read-only).
5. `wrangler secret list` shows `TURNSTILE_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`.
6. `check-do-bindings.mjs`: no Durable Object class a migration deletes keeps a binding name the
   live Worker binds to it (below), read-only against the API.
7. `wrangler d1 migrations apply citadel-control --remote`.
8. `wrangler deploy`: the routes `work.avarok.net/*` and `*.work.avarok.net/*`, the assets, the
   Durable Object migrations not yet applied (`v1`; `v2`, the reset, below).
9. Smoke: `https://work.avarok.net/create` carries `citadel-control-plane=/api` and a CSP that
   allows Turnstile; `https://smoke-probe.work.avarok.net/` answers `426`.
10. Identity upgrade: waits, at most 20 minutes, until the registry holds no tenant still to be
   upgraded to server identities (below), and fails naming any that remain. With none it passes at
   once.

Then by hand: open `https://work.avarok.net/create`, create a free workspace (Turnstile renders
and passes), then a paid one with Stripe's test card `4242 4242 4242 4242`; in the Stripe
dashboard the webhook deliveries are `200`; `cfw tail citadel-tenant` shows the requests.

## Deleting a Durable Object class

Cloudflare's legacy migrations reference (developers.cloudflare.com/durable-objects/reference/
durable-object-class-migrations-legacy): "Remove the binding for the class you wish to delete from
the Wrangler configuration file", before a Delete migration runs. The API applies this by binding
NAME against the live Worker: a deploy that deletes class C while keeping a binding of the name the
live Worker binds to C is refused, `Cannot apply --delete-class migration to class 'C' without also
removing the binding that references it. [code: 10061]`, even when the new config points that name
at another class. `wrangler deploy --dry-run` does not see it; the upload does, after the build and
the D1 migrations.

So a class that replaces a deleted one takes a new binding name, in the same deploy as the delete:
migration `v2` (the reset: every tenant object of `WorkspaceServer` deleted with its storage,
tenants starting again on an empty `WorkspaceServerV2`) binds the new class as `WORKSPACE_V2`
(`control/dispatch.mjs` `objectFor` is the one place it is read). One deploy applies it.
Proven on 2026-11-21 on throwaway Workers and on `citadel-tenant-staging`: the shape with the name
kept was refused with 10061; with `WORKSPACE_V2` it uploaded, `citadel-tenant-staging_WorkspaceServer`
was gone and `citadel-tenant-staging_WorkspaceServerV2` existed, and a second deploy of the same
config was a no-op. (Splitting it in two also works: one deploy adds the new class and moves the
binding, a later tag deletes the old class; it costs a second production deploy.)

`deploy.sh` reads the live Worker's bindings first (`check-do-bindings.mjs`, the rule in
`do-binding-rule.mjs`, `test/do-binding-rule.test.mjs` with the refused shape as its control) and
stops before touching D1 if the deploy would be refused.

## Rollback

- **Code:** `cfw deployments list`, then `cfw rollback <version-id>` to the previous version.
  Durable Object and D1 migrations are forward-only and are not undone by a rollback; a version
  that predates a migration it depends on must not be rolled back to.
- **Take the site off Cloudflare's Worker:** Workers and Pages, `citadel-tenant`, Settings,
  Domains and Routes: remove both routes. The DNS records then point at nothing (`100::`); restore
  the old `work` record from step 3 if another origin should answer.
- **Stripe:** disable the webhook endpoint (Developers, Webhooks) so no events arrive while the
  Worker is off.
- **Never** `wrangler delete` the Worker: its Durable Objects are the tenants' workspaces, and
  deleting the Worker deletes them.

## Local runs

`wrangler.toml` is used as is; local runs override only what a machine without subdomains, or
without a real Turnstile pass, needs (the header of `wrangler.toml` lists them). Build first:
`SKIP_SUBMODULE_CHECK=1 ./build.sh`, and `./build-ui.sh` for anything that serves the real UI.

| Run | Overrides | What it proves |
|---|---|---|
| `npx vitest run` | path routing and diagnostics on, `test/fixture-ui` as assets; the production tests read `wrangler.toml` through wrangler and use its own vars | the control plane, the UI headers and meta tags, no stats in production |
| `node admission.mjs <dir>` | dev, then the always-fail Turnstile testing secret | the sign-in check enforced: no token refused (350), a passing token admitted, a refused one failed (351), for sign-in and registration; a resume-token sign-in not asked, a recovery-phrase one asked (action `recover`) |
| `node sign-in.mjs <dir>` | dev | post-quantum accounts, the sign-in setting (admin-only, discovery follows it) and the OPRF seed surviving a restart |
| `./proof-control.sh` | dev (as `proof-lib.mjs` `DEV_OVERRIDES`) | Turnstile, free creation, a real TEST-mode Checkout and signed webhooks |
| `node serve-tenants.mjs ...` | dev | tenants by path, for the agent and kernel proofs |
| `node proof-production.mjs ...` | Turnstile's testing secret and hostname only | the site, host routing, `426` on a tenant host, and (with `--serve`) the WebSocket proof below |

`wrangler dev` answers every request as the host of the first route (`work.avarok.net`),
rewriting `Host` and `Origin`, unless `--local-upstream` names another. The dev runs pass
`--local-upstream 127.0.0.1:<port>`; the production-like proof passes nothing for the apex and
`--local-upstream <slug>.work.avarok.net` for the tenant host:

```sh
export PATH=$HOME/.nvm/versions/node/v22.16.0/bin:$PATH
PROOF_PORT=8848 PROOF_LOCAL_PROTOCOL=https NODE_TLS_REJECT_UNAUTHORIZED=0 \
  node proof-production.mjs "$(mktemp -d)" /tmp/claims.json acme --serve
# from the repository root, once it prints SERVING:
CITADEL_TENANT_PROOF_ENDPOINT=wss://localhost:8848/acme CITADEL_TENANT_PROOF_CLAIMS=/tmp/claims.json \
CITADEL_TENANT_PROOF_INSECURE=1 SKIP_WASM_BUILD=1 cargo test -p citadel-workspace-server-kernel \
  --test a_hosted_tenant_is_claimed_with_its_claim_code -- --ignored --nocapture   # E2E PASS
```

There the tenant is chosen by the host alone (path routing is off); the endpoint's `/acme` only
tells the test which claim code to use.
