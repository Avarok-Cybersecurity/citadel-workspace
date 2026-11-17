/**
 * Every module answers "am I the leader?" from instanceManager at the moment it is asked.
 *
 * The election flips instanceManager and then emits 'instance:leader-changed', then
 * 'leader-changed'. Modules that kept their own copy, set from one of those events, answered
 * with the previous leadership to every listener that ran before theirs. That is how a
 * promoted tab refused its own queued request "Not leader" (the outbound queue's replay
 * listener runs before the outbound handler's). The same copy lived in the inbound router
 * (its listener follows the queue's and the handler's), the broadcast channel service and the
 * connection state (both copied from the second event, so stale through all of the first).
 *
 * The probe below is registered before those singletons exist, as the queue's listener is in
 * the app, and asks each of them while the election's event is being delivered.
 *
 * Real: the event bus, instanceManager, the router, the broadcast service, the connection
 * manager. Stood in: IndexedDB (jsdom lacks it) as storage-utils over a Map.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { eventEmitter } from '@/lib/event-emitter';
import { instanceManager } from '@/lib/multi-instance/instance-manager';

vi.mock('@/lib/storage-utils', async (importOriginal: () => Promise<Record<string, unknown>>) => ({
  ...(await importOriginal()),
  ...(await import('@/lib/cdoc/collab/__tests__/doubles/memory-storage')).memoryStorageUtils(new Map<string, unknown>()),
}));

interface Answers { router: boolean; broadcast: boolean; connection: boolean }
const answersDuringTheEvent: Answers[] = [];
let ask: (() => Answers) | null = null;

beforeAll(async (): Promise<void> => {
  eventEmitter.on('instance:leader-changed', (): void => { if (ask) answersDuringTheEvent.push(ask()); });

  const { instanceInboundRouter } = await import('@/lib/multi-instance/instance-inbound-router');
  const { broadcastChannelService } = await import('@/lib/broadcast-channel-service');
  const { connectionManager } = await import('@/lib/connection/service');
  // The connection manager exposes no leadership query; its state is what its paths read.
  const connectionState: { isLeader: boolean } = (connectionManager as unknown as { state: { isLeader: boolean } }).state;
  ask = (): Answers => ({
    router: instanceInboundRouter.isRouterActive(),
    broadcast: broadcastChannelService.getIsLeader(),
    connection: connectionState.isLeader,
  });
});

/** What the election does: set the manager, then tell everyone (channel-leader-election.ts `lead`). */
function elect(isLeader: boolean): void {
  answersDuringTheEvent.length = 0;
  instanceManager.setLeader(isLeader, isLeader ? instanceManager.instanceId : 'other-tab');
  eventEmitter.emit('instance:leader-changed', { isLeader, leaderId: instanceManager.leaderId });
  eventEmitter.emit('leader-changed', { isLeader, leaderId: instanceManager.leaderId });
}

describe('leadership asked for while the election announces it', () => {
  it('is the new leadership in every module, on promotion', () => {
    elect(true);
    expect(answersDuringTheEvent).toEqual([{ router: true, broadcast: true, connection: true }]);
  });

  it('is the new leadership in every module, on demotion', () => {
    elect(false);
    expect(answersDuringTheEvent).toEqual([{ router: false, broadcast: false, connection: false }]);
  });
});
