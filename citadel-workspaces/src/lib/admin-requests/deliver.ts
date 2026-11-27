/**
 * An admin's pending asks, moved into their Scratchpad: take them, write each as a note to the
 * account's own conversation, then acknowledge the ones written so the server deletes them. A
 * note that fails to write is not acknowledged and is taken again next time; nothing is lost.
 * Asks wait on the server for a device whose agent keeps notes (lib/scratchpad).
 */
import type { AdminRequestEntry } from 'citadel-workspace-client-ts';

export interface DeliverDeps {
  keepsNotes(): Promise<boolean>;
  take(): Promise<AdminRequestEntry[]>;
  writeNote(entry: AdminRequestEntry): Promise<void>;
  ack(ids: string[]): Promise<number>;
}

/** Resolves with how many asks were written; rejects with the first write's failure, after acking. */
export async function deliverPending(deps: DeliverDeps): Promise<number> {
  if (!(await deps.keepsNotes())) return 0;
  const entries: AdminRequestEntry[] = await deps.take();
  const written: string[] = [];
  try {
    for (const entry of entries) {
      await deps.writeNote(entry);
      written.push(entry.id);
    }
  } finally {
    if (written.length > 0) await deps.ack(written);
  }
  return written.length;
}
