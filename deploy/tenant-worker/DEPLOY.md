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

3. **Customer portal.** Dashboard (test mode), Settings, Billing, Customer portal. The Worker
   opens portal sessions with the default configuration and `return_url=https://work.avarok.net/`,
   so that configuration is the one that applies:
   - Payment methods: allow updating.
   - Invoices: show invoice history.
   - Subscriptions: allow cancelling (at the end of the period); allow updating quantities
     (seats); allow switching plans, with the Team and Business products and their monthly and
     yearly prices, and the storage add-on's quantity.
   - Business information: the default redirect link `https://work.avarok.net/`.
   - Save.

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
   only) and `scripts/check-preview-csp-matches-production.mjs` (nginx, vite and the Worker serve
   one CSP).
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
