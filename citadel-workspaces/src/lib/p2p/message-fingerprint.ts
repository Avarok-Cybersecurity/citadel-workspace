/**
 * Content fingerprint for tracing one message across the stack.
 *
 * Byte-identical to `messenger/mod.rs::deliver`, which is the point: the Rust
 * side logs `[ILM-DELIVER] fp=...` and every JavaScript hop logs the same
 * value, so a message can be joined from ILM delivery through the multi-tab
 * router to the P2P handler. A message that stops appearing partway along that
 * chain names the hop that dropped it.
 *
 * Extracted here rather than duplicated: a second implementation that drifted
 * by one byte would silently break every join that depends on it.
 */
export function fnv1a64(bytes: Uint8Array): string {
  const M: bigint = 0xffffffffffffffffn;
  let fp: bigint = 0xcbf29ce484222325n;
  for (const b of bytes) fp = ((fp ^ BigInt(b)) * 0x100000001b3n) & M;
  return fp.toString(16).padStart(16, '0');
}

/**
 * Best-effort description of a routed message for diagnostics.
 *
 * Returns the variant name and, when the payload carries message bytes, its
 * fingerprint. Never throws: a diagnostic that can break the path it observes
 * is worse than no diagnostic.
 */
export function describeForwarded(payload: unknown): string {
  try {
    if (!payload || typeof payload !== 'object') return 'type=<non-object>';
    const record: Record<string, unknown> = payload as Record<string, unknown>;
    const variant: string = Object.keys(record)[0] ?? '<empty>';
    const body: Record<string, unknown> | undefined = record[variant] as Record<string, unknown> | undefined;
    const raw: unknown = body?.message;
    if (Array.isArray(raw)) return `type=${variant} fp=${fnv1a64(new Uint8Array(raw))}`;
    if (raw instanceof Uint8Array) return `type=${variant} fp=${fnv1a64(raw)}`;
    return `type=${variant}`;
  } catch {
    return 'type=<undescribable>';
  }
}
