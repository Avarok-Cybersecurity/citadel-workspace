/**
 * Secrets out of anything about to be logged.
 *
 * The leader logs every message off the wire, and a few of them carry what
 * must never reach a console or a captured test log: a RegisterSuccess or a
 * RegenerateRecoveryCodes outcome holds the account's recovery codes, a
 * SecurityKeyAnswer holds a PRF output, a Connect holds a password or a
 * recovery code. Redacting at the one place logging happens covers every call
 * site, including the ones written next year.
 */
const SECRET_FIELDS: ReadonlySet<string> = new Set<string>([
  'recovery_codes', 'RecoveryCodes', 'recovery_code', 'prf_output', 'password', 'proposed_password', 'admission_token',
]);
const MAX_DEPTH: 8 = 8;
export const REDACTED: '<redacted>' = '<redacted>';

function walk(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (value === null || typeof value !== 'object' || depth > MAX_DEPTH) return value;
  if (seen.has(value) || ArrayBuffer.isView(value) || value instanceof Error || value instanceof Date) return value;
  seen.add(value);
  if (Array.isArray(value)) {
    // A byte array is a payload, not a container: a secret is found by its field name,
    // and copying sixteen megabytes element by element to log it would be the cost of the log.
    if (value.length === 0 || typeof value[0] !== 'object') return value;
    return value.map((item: unknown) => walk(item, depth + 1, seen));
  }
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SECRET_FIELDS.has(key) && field !== null && field !== undefined ? REDACTED : walk(field, depth + 1, seen);
  }
  return out;
}

/** A copy with every secret field replaced; the original is not touched. */
export function redactSecrets(value: unknown): unknown {
  return walk(value, 0, new WeakSet<object>());
}
