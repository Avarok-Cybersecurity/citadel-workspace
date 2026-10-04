# Auth-record census (before Argon2 is deleted)

Each Cron run (`control/monitor.mjs`) asks every active tenant's object, by RPC only (there is no
HTTP route), to count its stored accounts by auth-record version -- 0 legacy Argon2, 1 transient,
2 post-quantum -- and keeps the latest counts per tenant in D1 `tenant_auth_versions`
(migration 0005). It logs counts only, never a username or CID, and warns
(`legacy Argon2 account(s) remain`) while any tenant has a legacy one. The count reads each
record's version tag with the SDK's own types, so it is the same before and after the sunset.
`transient` includes the server's own (CID 0) row, one per started tenant. `undecodable` is a row
the census could not read as far as its version: it also warns, and blocks the all-clear.

Read it (read-only; the owner's own `wrangler` login):

```bash
# Totals, and how many tenants were sampled in the last hour:
wrangler d1 execute citadel-control --remote --command "SELECT SUM(legacy_argon) AS legacy_argon, SUM(transient) AS transient, SUM(post_quantum) AS post_quantum, SUM(undecodable) AS undecodable, COUNT(*) AS tenants, SUM(sampled_at > strftime('%s','now') - 3600) AS fresh FROM tenant_auth_versions"
# Which tenants still hold a legacy (or unreadable) account:
wrangler d1 execute citadel-control --remote --command "SELECT t.slug, a.legacy_argon, a.undecodable FROM tenant_auth_versions a JOIN tenants t USING (tenant_id) WHERE a.legacy_argon > 0 OR a.undecodable > 0"
# Active tenants not yet (or no longer) sampled: the all-clear needs this to be empty.
wrangler d1 execute citadel-control --remote --command "SELECT t.slug FROM tenants t LEFT JOIN tenant_auth_versions a USING (tenant_id) WHERE t.status = 'active' AND (a.tenant_id IS NULL OR a.sampled_at < strftime('%s','now') - 3600)"
```

Argon2 is safe to delete when, after a release that has run for longer than a login cycle matters
to you, the first query shows `legacy_argon = 0` and `undecodable = 0` with `fresh` equal to
`tenants`, and the third returns no rows. Suspended and pending tenants are not sampled.

