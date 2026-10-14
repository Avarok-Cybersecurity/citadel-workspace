-- Avarok support's signed telemetry reads (control/support.mjs, plan section 3).
--
-- Each signed request carries a random nonce and expires at most five minutes after it was made.
-- A nonce is claimed here once its request has verified; a second request with it is a replay and
-- is refused. A row is useless once its request has expired (the expiry check refuses it anyway),
-- so verified requests delete expired rows before claiming theirs.
CREATE TABLE support_nonces (
  nonce         TEXT NOT NULL PRIMARY KEY CHECK (length(nonce) = 32),
  expires_at_ms INTEGER NOT NULL
);
CREATE INDEX support_nonces_expiry ON support_nonces (expires_at_ms);

-- Which tenants' admins have granted support access, and until when: a mirror the tenant's object
-- writes whenever its kernel records a change (control/support-grants.mjs), so the control plane
-- can list them without waking every object. The kernel's own record is the authority that every
-- support read is checked against; a row here only lists a tenant.
CREATE TABLE support_grants (
  tenant_id  TEXT NOT NULL PRIMARY KEY,
  until_ms   INTEGER NOT NULL,
  changed_at INTEGER NOT NULL
);
