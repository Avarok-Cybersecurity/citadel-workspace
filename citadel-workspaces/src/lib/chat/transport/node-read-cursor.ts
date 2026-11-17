/**
 * Moving the reader's read cursor in a node channel: as far as the newest message held, never
 * more than once per `READ_CURSOR_GAP_MS`, and only when the reader sends receipts.
 *
 * Reading fires on every arrival and every catch-up, and the server keeps a cursor at most once a
 * second, refusing faster writes with an `Error` that a concurrent send would take as its own
 * answer (group-chat-signals). So moves inside the gap are folded into one trailing write of the
 * newest target. A cursor the server already holds is not written again, so opening a channel
 * you have read costs nothing. A refused write is reported and forgotten: the next read retries.
 */
import type { Clock } from '@/lib/cdoc/collab/ports';

export const READ_CURSOR_GAP_MS: number = 2_000;

export interface ReadCursorParams {
  readonly clock: Clock;
  /** The newest stored message this tab holds, or null when it holds none. */
  readonly newest: () => string | null;
  /** Where the server holds the reader's cursor, or null when it holds none. */
  readonly held: () => string | null;
  /** Whether the reader sends read receipts (the privacy setting). */
  readonly sendsReceipts: () => boolean;
  readonly write: (uptoMessageId: string) => Promise<void>;
  readonly report: (error: unknown) => void;
}

export interface ReadCursor {
  /** The reader has seen everything held. */
  read(): void;
}

export function readCursor({ clock, newest, held, sendsReceipts, write, report }: ReadCursorParams): ReadCursor {
  let lastWrite: number = Number.NEGATIVE_INFINITY;
  let written: string | null = null;
  let trailing: (() => void) | null = null;
  let inFlight: boolean = false;

  const flush = (): void => {
    trailing = null;
    const target: string | null = newest();
    if (target === null || target === written || target === held() || !sendsReceipts()) return;
    if (inFlight || clock.now() - lastWrite < READ_CURSOR_GAP_MS) {
      // A slow write is waited out a whole gap at a time, never polled.
      const wait: number = inFlight ? READ_CURSOR_GAP_MS : lastWrite + READ_CURSOR_GAP_MS - clock.now();
      trailing = clock.after(wait, flush);
      return;
    }
    inFlight = true;
    lastWrite = clock.now();
    written = target;
    write(target)
      .catch((error: unknown): void => { written = null; report(error); })
      .finally((): void => { inFlight = false; });
  };

  return {
    read: (): void => { if (trailing === null) flush(); },
  };
}
