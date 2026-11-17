/**
 * Hands an inbound REVFS operation to the sync engine, loading it on demand.
 *
 * Extracted from `message-handler-routing` so the deferred-load concern lives
 * in one place, and because inlining it there pushed that file over the
 * 250-line limit.
 */
import { revfsWhenReady, revfsWhenStarted } from '@/lib/revfs/revfs-loader';
import { errorLog } from '@/lib/debug-config';
import type { RevfsOperation } from '@/types/revfs-types';

/** How long an operation that beat the engine's start waits for it. */
export const ENGINE_START_WAIT_MS: number = 30_000;

/**
 * The engine is loaded on demand -- a static import of it from `lib/p2p` put
 * the whole thing on the landing page's critical path. Awaiting the SAME
 * promise `useConnectionHandler` started is what guarantees the service has its
 * transport before it is handed an operation; one that arrives before the start
 * waits for it rather than being dropped (see `revfsWhenStarted`).
 */
type RevfsModule = NonNullable<Awaited<ReturnType<typeof revfsWhenStarted>>>;

function hand(engine: RevfsModule, peerCid: bigint, myCid: bigint, operation: RevfsOperation): void {
  // Caught, not voided: a tree that cannot be read now throws (tree-load.ts),
  // and an unhandled rejection here would be the only trace of it. Printed
  // even in production: this is the one place that knows why a peer's change
  // was never acknowledged, and debugLog is silent there.
  engine.revfsService.handleRevfsOperation(peerCid, myCid, operation).catch((error: unknown): void => {
    errorLog('P2PMessageHandler', `REVFS ${operation.op_type} from ${peerCid} failed`, error);
  });
}

export async function routeRevfsOperation(
  peerCid: bigint,
  myCid: bigint,
  operation: RevfsOperation,
): Promise<void> {
  const ready: ReturnType<typeof revfsWhenReady> = revfsWhenReady();
  if (ready !== null) {
    hand(await ready, peerCid, myCid, operation);
    return;
  }
  // Waited for in the background: the message pipeline is not held for it.
  revfsWhenStarted(ENGINE_START_WAIT_MS).then(
    (engine: RevfsModule | null): void => {
      if (engine === null) {
        errorLog('P2PMessageHandler', `REVFS ${operation.op_type} dropped: the engine was not started within ${ENGINE_START_WAIT_MS}ms`);
        return;
      }
      hand(engine, peerCid, myCid, operation);
    },
    (error: unknown): void => { errorLog('P2PMessageHandler', 'REVFS engine failed to load', error); },
  );
}
