/**
 * Local updates on their way to the peer: gathered for `coalesceMs`, then sent in order as
 * `update` messages that each fit the wire bound. An update too large for any one message is
 * never sent as one: `oversized` is told, and the sync asks the peer to request it instead,
 * which the peer's hello answers with a chunked diff. Nothing waits for an acknowledgement: a
 * message lost on the way is in the next diff, because the CRDT's state vector says it is missing.
 */
import type { Clock } from '../collab/ports';
import { ENVELOPE_HEADROOM_BYTES, PER_UPDATE_OVERHEAD_BYTES } from './chat-config';

export interface OutboxSink {
  /** One message's worth of updates, in the order they were made. */
  send(updates: readonly Uint8Array[]): void;
  /** An update larger than one message can carry. */
  oversized(update: Uint8Array): void;
}

/** Splits `updates`, in order, into runs that each fit one message of `maxMessageBytes`. */
export function batchUpdates(updates: readonly Uint8Array[], maxMessageBytes: number): { readonly batches: Uint8Array[][]; readonly oversized: Uint8Array[] } {
  const room: number = maxMessageBytes - ENVELOPE_HEADROOM_BYTES;
  const batches: Uint8Array[][] = [];
  const oversized: Uint8Array[] = [];
  let current: Uint8Array[] = [];
  let used: number = 0;
  for (const update of updates) {
    const cost: number = update.byteLength + PER_UPDATE_OVERHEAD_BYTES;
    if (cost > room) {
      oversized.push(update);
      continue;
    }
    if (used + cost > room) {
      batches.push(current);
      current = [];
      used = 0;
    }
    current.push(update);
    used += cost;
  }
  if (current.length > 0) batches.push(current);
  return { batches, oversized };
}

export class ChatOutbox {
  private held: Uint8Array[] = [];
  private cancel: (() => void) | null = null;

  constructor(
    private readonly clock: Clock,
    private readonly coalesceMs: number,
    private readonly maxMessageBytes: number,
    private readonly sink: OutboxSink,
  ) {}

  add(update: Uint8Array): void {
    this.held.push(update);
    if (this.cancel === null) this.cancel = this.clock.after(this.coalesceMs, (): void => this.flush());
  }

  /** Sends what is held now. */
  flush(): void {
    if (this.cancel !== null) this.cancel();
    this.cancel = null;
    const { batches, oversized } = batchUpdates(this.held.splice(0), this.maxMessageBytes);
    for (const batch of batches) this.sink.send(batch);
    for (const update of oversized) this.sink.oversized(update);
  }
}
