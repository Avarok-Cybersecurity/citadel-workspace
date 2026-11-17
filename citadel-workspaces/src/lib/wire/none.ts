/**
 * A Rust `None` crosses the WASM boundary as `undefined` (serde-wasm-bindgen),
 * while the JSON wire and the generated types spell it `null`. Test absence
 * with this, never with `=== null` alone.
 */
export const isNone = (value: unknown): value is null | undefined => value === null || value === undefined;
