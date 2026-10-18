# Pricing decisions needed from the owner (Part 1) — 2026-10-18

Every number below is either VERIFIED (source named, fetched today) or marked ASSUMED/UNVERIFIED.
"×3" is the proposed multiplier (section C). Rounding: the billed unit is rounded UP to the cent.

## A. Fee stack we pay on every charge (VERIFIED today, Stripe's own pages)

| Fee | Rate | Source |
|---|---|---|
| Card, domestic | 2.9% + $0.30 per successful charge | stripe.com/pricing |
| International card / currency conversion | +1.5% / +1.0% | stripe.com/pricing |
| Stripe Billing (subscriptions, pay-as-you-go) | 0.7% of billing volume | stripe.com/billing/pricing |
| Stripe Tax, no-code (Checkout + Billing count as no-code) | 0.5% per transaction where we are registered | stripe.com/tax/pricing |
| Stripe Meters | up to 100M meter events/month included in Billing | stripe.com/billing/pricing footnote |
| Cloudflare Email Sending (dunning mail) | 3,000/month included, then $0.35 per 1,000 | developers.cloudflare.com/email-service/platform/pricing |

Total variable: **4.1% + $0.30 per charge** (domestic). On a $6 monthly Team seat that is $0.55 = **9.1%**;
on $12 Business $0.79 = 6.6%; on a $60 yearly seat $2.76 = 4.6%. The draft analysis used 2.9%+$0.30
only — it missed Billing's 0.7% and Tax's 0.5%.

Consequence: **a separate usage-only invoice under $0.31 loses money** (the $0.30 fixed fee). Yearly
plans bill overage on a second, monthly, usage-only subscription (existing code), so a 1 GB overage
($0.10) costs $0.30 to collect. Decision 7 below.

## B. Limits and prices, one row each

Cost basis (Cloudflare, VERIFIED 2026-09-22 in tenant-quotas.md and re-fetched today from the
`index.md` pages): DO rows written $1.00/M after 50M included; **deletes count as rows written**
(DO pricing footnote 4); WS incoming messages 20:1 at $0.15/M requests; DO SQLite $0.20/GB-month,
10 GB hard cap per object; R2 $0.015/GB-month; TURN $0.05/GB outbound; DO duration $12.50/M GB-s
on 128 MB = **$4.05 per always-on tenant/month** (unchanged, not per seat).

Document append cost (VERIFIED from code on feat/citadel-docs-r1, `documents_store.rs` in the kernel's transaction module
header: "an append writes its update and the head and nothing else"; compaction later deletes the
covered update, and a delete is a row written): **3 rows written per append** (2 at append time, 1
at compaction) = $3.00/M, plus 1/20 request = $0.0075/M → **$3.01 per million appends**. The draft
said $2.01/M: it did not count the compaction delete.

