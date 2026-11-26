/**
 * What a RE-VFS push's sender-side tick says, and where the push stands. Pure.
 *
 * The sender's ticks for one push, in order:
 *   - `TransferBeginning` once the receiver accepted the file header, before any group is sent;
 *   - `TransferTick [group, total, Mb/s]` each time a whole group has been acknowledged;
 *   - `TransferComplete`, or a failure (`Fail` / `Failed`).
 *
 * Between the first two the SDK may hold the push's first group behind an earlier transfer of
 * the same session: every header and payload of a session shares one primary stream, and a
 * header queued behind another group's payload is not the receiver's to answer until that
 * payload has drained (citadel_types::proto::timing::FILE_GROUP_HEADER_ACK_DEADLINE). The SDK
 * bounds that wait and ends a stalled transfer with `Failed`, so the page shows the wait for
 * what it is rather than a frozen 0 %, and does not time it.
 */
import { transferFailureReason } from '@/lib/file-transfer/transfer-failure';
import { percentage } from '@/lib/file-transfer/tick-events';

/** Where a push stands, as the person uploading sees it. */
export type PushPhase =
  | { readonly kind: 'sending' }
  | { readonly kind: 'waiting-for-earlier' }
  | { readonly kind: 'progress'; readonly percentage: number };

/** What one sender-side tick status means for the push it belongs to. */
export type PushTickReading =
  | { readonly kind: 'complete' }
  | { readonly kind: 'failed'; readonly reason: string }
  | { readonly kind: 'begun' }
  | { readonly kind: 'tick'; readonly percentage: number }
  | { readonly kind: 'other' };

function isTransferTick(status: unknown): status is { TransferTick: readonly (number | bigint)[] } {
  return typeof status === 'object' && status !== null && 'TransferTick' in status && Array.isArray((status as { TransferTick: unknown }).TransferTick);
}

/**
 * Read one tick status. Only a failure status reads as `failed`, and only `TransferTick` as
 * progress: anything else (a status this page does not know) is `other`, which neither ends the
 * push nor counts as a sign of life.
 */
export function readPushTick(status: unknown): PushTickReading {
  if (status === 'TransferComplete') return { kind: 'complete' };
  if (status === 'TransferBeginning') return { kind: 'begun' };
  const reason: string | null = transferFailureReason(status as Record<string, unknown> | string | null | undefined);
  if (reason !== null) return { kind: 'failed', reason };
  if (isTransferTick(status)) {
    // The agent's counts are u64, which reach the page as BigInt whatever the binding says.
    return { kind: 'tick', percentage: percentage(Number(status.TransferTick[0]), Number(status.TransferTick[1])) };
  }
  return { kind: 'other' };
}

/**
 * The pushes of each session whose groups are in flight: begun (the receiver accepted) and not
 * yet settled. A push that begins while another of its session is here is queued behind it.
 */
export class SessionPushes {
  private readonly inFlight: Map<bigint, Set<string>> = new Map();

  /** Record that `requestId` began; true when an earlier push of `cid` is still in flight. */
  begin(cid: bigint, requestId: string): boolean {
    const pushes: Set<string> = this.inFlight.get(cid) ?? new Set();
    const behindAnother: boolean = [...pushes].some((other: string) => other !== requestId);
    pushes.add(requestId);
    this.inFlight.set(cid, pushes);
    return behindAnother;
  }

  /** Record that `requestId` settled, however it settled. */
  end(cid: bigint, requestId: string): void {
    const pushes: Set<string> | undefined = this.inFlight.get(cid);
    if (pushes === undefined) return;
    pushes.delete(requestId);
    if (pushes.size === 0) this.inFlight.delete(cid);
  }
}

/** The words for a push of `fileName` at `phase`. */
export function pushPhaseLabel(fileName: string, phase: PushPhase): string {
  switch (phase.kind) {
    case 'sending':
      return `Uploading ${fileName}…`;
    case 'waiting-for-earlier':
      return `${fileName}: waiting for the earlier transfer to finish…`;
    case 'progress':
      return `Uploading ${fileName}… ${phase.percentage}%`;
  }
}
