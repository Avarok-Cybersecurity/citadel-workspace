-- The tenant registry of the control plane. One row per workspace host `<slug>.work.avarok.net`.
--
-- A row is written `pending` before anything else happens, so the slug is reserved while the
-- tenant's object is provisioned and (for a paid tier) while its Checkout is open. A pending row
-- older than its `expires_at` no longer holds the slug.
CREATE TABLE tenants (
  slug                TEXT PRIMARY KEY,
  -- Random per creation: a slug freed by an expired pending row is a different tenant, and the
  -- Stripe metadata names both, so a late event for the old one cannot touch the new one.
  tenant_id           TEXT NOT NULL UNIQUE,
  display_name        TEXT NOT NULL,
  status              TEXT NOT NULL CHECK (status IN ('pending', 'active', 'suspended')),
  tier                TEXT NOT NULL,
  interval            TEXT CHECK (interval IN ('month', 'year')),
  seats               INTEGER NOT NULL CHECK (seats >= 0),
  storage_blocks      INTEGER NOT NULL CHECK (storage_blocks >= 0),
  stripe_customer     TEXT,
  stripe_subscription TEXT,
  created_at          INTEGER NOT NULL,
  expires_at          INTEGER,
  -- SHA-256 of the claim code (the tenant's master password), for owner authentication.
  claim_hash          TEXT NOT NULL,
  -- A paid tenant's claim code, AES-GCM sealed under a key derived from the Checkout Session id,
  -- until the creator collects it once; then NULL. A free tenant's code is never stored here.
  claim_sealed        TEXT,
  -- SHA-256 of the Checkout Session id that created the tenant.
  checkout_hash       TEXT,
  -- `created` of the newest subscription event applied: Stripe does not order deliveries.
  sub_event_created   INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX tenants_by_subscription ON tenants (stripe_subscription);

-- Stripe events already applied. Written in the same D1 batch as the change the event made, so an
-- event whose change failed is not recorded and Stripe's retry applies it.
CREATE TABLE stripe_events (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL,
  received_at INTEGER NOT NULL
);
