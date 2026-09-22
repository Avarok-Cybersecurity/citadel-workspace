-- Quota metering (docs/plans/tenant-quotas.md steps 9 and 10).
--
-- A paid tenant's current Stripe billing period, from its subscription events (webhook.mjs
-- `periodOf`), in seconds. NULL for Free and until the first subscription event names one: the
-- tenant's object then meters by calendar month (UTC).
ALTER TABLE tenants ADD COLUMN period_start INTEGER;
ALTER TABLE tenants ADD COLUMN period_end INTEGER;

-- What each tenant's object measured, per billing period, as the monitor (monitor.mjs, the Cron
-- `scheduled()` handler) last sampled it. Absolute totals, so a repeated run overwrites and never
-- adds. `overage_gb_reported` is how many whole GB beyond the included relay have been reported
-- to Stripe's meter for this period. A report is an outbox: `overage_gb_pending` is written
-- first, the meter event (identified by both numbers) is sent, and only once Stripe accepted it
-- does `overage_gb_reported` become the pending value (and pending NULL). A run that dies between
-- the two re-sends the identical event, which Stripe deduplicates by its identifier.
CREATE TABLE tenant_usage (
  tenant_id           TEXT NOT NULL,
  period_start        INTEGER NOT NULL,
  period_end          INTEGER NOT NULL,
  bytes_in            INTEGER NOT NULL,
  bytes_out           INTEGER NOT NULL,
  frames_in           INTEGER NOT NULL,
  active_seconds      INTEGER NOT NULL,
  peak_connections    INTEGER NOT NULL,
  relay_gb_included   INTEGER NOT NULL,
  overage_gb          INTEGER NOT NULL,
  overage_gb_reported INTEGER NOT NULL DEFAULT 0 CHECK (overage_gb_reported >= 0),
  overage_gb_pending  INTEGER CHECK (overage_gb_pending > overage_gb_reported),
  sampled_at          INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, period_start)
);
