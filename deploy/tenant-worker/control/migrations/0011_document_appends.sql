-- Document appends metered per billing period, and their overage outbox
-- (control/overage-report.mjs), beside relay's (migration 0003). `appends` is the period's total
-- as the tenant's object counted it (control/tenant-documents.mjs); `appends_included` what the
-- plan included (entitlements document_appends_included); `appends_overage` the whole thousands
-- beyond it. The outbox works as relay's does: `appends_overage_pending` is written first, the
-- meter event (identified by both numbers) is sent, and only once Stripe accepted it does
-- `appends_overage_reported` become the pending value. Defaults are for rows sampled before
-- appends were counted: none were.
ALTER TABLE tenant_usage ADD COLUMN appends INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tenant_usage ADD COLUMN appends_included INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tenant_usage ADD COLUMN appends_overage INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tenant_usage ADD COLUMN appends_overage_reported INTEGER NOT NULL DEFAULT 0 CHECK (appends_overage_reported >= 0);
ALTER TABLE tenant_usage ADD COLUMN appends_overage_pending INTEGER CHECK (appends_overage_pending > appends_overage_reported);

-- The usage-only subscription this tenant last had cancelled (overage billing switched off, or a
-- downgrade). Its replacement is created under an idempotency key naming it, so switching overage
-- billing off and on again within Stripe's 24-hour idempotency window creates a new subscription
-- instead of being answered with the cancelled one.
ALTER TABLE tenants ADD COLUMN usage_subscription_ended TEXT;
