/**
 * An admin's client moving asks into its Scratchpad, with its real I/O: once when the workspace
 * opens and again on each "Waiting" nudge. Run by TermsGate while a workspace is open, beside
 * console capture. One window at a time per account (a Web Lock), so two windows never write
 * the same note twice: the second takes after the first has acknowledged, and finds nothing.
 */
import type { AdminRequestEntry, AdminRequestsResponse } from 'citadel-workspace-client-ts';
import WorkspaceService from '@/lib/workspace-service';
import { ackAdminRequests, takeAdminRequests } from '@/lib/workspace-service/admin-requests-operations';
import { agentKeepsNotesToSelf } from '@/lib/agent-conversations/capabilities';
import { P2PMessengerManager } from '@/lib/p2p/p2p-messenger-manager';
import { getCurrentCid } from '@/lib/p2p/current-cid';
import { eventEmitter } from '@/lib/event-emitter';
import { formatDateTime } from '@/lib/format-time';
import { errorLog } from '@/lib/debug-config';
import { deliverPending } from './deliver';
import { noteFor } from './words';

const LOCK_PREFIX: string = 'admin-requests:';

async function deliverOnce(): Promise<void> {
  const own: bigint | null = await getCurrentCid();
  if (own === null) return;
  const run = (): Promise<number> => deliverPending({
    keepsNotes: agentKeepsNotesToSelf,
    take: (): Promise<AdminRequestEntry[]> => takeAdminRequests(WorkspaceService),
    writeNote: async (entry: AdminRequestEntry): Promise<void> => {
      await P2PMessengerManager.getInstance().sendMessage(own, noteFor(entry, formatDateTime));
    },
    ack: (ids: string[]): Promise<number> => ackAdminRequests(WorkspaceService, ids),
  });
  const locks: LockManager | undefined = typeof navigator === 'undefined' ? undefined : navigator.locks;
  if (!locks) throw new Error('This browser has no Web Locks API, so asks are left for a window that has one');
  await locks.request(`${LOCK_PREFIX}${own.toString()}`, run);
}

function deliverReporting(): void {
  deliverOnce().catch((error: unknown): void => errorLog('AdminRequests', 'asks could not be moved to the Scratchpad; they stay pending', error));
}

export function bootAdminRequestDelivery(): () => void {
  deliverReporting();
  return eventEmitter.on('workspace:admin-requests', (event: { answer: AdminRequestsResponse } | undefined): void => {
    if (event?.answer === 'Waiting') deliverReporting();
  });
}
