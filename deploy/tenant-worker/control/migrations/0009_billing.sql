-- Automatic billing (docs/plans/billing-automation.md): the overage-billing choice, dunning,
-- purges, alerts and overage-off terminations. Every time limit and threshold these tables
-- record comes from billing/policy.json.

-- Whether the workspace's owner enabled overage billing (billing/policy.json overage_billing):
-- 1 = overage is metered and invoiced; 0 = never billed, the service is terminated instead. The
-- default is for rows that predate the choice, which bought no overage; every paid creation
-- names it explicitly.
ALTER TABLE tenants ADD COLUMN overage_billing INTEGER NOT NULL DEFAULT 0 CHECK (overage_billing IN (0, 1));

-- A tenant whose payment failed (control/dunning.mjs). One row while it is in payment_required;
-- deleted when it pays or is purged. `reminders_sent` is a JSON array of the reminder days
-- (policy dunning.reminder_days) already sent. The hosted invoice URL is the pay link the emails
-- carry; the email is the Stripe customer's, read from the invoice event, kept only here and
-- only for as long as this row exists.
CREATE TABLE tenant_dunning (
  tenant_id             TEXT PRIMARY KEY,
  slug                  TEXT NOT NULL,
  since                 INTEGER NOT NULL,
  purge_at              INTEGER NOT NULL,
  invoice_id            TEXT,
  hosted_invoice_url    TEXT,
  customer_email        TEXT,
  reminders_sent        TEXT NOT NULL,
  final_warning_sent_at INTEGER,
  updated_at            INTEGER NOT NULL
);

-- The audit of each purge (control/purge.mjs): one row per tenant purged, written when the purge
-- starts and updated after each step, so a run that dies resumes from `steps` (a JSON array of
-- the steps completed) rather than from the beginning. The tenants row is deleted as the last
-- step, which releases the slug; this row remains.
CREATE TABLE tenant_purges (
  tenant_id   TEXT PRIMARY KEY,
  slug        TEXT NOT NULL,
  started_at  INTEGER NOT NULL,
  steps       TEXT NOT NULL,
  finished_at INTEGER
);

-- Alerts already sent (control/alerts.mjs), so each threshold is announced once per period per
-- dimension. `threshold` names it: "percent:80", "overage:3" (the third overage step),
-- "countdown:24" (hours before termination), "terminated".
CREATE TABLE tenant_alerts (
  tenant_id    TEXT NOT NULL,
  period_start INTEGER NOT NULL,
  dimension    TEXT NOT NULL,
  threshold    TEXT NOT NULL,
  sent_at      INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, period_start, dimension, threshold)
);
