/**
 * A Documents response as the debug log may show it. Its byte fields (updates, snapshots,
 * awareness records) ARE the document and its readers' cursors, and formatForDebug prints a
 * short array's values whole, so every byte array becomes its length; seqs, node ids and cids
 * stay, because they are what a sync bug is debugged by.
 */
import type { DocumentsResponse } from 'citadel-workspace-client-ts';

export function redactDocumentsForDebug(answer: DocumentsResponse): unknown {
  return redact(answer);
}

function redact(value: unknown): unknown {
  if (Array.isArray(value)) {
    if (value.every((item: unknown): boolean => typeof item === 'number')) return `<${value.length} bytes>`;
    return value.map(redact);
  }
  if (typeof value !== 'object' || value === null) return typeof value === 'bigint' ? value.toString() : value;
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(value)) out[key] = redact(field);
  return out;
}