| # | Limit / price | What it bounds | Our cost | Today | Proposed | Evidence / note |
|---|---|---|---|---|---|---|
| 1 | `appends_per_second` (per session) | money per session-month | $3.01/M appends: at 50/s = **$390/session-month**; at 10/s = $78 | 50 | **10** (20 if the collab client does not coalesce keystrokes) | A typist peaks at ~10 chars/s; the UI sends one Append per editor change (`document-sync.ts`), so 10/s only holds with ≥50 ms client coalescing — that is a docs-branch change, not this PR's |
| 2 | `pulls_per_second` | rows read + CPU | reads are $0.001/M: negligible; CPU/duration is the real bound | 20 | **10** | symmetry with appends; 64 updates per pull |
| 3 | `awareness_per_second` | CPU + fan-out | not persisted: no row cost | 20 | **10** | cursor updates; 4 KiB each |
| 4 | `max_update_bytes`, `max_snapshot_bytes`, `max_awareness_bytes`, `max_pending_log_bytes`, `compact_at_pending_bytes`, `retain_covered_updates_seqs`, `max_clients_per_document`, `max_request_frame_bytes`, `snapshot_min_updates`, `max_updates_per_pull` | memory / storage per document | a 500-page doc snapshot is 2.08 MB (measured); 32 MiB pending log cap per doc | as proposed on PR #246 | **unchanged** | storage per doc is bounded by the plan's storage quota (row 9), not by these |
| 5 | Monthly append budget, included per seat | money per tenant-month | 250k × $3.01/M = **$0.75/seat at most** | none | **250,000 appends per paid seat per period** (Free: 50,000 total) | typical writer 15 min/day ≈ 66k/month ($0.20); heavy 1 h/day ≈ 264k ($0.79) |
| 6 | Append overage price (metered) | abuse backstop that still pays | $3.01/M | none | **1¢ per 1,000 appends = $10/M (3.3×)**, Stripe Billing Meter `citadel_document_appends` | derived: ceil(1,000 × $3.01/M × 3 = 0.903¢) = 1¢. Alternative: hard stop at the budget (no billing); decision 4 |
| 7 | Relay overage price (metered, exists) | relayed GB beyond plan | DO path ≤ $0.006/GB; TURN path $0.05/GB | $0.10/GB (approved 2026-09-23) | **$0.15/GB** = ceil(max path cost × 3) | derivation uses the dearer path because customers do not choose the path; keeping $0.10 is a 2× on TURN — decision 5 |
| 8 | Minimum billable overage per period | the $0.30 fixed fee | fee > revenue below $0.31 | none | **5 GB / 50,000 appends** (anything under is forgiven; costs us ≤ $0.25) | decision 7 |
| 9 | Storage add-on, per 10 GB block | DO SQLite storage | $2.00/block-month on DO; $0.15 on R2 | $2.00/mo, $20/yr (= 1× cost: violates cost-plus; yearly is below cost) | **$6.00/mo, $60/yr** on DO (= $2.00 × 3); becomes $0.50/mo automatically when `storage_backend` in the model flips to `r2` | the 10 GB per-object cap is still binding: blocks beyond ~9 GB total cannot be delivered until R2 exists (quotas plan decision 1, still open) |
| 10 | Storage grant per seat | what the seat price must cover | Team 10 GB/seat = $2.00/seat on DO; Business 25 GB = $5.00 | 10 / 25 GB | **Team 2 GB/seat, Business 5 GB/seat** (quotas-plan option (b)) | at today's grants the ×3 floor is Team **$8.61 > $6** and Business **$18.15 > $12**; at the cut grants the floors are $3.81 and $6.15 (both under list). Or build R2 first (option (a)) |
| 11 | Seat prices | the plan | Team floor $3.81, Business $6.15 (row 10 cut grants, worst case full use, ×3) + $4.05/tenant fixed | $6 / $12 (approved 2026-09-22) | **keep $6 / $12 as list prices; the rates file proves list ≥ cost×3 floor** (a drift test), and can switch to strictly derived on an owner flag | strictly derived seat prices would be $4 / $7 today: lower than list. Note Team at 1 seat nets ≈ $0.13/month after fees + the tenant's $4.05 duration; it pays from 2 seats |
| 12 | Secure-link pack ($2 / 50 links) | links | links are rows: ≈ $0 | $2/mo | **unchanged** (pure margin) | not cost-driven |
| 13 | Storage overage (metered) | — | — | hard cap | **no metered storage overage**: keep the hard cap + blocks (the 10 GB object cap makes "allow then bill" unsafe) | decision 6 |
| 14 | Documents count against the storage quota | | | — | **yes** (snapshots + pending logs + retained updates, in the same `storage_gb`) | the DO backend bills them as stored bytes like everything else |

## C. Multiplier: 3× (proposed)

What it has to cover, per paid seat-month: Stripe 4.1% + $0.30 (6.6–9.1% of a monthly seat);
Free-tier subsidy (−$4.05/month per always-on Free tenant: at one Free tenant per five paid seats
that is −$0.81/seat); a Cloudflare price rise between weekly rate runs (the guard caps a change at
25%/run, section D); international cards (+2.5%); support. Sensitivity: at 2× a 1-seat Team loses
money against its $4.05 fixed duration; at 3× every row above clears cost after fees. 2.5× is the
lowest that still clears on the metered rows; the seat rows are list-priced anyway.

## D. Tax

- Stripe Tax, `automatic_tax[enabled]=true` on every Checkout Session and on the usage-only
  subscriptions; `customer_update[address]=auto` + `billing_address_collection=required` so the
  address drives the rate (docs.stripe.com/tax/checkout/page, VERIFIED).
