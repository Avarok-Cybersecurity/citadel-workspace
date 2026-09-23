-- The usage-only Stripe subscription a yearly paid tenant holds so its relay overage is billed
-- (control/usage-subscription.mjs). NULL for monthly plans, whose own subscription carries the
-- metered price, and for Free. Written by the webhook in the same batch as the event.
ALTER TABLE tenants ADD COLUMN usage_subscription TEXT;
