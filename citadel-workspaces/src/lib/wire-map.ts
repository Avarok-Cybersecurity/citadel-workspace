import { debugLog } from '@/lib/debug-config';

/**
 * Read a Rust `HashMap` that arrived over the WASM boundary.
 *
 * `serde_wasm_bindgen`'s default serializes a `HashMap` as a JS **Map**, not the
 * `Record<K, V>` the ts-rs bindings declare. So `Object.values(...)` and
 * `Object.keys(...)` on one of these yield `[]` — no error, no warning, just an
 * empty result that reads as "there are none".
 *
 * A normalizer for exactly this was written once, in the P2P registration
 * service, and never propagated: peer discovery, cached-peer sync after
 * reconnect, and the LocalDB key listing all still used `Object.*` and all
 * silently saw nothing.
 *
 * Both shapes are accepted because both genuinely occur — JSON-parsed payloads
 * really are plain objects.
 */
export function wireMapEntries<V>(value: unknown, label: string): Array<[string, V]> {
  if (value instanceof Map) {
    return [...(value as Map<unknown, V>).entries()].map(([k, v]) => [String(k), v]);
  }
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, V>);
  }
  debugLog('WireMap', `${label} is neither a Map nor an object`, value);
  return [];
}

/** The values of such a map, when the keys carry no information the caller needs. */
export function wireMapValues<V>(value: unknown, label: string): V[] {
  return wireMapEntries<V>(value, label).map(([, v]) => v);
}
