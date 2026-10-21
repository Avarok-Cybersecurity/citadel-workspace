-- Coupons at checkout (docs/plans/citadel-apps-and-coupons-design.md Part 1, and -r2.md R1/R2).
--
-- Every coupon is an instance of a shape billing/tiers.json `coupons` defines: a template
-- (discount or trial) or a comp grant. Static codes live in that file; dynamic codes are issued
-- here by the signed admin tool (control/coupon-admin.mjs). Codes are stored and compared by
-- SHA-256 only. Times on these tables are Unix milliseconds; the tenants columns are seconds,
-- like the rest of that table.
CREATE TABLE coupons (
  code_hash       TEXT NOT NULL PRIMARY KEY CHECK (length(code_hash) = 64),
  template        TEXT,
  grant_id        TEXT,
  -- JSON lists of tier ids and intervals.
  available_on    TEXT NOT NULL,
  intervals       TEXT NOT NULL,
  max_redemptions INTEGER NOT NULL CHECK (max_redemptions >= 1),
  redeem_by_ms    INTEGER,
  revoked_at_ms   INTEGER,
  issued_at_ms    INTEGER NOT NULL,
  issued_nonce    TEXT NOT NULL,
  note            TEXT NOT NULL,
  CHECK ((template IS NULL) <> (grant_id IS NULL))
);

-- One row per tenant that reserved a coupon. `pending` while its Checkout is open (or its comp
-- tenant is being provisioned), `redeemed` once paid or activated. `max_redemptions` is the
-- coupon's cap as it stood at reservation, so the trigger below can refuse a reservation past
-- it inside the same D1 batch that reserves the slug: two creations racing for the last
-- redemption cannot both win.
CREATE TABLE coupon_redemptions (
  coupon_hash     TEXT NOT NULL,
  tenant_id       TEXT NOT NULL,
  slug            TEXT NOT NULL,
  state           TEXT NOT NULL CHECK (state IN ('pending', 'redeemed')),
  reserved_at     INTEGER NOT NULL,
  max_redemptions INTEGER NOT NULL CHECK (max_redemptions >= 1),
  PRIMARY KEY (coupon_hash, tenant_id)
);
CREATE UNIQUE INDEX coupon_redemptions_slug ON coupon_redemptions (coupon_hash, slug);
CREATE INDEX coupon_redemptions_tenant ON coupon_redemptions (tenant_id);

-- What holds a coupon: every redeemed row, and every pending row whose tenant still holds its
-- reservation (a pending tenant past its expiry holds nothing, so its redemption does not count).
CREATE TRIGGER coupon_redemptions_within_cap BEFORE INSERT ON coupon_redemptions
WHEN (
  SELECT COUNT(*) FROM coupon_redemptions r
  WHERE r.coupon_hash = NEW.coupon_hash
    AND (r.state = 'redeemed' OR EXISTS (
      SELECT 1 FROM tenants t WHERE t.tenant_id = r.tenant_id
        AND NOT (t.status = 'pending' AND t.expires_at IS NOT NULL AND t.expires_at <= NEW.reserved_at)))
) >= NEW.max_redemptions
BEGIN
  SELECT RAISE(ABORT, 'coupon-exhausted');
END;

-- Coupon previews per hashed client address per hour (the guessing surface's rate limit). Rows
-- for past hours are deleted by the batch that counts the current one; nothing is kept longer.
CREATE TABLE coupon_attempts (
  ip_hash TEXT NOT NULL,
  hour    INTEGER NOT NULL,
  count   INTEGER NOT NULL CHECK (count >= 1),
  PRIMARY KEY (ip_hash, hour)
);

-- The billing audit of coupons: issue, revoke, reserve, redeem, release, and spend alarms.
-- `once_key` makes a row once-only where that matters (an alarm is written once per tenant, metric
-- and period).
CREATE TABLE coupon_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  at_ms       INTEGER NOT NULL,
  action      TEXT NOT NULL CHECK (action IN ('issue', 'revoke', 'reserve', 'redeem', 'release', 'alarm')),
  coupon_hash TEXT NOT NULL,
  tenant_id   TEXT,
  nonce       TEXT,
  detail      TEXT NOT NULL,
  once_key    TEXT UNIQUE
);
CREATE INDEX coupon_events_by_coupon ON coupon_events (coupon_hash, at_ms);

-- The tenant's coupon: its hash (NULL for none), the comp grant it activated with (NULL unless
-- comp) and whether that grant was unlimited when redeemed, and the subscription's Stripe status
-- and trial end (seconds), which the trial clamp reads (control/plans.mjs). Rows that predate
-- coupons hold none of them; every insert names them.
ALTER TABLE tenants ADD COLUMN coupon_hash TEXT;
ALTER TABLE tenants ADD COLUMN grant_id TEXT;
ALTER TABLE tenants ADD COLUMN grant_unlimited INTEGER NOT NULL DEFAULT 0 CHECK (grant_unlimited IN (0, 1));
ALTER TABLE tenants ADD COLUMN trial_end INTEGER;
ALTER TABLE tenants ADD COLUMN stripe_status TEXT;
