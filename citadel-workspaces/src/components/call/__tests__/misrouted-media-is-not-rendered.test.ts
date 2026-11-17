/**
 * A misrouted media frame must not become a rendered participant.
 *
 * One browser holds one WebSocket for every tab and account, and the router's
 * fallback paths can hand session B's media to a tab running as A. Downstream,
 * ReceiverPool.accept is get-or-create: any frame that reaches the session
 * builds a decoder and surfaces a stream. So the hook is the gate — a frame
 * must be addressed to this tab's session AND come from a peer the service
 * confirmed a media session with (MediaSessionOpened), or be dropped.
 *
 * The third test is the one that keeps the gate honest: a confirmed
 * participant must still render, or "drop everything" would pass the first two.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useInboundMedia } from '../use-inbound-media';
import { eventEmitter } from '@/lib/event-emitter';
import type { CallSession } from '@/lib/call/call-session';

// The one mock, justified: getCurrentCid's fallback chain reads IndexedDB and
// the instance manager — I/O with no seam in a unit test. The tab under test
// runs as session 7n. Everything else (emitter, hook, gating) is production
// code.
vi.mock('@/lib/p2p/current-cid', () => ({
  getCurrentCid: vi.fn(async (): Promise<bigint> => 7n),
}));

const OUR_CID: bigint = 7n;
const OTHER_SESSION_CID: bigint = 8n;
const MEMBER_PEER: bigint = 42n;
const STRANGER_PEER: bigint = 99n;

interface FakeSession {
  acceptFrame: ReturnType<typeof vi.fn>;
  acceptGap: ReturnType<typeof vi.fn>;
}

function fakeSession(): FakeSession {
  return { acceptFrame: vi.fn(), acceptGap: vi.fn() };
}

function frameFor(cid: bigint, peerCid: bigint): Record<string, unknown> {
  return {
    MediaFrameNotification: {
      cid,
      peer_cid: peerCid,
      track: 0,
      kind: 1,
      sequence: 0,
      timestamp: 0,
      flags: 1,
      payload: [1, 2, 3],
      request_id: null,
    },
  };
}

function gapFor(cid: bigint, peerCid: bigint): Record<string, unknown> {
  return {
    MediaGapNotification: {
      cid,
      peer_cid: peerCid,
      track: 0,
      missing_from: 1,
      missing_to: 2,
      request_id: null,
    },
  };
}

function sessionOpened(cid: bigint, peerCid: bigint): Record<string, unknown> {
  return {
    MediaSessionOpened: {
      cid,
      peer_cid: peerCid,
      unreliable: true,
      max_frame_bytes: 1200,
      request_id: 'req-1',
    },
  };
}

/** Let the hook's async identity lookup settle before any media arrives. */
function identitySettled(): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

async function mountHook(session: FakeSession): Promise<{ unmount: () => void }> {
  const ref: { current: CallSession | null } = { current: session as unknown as CallSession };
  const { unmount } = renderHook(() => useInboundMedia(ref));
  await identitySettled();
  return { unmount };
}

describe('inbound media gating', () => {
  it('renders a confirmed participant: frames and gaps flow after MediaSessionOpened', async () => {
    const session: FakeSession = fakeSession();
    const { unmount } = await mountHook(session);
    try {
      eventEmitter.emit('websocket-message', sessionOpened(OUR_CID, MEMBER_PEER));
      eventEmitter.emit('websocket-message', frameFor(OUR_CID, MEMBER_PEER));
      eventEmitter.emit('websocket-message', gapFor(OUR_CID, MEMBER_PEER));

      expect(session.acceptFrame).toHaveBeenCalledTimes(1);
      expect(session.acceptFrame).toHaveBeenCalledWith(MEMBER_PEER, {
        track: 0,
        kind: 1,
        timestamp: 0,
        flags: 1,
        payload: new Uint8Array([1, 2, 3]),
      });
      expect(session.acceptGap).toHaveBeenCalledTimes(1);
      expect(session.acceptGap).toHaveBeenCalledWith(MEMBER_PEER, 0, false);
    } finally {
      unmount();
    }
  });

  it('drops a frame addressed to another session, even from an admitted peer', async () => {
    const session: FakeSession = fakeSession();
    const { unmount } = await mountHook(session);
    try {
      eventEmitter.emit('websocket-message', sessionOpened(OUR_CID, MEMBER_PEER));
      eventEmitter.emit('websocket-message', frameFor(OTHER_SESSION_CID, MEMBER_PEER));
      eventEmitter.emit('websocket-message', gapFor(OTHER_SESSION_CID, MEMBER_PEER));

      expect(session.acceptFrame).not.toHaveBeenCalled();
      expect(session.acceptGap).not.toHaveBeenCalled();
    } finally {
      unmount();
    }
  });

  it('drops a frame from a peer the call never opened media with', async () => {
    const session: FakeSession = fakeSession();
    const { unmount } = await mountHook(session);
    try {
      eventEmitter.emit('websocket-message', sessionOpened(OUR_CID, MEMBER_PEER));
      eventEmitter.emit('websocket-message', frameFor(OUR_CID, STRANGER_PEER));
      eventEmitter.emit('websocket-message', gapFor(OUR_CID, STRANGER_PEER));

      expect(session.acceptFrame).not.toHaveBeenCalled();
      expect(session.acceptGap).not.toHaveBeenCalled();
    } finally {
      unmount();
    }
  });

  it('another session\'s MediaSessionOpened admits nobody', async () => {
    const session: FakeSession = fakeSession();
    const { unmount } = await mountHook(session);
    try {
      // A misrouted confirmation must not become an admission ticket.
      eventEmitter.emit('websocket-message', sessionOpened(OTHER_SESSION_CID, STRANGER_PEER));
      eventEmitter.emit('websocket-message', frameFor(OUR_CID, STRANGER_PEER));

      expect(session.acceptFrame).not.toHaveBeenCalled();
    } finally {
      unmount();
    }
  });

  it('admissions do not leak from one call into the next', async () => {
    const firstCall: FakeSession = fakeSession();
    const ref: { current: CallSession | null } = { current: firstCall as unknown as CallSession };
    const { unmount } = renderHook(() => useInboundMedia(ref));
    await identitySettled();
    try {
      eventEmitter.emit('websocket-message', sessionOpened(OUR_CID, MEMBER_PEER));
      eventEmitter.emit('websocket-message', frameFor(OUR_CID, MEMBER_PEER));
      expect(firstCall.acceptFrame).toHaveBeenCalledTimes(1);

      // The call ends; a new CallSession means a new call with no members yet.
      const secondCall: FakeSession = fakeSession();
      ref.current = secondCall as unknown as CallSession;
      eventEmitter.emit('websocket-message', frameFor(OUR_CID, MEMBER_PEER));
      expect(secondCall.acceptFrame).not.toHaveBeenCalled();

      // Re-confirmed for the new call, the same peer renders again.
      eventEmitter.emit('websocket-message', sessionOpened(OUR_CID, MEMBER_PEER));
      eventEmitter.emit('websocket-message', frameFor(OUR_CID, MEMBER_PEER));
      expect(secondCall.acceptFrame).toHaveBeenCalledTimes(1);
    } finally {
      unmount();
    }
  });
});
