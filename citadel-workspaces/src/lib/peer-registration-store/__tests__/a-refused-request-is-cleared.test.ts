/**
 * A registration request the peer refused stayed "pending" forever.
 *
 * The store clears an outgoing request when it hears `PeerRegisterFailure`, and
 * it keys that cleanup on `peer_cid`:
 *
 *   const peer_cid = v.peer_cid as bigint | undefined;
 *   if (peer_cid !== undefined) { removeOutgoingRequestByPeer(peer_cid) }
 *
 * `PeerRegisterFailure` has no `peer_cid`. The generated binding is
 * `{ cid, message, request_id }` -- the field is read, is always `undefined`,
 * and the branch has never run. The comment in `usePeerDiscovery` beside the
 * only other handler says so in as many words: "the failure carries no
 * peer_cid", which is why THAT one correlates by request_id.
 *
 * So declining left the requester with a request that never resolves. The
 * outgoing list keeps showing it, and `hasOutgoingRequestTo` keeps answering
 * true, which is what the UI uses to decide the request is still in flight --
 * so the user cannot ask again either.
 *
 * `OutgoingPeerRequest.id` is documented as "matches request_id sent to server"
 * and `sendPeerRegistration` sets it from the very id it sends, so the
 * correlation this needs was already there.
 */
import { describe, it, expect, beforeEach } from 'vitest';

const removedByPeer: bigint[] = [];
const removedById: string[] = [];

// The store's own module graph is cyclic -- event-handlers is reached THROUGH
// service.ts, and importing it first leaves setupEventListeners undefined at
// the moment service.ts's constructor calls it. Importing the package entry
// first fixes the order to the one production uses.
import '../index';
import { setupEventListeners } from '../event-handlers';
import { eventEmitter } from '../../event-emitter';

/**
 * Driven through the real subscription rather than by exporting the handler:
 * the wiring from `websocket-message` to this branch is part of what broke, and
 * a test that calls the function directly cannot see it.
 */
function deliver(message: Record<string, unknown>): void {
  eventEmitter.emit('websocket-message', message);
}

function callbacks(): Record<string, unknown> {
  return {
    refreshNotificationsForCurrentSession: async (): Promise<void> => {},
    startPollLoop: (): void => {},
    stopPollLoop: (): void => {},
    removeOutgoingRequestByPeer: async (cid: bigint): Promise<void> => { removedByPeer.push(cid); },
    removeOutgoingRequest: async (id: string): Promise<{ peerUsername: string } | null> => {
      removedById.push(id);
      // The real store returns the record it removed; the username in it is the
      // only place the peer's name still exists once the request is gone.
      return { peerUsername: 'bob' };
    },
    removeRequestByPeerCid: async (): Promise<void> => {},
    isInitialized: (): boolean => true,
    getPendingKVRequests: (): Map<string, unknown> => new Map<string, unknown>(),
  };
}

// Registered once: setupEventListeners subscribes on the shared bus, and
// calling it per test would stack duplicate handlers.
setupEventListeners(callbacks() as never);

describe('a registration request the peer refused', () => {
  beforeEach((): void => { removedByPeer.length = 0; removedById.length = 0; });

  it('is cleared from the outgoing list', async () => {
    deliver({ PeerRegisterFailure: { cid: 1n, message: 'peer declined', request_id: 'req-7' } });
    await Promise.resolve();

    expect(removedById).toEqual(['req-7']);
  });

  it('says so, rather than letting the request vanish without a word', async () => {
    const heard: unknown[] = [];
    const onFailed = (payload: unknown): void => { heard.push(payload); };
    eventEmitter.on('peer-registration:refused', onFailed);

    deliver({ PeerRegisterFailure: { cid: 1n, message: 'peer declined', request_id: 'req-7' } });
    await Promise.resolve();
    eventEmitter.off('peer-registration:refused', onFailed);

    // Matched across the array, not by index: importing the package entry
    // constructs the store singleton, which subscribes its own copy of these
    // handlers, so the bus carries one notice per registration in this process
    // -- and the singleton's copy resolves against the REAL store, which has no
    // such request, so it reports no username. With the emit removed there are
    // no notices at all and this fails.
    expect(heard).toEqual(expect.arrayContaining([
      expect.objectContaining({ requestId: 'req-7', reason: 'peer declined', peerUsername: 'bob' }),
    ]));
  });

  it('does nothing for a failure that names no request', async () => {
    // Negative control. Removing "the outgoing request" without knowing which
    // one would clear somebody else's pending request, which is worse than
    // leaving this one stuck.
    deliver({ PeerRegisterFailure: { cid: 1n, message: 'peer declined', request_id: null } });
    await Promise.resolve();

    expect(removedById).toEqual([]);
  });
});
