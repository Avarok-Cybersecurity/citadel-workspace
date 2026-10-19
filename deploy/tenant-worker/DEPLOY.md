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
- The parent repository with `citadel-workspaces` and `citadel-internal-service` checked out at
  the revisions to ship (`git submodule update --init citadel-workspaces citadel-internal-service`).
  The UI that is built is whatever `citadel-workspaces` has checked out: the onboarding flow is on
  its `feat/create-workspace` branch until that merges.
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
runs only for fresh sign-ins and registrations: a recovery-code sign-in and a resume-token
reconnect are not asked, and a client older than 0.12 is told to update.

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
     `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`,
     `invoice.paid` (the last two drive the pay-required state and its release, section 6)
   - Reveal the signing secret and set it as `STRIPE_WEBHOOK_SECRET` (step 4).

   The same with the Stripe CLI, if preferred:

   ```sh
   stripe webhook_endpoints create --url https://work.avarok.net/api/stripe/webhook \
     -d "enabled_events[]=checkout.session.completed" -d "enabled_events[]=customer.subscription.created" \
     -d "enabled_events[]=customer.subscription.updated" -d "enabled_events[]=customer.subscription.deleted" \
     -d "enabled_events[]=invoice.payment_failed" -d "enabled_events[]=invoice.paid"
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

### 6. Automatic billing: overage, dunning, terminations, alerts, the rates agent

Everything in this section reads two files and nothing else: `billing/tiers.json` (what is sold,
with the `derived: true` prices written from `billing/rates.json` × `billing/pricing-model.json`
by `scripts/rates/update-rates.mjs`) and `billing/policy.json` (every grace period, TTL and alert
threshold). `docs/plans/billing-automation.md` is the decision record. The pricing rows there are
still proposals awaiting the owner; the values ship in those files and change without code.

0. **Approval first.** `billing/tiers.json` holds only APPROVED prices and is what production
   sells. Proposals (docs/plans/billing-automation.md section B) are computed by `billing/derive.mjs`
   and only reported until the owner sets `billing/pricing-model.json` `approval.status` to
   `approved` (with `approved_on`/`approved_by`); then `scripts/rates/update-rates.mjs` writes the
   derived amounts into tiers.json, and that change ships like any other. `--apply`, the rates
   agent's tiers write and the Worker's price repair at Checkout all refuse while `proposed`.
   **Stripe is written only from origin/master at deploy, never from a branch**: the account is
   shared and its TEST mode is what production bills on (incident H8).
1. **Catalogue (step 5.1 again).** `--apply` creates or replaces every price with
   `tax_behavior` from `pricing-model.json` (exclusive), both Billing Meters (`citadel_relay_gb`,
   `citadel_document_appends`) and their metered prices, and brings Citadel's portal configuration
   up to date with the licensed products. A restricted key needs write on Billing Meters, Meter
   Events, Prices, Products and Billing Portal configurations, and read on the configuration for
   the deploy-time audit. Prices that still differ at the first sale are replaced by the Worker
   itself (`control/price-sync.mjs`); a missing product or price is not — run the script.
2. **Webhook events (step 5.2).** Add `invoice.payment_failed` and `invoice.paid` to the
   destination's events: they drive the pay-required state and its release.
3. **Migrations.** `deploy.sh` applies `0009_billing.sql` (the overage choice, dunning, purge
   audit, alerts) and `0011_document_appends.sql` (the appends outbox).
4. **`STRIPE_TAX`** (`wrangler.toml`, exactly `on` or `off`, no default). It ships `off`: the
   account's Stripe Tax is not activated (status `pending`), and Stripe refuses a Checkout that
   asks for automatic tax before it is. Once the owner activates Tax in the Dashboard (head office
   address, default tax behaviour exclusive, registrations for every jurisdiction that must be
   collected), set it to `on`: Checkout then collects a billing address and tax, and the
   usage-only subscriptions are taxed too.
5. **Email.** The `MAIL` binding (`[[send_email]]`) and `MAIL_FROM` send the dunning and alert
   emails through Cloudflare Email Sending from `mail.avarok.net`, which must be onboarded
   (SPF/DKIM under that subdomain only; the apex is ProtonMail). PR #166 uses the same binding
   for the claim-code email. Until the domain verifies, sends fail and are logged; the monitor
   retries dunning mail on its next run.
6. **Overage billing is a per-workspace choice** (`tenants.overage_billing`, made at Checkout and
   in Plan & billing). On: every metered dimension bills through the usage-only subscription
   (`control/usage-subscription.mjs`, now for monthly plans too; the plan's Checkout carries no
   metered item), reported by the monitor in whole units once a period's overage reaches
   `pricing-model.json` `overage_min`. Off: nothing beyond the quota is billed; the object
   terminates that dimension's service `termination_ttl_hours` after the quota is crossed
   (relay refused; documents read-only) until the period resets. No termination deletes data.
7. **Pay required.** `invoice.payment_failed` suspends the workspace (sockets closed with 4002,
   the host answers 403 `payment-required` with the purge date, the object is not started) and
   emails the Stripe customer; reminders go out on the policy's days, the final warning
   `final_warning_hours` before `grace_days`, and the purge then deletes the object's storage and
   the registry row (audit in `tenant_purges`, resumable). `invoice.paid` restores at once.
8. **The rates agent** (`.github/workflows/rates.yml`, Mondays 06:00 UTC) re-reads the
   Cloudflare and Stripe pricing pages, rewrites `billing/rates.json` and the derived prices, and
   opens or updates ONE pull request on `bot/rates`. It refuses a change over
   `max_change_percent_per_run` unless dispatched with `owner_approved`, never prices below cost ×
   multiplier, and writes nothing if any page fails to parse. The PR is opened with
   `GITHUB_TOKEN`, which does not start the validate workflow on it; add a PAT or App token
   secret if it must run CI before review.

## Post-quantum sign-in: the OPRF seed

Each tenant's object generates a 32-byte OPRF seed (the server key of the password factor's
hardening) when it is provisioned, or at its first start on a build that has this, and keeps it
in its key-value storage under `control:oprf-seed`, apart from the account rows. It is never
logged, reported or exported, and **there is no copy anywhere else** (an owner decision,
docs/plans/pq-sign-in.md): an object whose seed is lost or replaced can no longer verify any
password factor, which must then be reset; security keys and recovery codes keep working. A
stored value that is not 32 bytes stops the object rather than being replaced. Legacy accounts
are upgraded at their next login and cannot go back: rolling the Worker back below this release
locks out every account that signed in since.
`PQ_KSF_*` in `wrangler.toml` is the Argon2id cost clients stretch a password factor with; the
node refuses anything below the SDK's floor. The monitor counts accounts by auth-record version (AUTH-CENSUS.md).

## Deploying

```sh
cd deploy/tenant-worker
./deploy.sh --dry-run    # builds, runs the gates, bundles; no token needed, nothing is sent
CITADEL_CF_TOKEN_FILE=~/cf-token.txt CITADEL_STRIPE_KEY_FILE=~/stripe.citadel.test.rk.txt ./deploy.sh
```

`deploy.sh`, in order, stopping at the first failure:

1. `npm ci`; `build.sh` (the server wasm); `build-ui.sh` (the UI into `ui-dist/`, which it checks
   carries the three empty meta tags the Worker fills in).
2. Gates: the vitest suite (including `test/production-config.test.mjs`: no stats, host routing
   only), `cargo test -p tenant-storage-compat` (accounts a 0.10.0 server stored in its object
   still load under this tree's SDK, stay legacy, and upgrade to post-quantum sign-in in place) and `scripts/check-preview-csp-matches-production.mjs`
   (nginx, vite and the Worker serve one CSP).
3. The D1 id is not the placeholder.
4. The Stripe catalogue audit passes (read-only).
5. `wrangler secret list` shows `TURNSTILE_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`.
6. `wrangler d1 migrations apply citadel-control --remote`.
7. `wrangler deploy`: the routes `work.avarok.net/*` and `*.work.avarok.net/*`, the assets, the
   Durable Object migration `v1`.
8. Smoke: `https://work.avarok.net/create` carries `citadel-control-plane=/api` and a CSP that
   allows Turnstile; `https://smoke-probe.work.avarok.net/` answers `426`.

Then by hand: open `https://work.avarok.net/create`, create a free workspace (Turnstile renders
and passes), then a paid one with Stripe's test card `4242 4242 4242 4242`; in the Stripe
dashboard the webhook deliveries are `200`; `cfw tail citadel-tenant` shows the requests.

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
| `node upgrade.mjs <dir> <old-tenant-worker>` | dev | what the build in `<old-tenant-worker>` (a built `deploy/tenant-worker` of the commit production runs) stored in an object loads under this one: the same account logs in, reads its profile back, and is upgraded to post-quantum sign-in by that login |
| `node admission.mjs <dir>` | dev, then the always-fail Turnstile testing secret | the sign-in check enforced: no token refused (350), a passing token admitted, a refused one failed (351), for sign-in and registration; recovery-code and resume-token sign-ins not asked |
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
