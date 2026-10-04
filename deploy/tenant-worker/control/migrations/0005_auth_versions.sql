-- The release-N+1 census: how many of a tenant's stored accounts are in each auth-record version
-- (control/auth-versions.mjs; the monitor samples it from the tenant's object). Counts only, the
-- latest sample per tenant, overwritten each run: the owner reads the totals to confirm no
-- legacy Argon2 account remains before Argon2 is deleted (DEPLOY.md, "Auth-record census").
-- `undecodable` is a row the census could not read as far as its version.
CREATE TABLE tenant_auth_versions (
  tenant_id    TEXT NOT NULL PRIMARY KEY,
  legacy_argon INTEGER NOT NULL CHECK (legacy_argon >= 0),
  transient    INTEGER NOT NULL CHECK (transient >= 0),
  post_quantum INTEGER NOT NULL CHECK (post_quantum >= 0),
  undecodable  INTEGER NOT NULL CHECK (undecodable >= 0),
  sampled_at   INTEGER NOT NULL
);