- Prices **tax-exclusive** (`tax_behavior=exclusive`, USD convention). It is immutable once set,
  which is fine: the catalogue script already replaces prices by lookup key (new price takes the
  key, old one archived, subscriptions keep theirs).
- Product `tax_code` for SaaS: candidates `txcd_10103001` "Software as a service (SaaS) - business
  use" / `txcd_10103000` personal use — **UNVERIFIED**: Stripe's page says never infer a code;
  confirm against the Tax Codes list before the catalogue sets it (decision 9).
- Fee 0.5%/transaction where registered. Stripe collects **only where a registration exists**: the
  owner must add registrations (Dashboard → Tax → Registrations) and activate Tax (origin
  address, default tax behaviour). Until then the integration runs with nothing collected, which
  is also what happens today.
- Today NOTHING collects tax (no `automatic_tax` anywhere in the Worker — VERIFIED by grep).

## E. Dunning and purge (what "payment required" means, precisely)

| Day | Trigger | State | What happens |
|---|---|---|---|
| 0 | `invoice.payment_failed` (subscription or usage-only) | `payment_required` | the tenant host refuses WebSocket upgrades with 403 `{error:"payment-required", purge_at}`; the object is not started (so it costs no duration); no relay credentials; discovery and `/status` carry `billing:{state, since, purge_at}` so the UI shows the pay screen; email #1 to the Stripe customer's address (from the invoice event; not stored elsewhere) with the hosted invoice link |
| 7, 21 | monitor cron | same | reminder emails #2, #3 |
| 28 | monitor cron | same | **final warning**: "deleted in 48 hours" (#4) |
| any | `invoice.paid` / subscription `active` | `active` | restored at once by the webhook; all mails stop |
| 30 (= `BILLING_GRACE_DAYS`, required config, no default) | monitor cron | `purged` | the object's storage is deleted (`deleteAll`), the D1 row marked purged with an audit line per step; idempotent and resumable; the slug is released (decision 10) |

Stripe side (owner, Dashboard): Smart Retries 8 tries / 2 weeks (Stripe's recommended default),
then "mark the subscription unpaid". Our state machine depends on neither: it moves on the
invoice events. A customer who **cancels while paid up** still downgrades to Free with data kept
(existing behaviour); a cancellation Stripe makes for non-payment (`cancellation_details.reason =
payment_failed`) stays on the purge clock.

Mail: Cloudflare Email Sending through the `MAIL` binding — reusing PR #166's mail module (`mail.mjs`)
verbatim (same path, same bytes, so the two PRs merge cleanly). Owner approved mail.avarok.net on
2026-09-27; the domain must be verified before dunning mail goes out.

## F. Decisions needed

1. Multiplier 3× (section C) — or 2.5×?
2. Document limits: appends/pulls/awareness 10/s (row 1–3); include 250k appends per seat (row 5)?
3. Storage grants cut to 2 GB / 5 GB per seat (row 10) — or build R2 first and keep 10/25?
4. Append overage billed at 1¢ per 1,000 (row 6) — or a hard stop at the budget?
5. Relay overage re-derived to $0.15/GB (row 7) — or keep the approved $0.10?
6. Storage: hard cap + add-on blocks only, no metered storage overage (row 13)?
7. Minimum billable overage 5 GB / 50k appends per period (row 8)?
8. Seat prices stay list ($6/$12) with a floor test, not strictly derived (row 11)?
9. Tax code: confirm `txcd_10103001` (business SaaS) — and will you add registrations now?
10. Grace 30 days; reminders 0/7/21/28; purge releases the slug; voluntary cancel keeps data on Free?
11. Rates agent guardrail: refuse any derived-price change > 25% per weekly run without
    `--owner-approved`; never below cost × multiplier; fail closed on an unparseable page.
12. Still open from the quotas plan: Free-tier duration ($4.05/always-on Free tenant) — cap hours,
    cap count, or accept.

Part 2 is being built against the proposed values; every number above lives in one config file
(`billing/pricing-model.json`) so a different answer changes no code.

## G. Overage billing toggle, terminations, alerts and terms (owner requirements of 2026-10-18)

Owner answers, 2026-10-18: G1–G6 approved as proposed; G7 with the qualified wording below. The effective date of the bumped terms is set by the release PR (`policy.json` `terms.effective_date`).

Every value in this section lives in `billing/policy.json` (one file, required keys, no code
defaults); the Worker, the tenant objects, the UI's copy, the emails and the legal terms render it.

| # | Item | Proposed | Note |
|---|---|---|---|
| G1 | "Enable overage billing" | per workspace; chosen at Checkout (a required field of the paid creation: the form offers no pre-selection) and changed later in Plan & billing by the claim-code holder; Free is always off | with it on, ALL overage bills through the usage-only subscription (one path whatever the plan's interval, with Stripe Tax); the plan's Checkout carries no metered items any more |
| G2 | Overage off: termination TTL | **48 h** after the quota is crossed, until the period resets | `overage_billing.termination_ttl_hours` |
| G3 | What "terminated" means | relay: refused (no credentials minted, nothing relayed; direct P2P, messaging and the workspace continue). Document appends: documents read-only (reads/pulls continue). Storage: uploads refused at the quota at once, toggle or not (10 GB object cap) | **no data is deleted by any termination** (`data_deleted_on_termination: false`); deletion exists only in dunning's purge. Decision: confirm no deletion |
| G4 | Alerts | 50 / 80 / 100 % of the included quota per dimension, once per period; with overage on, every 10 GB / 100k appends of overage; with it off, 48 h and 24 h before termination and at termination | `alerts.*` |
| G5 | Alert channels | email to the Stripe customer's address (paid; Free has no address until PR #166 lands → in-app only); in-app: a coarse level (`none/warn/over/terminating/terminated`, no numbers) on the public status and discovery answers, and the full meters on `POST /api/tenants/<slug>/usage` to the claim-code holder | decision: is a coarse level on a public answer acceptable (discovery today says "no plan, no counts")? |
| G6 | Terms | Customer Terms and Platform Terms render the grace days, TTL, thresholds and termination rules from policy.json, plus "may change at any time without notice"; both versions bump 1 → 2; platform terms re-acceptance on next sign-in uses the existing GetTerms machinery; Customer Terms have no re-acceptance site after creation today → proposed: re-acceptance when the claim-code holder next opens Plan & billing | a parity check holds every rendered value to policy.json |
| G7 | Change clause | Owner 2026-10-18: "We may change these grace periods, thresholds and terms at any time, without prior notice, to the extent permitted by the law of the applicable jurisdiction." — one source (`policy.json` `terms.change_notice`), rendered into both Customer and Platform Terms | the unqualified "without warning" wording may be unenforceable for consumers in some jurisdictions (EU unfair-terms rules; US auto-renewal laws): **legal review still recommended** |

## H. Found while building (owner items, none blocking the PR)

| # | Finding | Owner action |
|---|---|---|
| H1 | Stripe Tax on the account is **not activated** (test mode: status `pending`, no head office, zero registrations). A Checkout with `automatic_tax` is refused until it is. The Worker ships `STRIPE_TAX = "off"` (required var, on/off, no default) and sends no tax parameters while off | activate Stripe Tax (head office, default tax behaviour exclusive, registrations), then flip `STRIPE_TAX` to `on` (DEPLOY.md) |
| H2 | Seat floors use the **object** relay path (`pricing-model.json` `seat_floor_relay_path`): Team $4 / Business $7 per seat-month, both under list. On the TURN path they would be $7 / $13, above list | confirm the object path for floors (relay through the tenant object is what every tenant gets; TURN is optional) |
| H3 | Customer Terms §12 still promises 30 days' notice of material changes; the new §2 clause says the opposite for grace periods, thresholds and terms | counsel settles the precedence (legal review, G7) |
| H4 | The weekly rates PR is opened with `GITHUB_TOKEN`, which does not trigger the validate workflow on that PR | add a fine-grained PAT or GitHub App token secret for `rates.yml` if the PR must run CI before review |
| H5 | `tax.product_tax_code` is still null: no product tax code is written; Stripe's account preset applies | decision 9 |
| H6 | Stripe's customer portal configuration for Citadel listed no plan-change products before this branch; the catalogue script now keeps it in step (test mode applied: the four licensed products with their current prices, quantity limits preserved) | none; live mode happens at deploy through the same script |
| H7 | The policy's `terminated_service` sentences render into the legal terms and the UI; they were written for engineers ("the object") | reword in `policy.json` if wanted; the render gate re-checks |
