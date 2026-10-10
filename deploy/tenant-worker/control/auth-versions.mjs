/**
 * The census of a tenant's accounts by auth-record version. Two halves, kept apart (SBIO): the
 * object's read-only SELECT here, and the counting in the wasm (`server-wasm/src/auth_versions.rs`,
 * which reads each record's version with the SDK's own types). `AuthVersionStore` keeps the latest
 * counts per tenant in D1 (`tenant_auth_versions`, migration 0005).
 */
export const AUTH_VERSION_KEYS = ["legacy_argon", "transient", "post_quantum", "undecodable"];

/**
 * `{legacy_argon, transient, post_quantum, undecodable}` over the accounts in `sql`. Selects only;
 * a tenant whose node never started has no table yet, and no accounts.
 */
export function authVersions(sql, wasm) {
  const present = [...sql.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'citadel_cnacs'")].length > 0;
  const blobs = present ? [...sql.exec("SELECT bin FROM citadel_cnacs").raw()].map((row) => row[0]) : [];
  return { ...wasm.count_auth_versions(blobs) };
}

export class AuthVersionStore {
  constructor(db) {
    this.db = db;
  }

  /** The tenant's latest counts, replacing the previous sample. */
  async record(tenantId, counts, now) {
    await this.db
      .prepare(
        `INSERT INTO tenant_auth_versions (tenant_id, ${AUTH_VERSION_KEYS.join(", ")}, sampled_at) VALUES (?, ?, ?, ?, ?, ?) ` +
          `ON CONFLICT (tenant_id) DO UPDATE SET ${AUTH_VERSION_KEYS.map((k) => `${k} = excluded.${k}`).join(", ")}, sampled_at = excluded.sampled_at`,
      )
      .bind(tenantId, ...AUTH_VERSION_KEYS.map((k) => counts[k]), now)
      .run();
  }
}
