import { describe, it, expect, vi, beforeEach     } from 'vitest';
import { eventEmitter } from '../../event-emitter';
import { ORPHAN_BUFFER_TIMEOUT_MS } from '../orphan-buffer';

// Mocks for both module-level singletons must be set up before the router is
// imported. The router subscribes to event-emitter inside its constructor and
// captures the singleton references, so any vi.mock factory has to be in place
// before the first `import` of the SUT module.
const instanceChannelMock: {
  requestCidReport: ReturnType<typeof vi.fn>;
  forwardToInstance: ReturnType<typeof vi.fn>;
  broadcast: ReturnType<typeof vi.fn>;
} = vi.hoisted(() => ({
  requestCidReport: vi.fn(),
  forwardToInstance: vi.fn(),
  broadcast: vi.fn(),
}));

const instanceManagerMock: {
  instanceId: string; isLeader: boolean;
  findInstanceByCid: ReturnType<typeof vi.fn<(cid: bigint) => string | null>>; findInstancesByCid(cid: bigint): string[];
  getAllInstances: ReturnType<typeof vi.fn>;
  registerInstance: ReturnType<typeof vi.fn>;
} = vi.hoisted(() => ({
  instanceId: 'leader-instance', isLeader: true, // the router reads leadership here, not from the event
  findInstanceByCid: vi.fn<(cid: bigint) => string | null>(), findInstancesByCid(cid: bigint): string[] { const one: string | null = this.findInstanceByCid(cid); return one ? [one] : []; },
  getAllInstances: vi.fn(() => [] as Array<{ instanceId: string; cid: bigint | null }>),
  registerInstance: vi.fn(),
}));

vi.mock('../instance-channel', () => ({ instanceChannel: instanceChannelMock }));
vi.mock('../instance-manager', () => ({ instanceManager: instanceManagerMock }));

// Import after mocks are in place.
import { instanceInboundRouter } from '../instance-inbound-router';

describe('InstanceInboundRouter self-heal (CID-routed message for unknown CID)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Router only routes when it's the active leader; flip it on for every
    // test so a previous test's "not leader" state can't bleed through.
    eventEmitter.emit('instance:leader-changed', {
      isLeader: true,
      leaderId: 'leader-instance',
    });
  });

  it('asks every other instance to re-broadcast its CID when the target CID is unowned', () => {
    instanceManagerMock.findInstanceByCid.mockReturnValue(null);

    const cidRoutedMessage: { MessageNotification: { cid: string; peer_cid: string; message: number[]; request_id: null; }; } = {
      MessageNotification: {
        cid: '12345',
        peer_cid: '99',
        message: [1, 2, 3],
        request_id: null,
      },
    };

    instanceInboundRouter.routeMessage(cidRoutedMessage);

    expect(instanceChannelMock.requestCidReport).toHaveBeenCalledTimes(1);
    expect(instanceChannelMock.forwardToInstance).not.toHaveBeenCalled();
  });

  it('buffers the orphaned message instead of processing it locally up front', () => {
    instanceManagerMock.findInstanceByCid.mockReturnValue(null);

    const local: ReturnType<typeof vi.fn> = vi.fn();
    eventEmitter.on('websocket-message', local);

    const cidRoutedMessage: { FileTransferRequestNotification: { cid: string; peer_cid: string; request_id: null; }; } = {
      FileTransferRequestNotification: {
        cid: '67890',
        peer_cid: '11',
        request_id: null,
      },
    };

    try {
      instanceInboundRouter.routeMessage(cidRoutedMessage);
      // Pre-buffer behaviour: would have called local immediately.
      // Post-buffer: local processing is deferred until either the
      // fallback timer fires or a matching cid-update arrives.
      expect(local).not.toHaveBeenCalled();
      expect(instanceChannelMock.requestCidReport).toHaveBeenCalledTimes(1);
    } finally {
      eventEmitter.off('websocket-message', local);
    }
  });

  it('drains the buffer to the correct instance when its cid-report arrives in time', () => {
    instanceManagerMock.findInstanceByCid
      .mockReturnValueOnce(null)        // first lookup: unowned, message gets buffered
      .mockReturnValueOnce('follower-x') // second lookup (replay): now owned by follower-x
      ;

    const local: ReturnType<typeof vi.fn> = vi.fn();
    eventEmitter.on('websocket-message', local);

    const cidRoutedMessage: { MessageNotification: { cid: string; peer_cid: string; message: number[]; request_id: null; }; } = {
      MessageNotification: {
        cid: '44444',
        peer_cid: '99',
        message: [1, 2, 3],
        request_id: null,
      },
    };

    try {
      instanceInboundRouter.routeMessage(cidRoutedMessage);
      expect(local).not.toHaveBeenCalled();
      expect(instanceChannelMock.forwardToInstance).not.toHaveBeenCalled();

      // Follower's cid-report lands. Emitted here by hand because this suite
      // mocks instanceManager wholesale — see the companion test below, which
      // covers the half this cannot: that the real registerInstance actually
      // emits. Without that, deleting the sole production emitter leaves the
      // buffer undrained (orphaned messages, call media included, land on the
      // leader tab) while this test stays green.
      eventEmitter.emit('instance:registered', {
        instanceId: 'follower-x',
        cid: 44444n,
      });

      expect(instanceChannelMock.forwardToInstance).toHaveBeenCalledTimes(1);
      // The third argument is the ack id: forwards are retained by the leader
      // until the target confirms, so it must be present and non-empty.
      expect(instanceChannelMock.forwardToInstance).toHaveBeenCalledWith(
        'follower-x',
        cidRoutedMessage,
        expect.any(String),
      );
      // Local processing was NOT triggered — the buffer + replay path
      // bypasses the fallback when the owner shows up in time.
      expect(local).not.toHaveBeenCalled();
    } finally {
      eventEmitter.off('websocket-message', local);
    }
  });

  it('says so when the drain finds no owner after all, instead of dropping the fact', () => {
    // The comment above the drain used to assert this could not happen ("the cid
    // is now known"), and the boolean that tests the assertion was discarded. It
    // CAN happen: `instance:registered` fires for every cid-update, and the
    // instance can be gone again by the time the buffer drains.
    //
    // The message is not lost -- routeByCid hands it to the leader -- but a
    // CID-routed notification processed by the LEADER rather than the session it
    // names is the wrong session, which is the whole failure CID_ROUTED_NOTIFICATIONS
    // exists to prevent. This drain is its last chance: the fallback timer is
    // already cleared and the entry is out of the buffer, so if nothing says so
    // here, nothing ever does.
    instanceManagerMock.findInstanceByCid.mockReturnValue(null);

    const warn: ReturnType<typeof vi.fn> = vi.fn();
    const originalWarn: typeof console.warn = console.warn;
    console.warn = warn;

    const local: ReturnType<typeof vi.fn> = vi.fn();
    eventEmitter.on('websocket-message', local);

    const cidRoutedMessage: { MessageNotification: { cid: string; peer_cid: string; message: number[]; request_id: null; }; } = {
      MessageNotification: {
        cid: '55555',
        peer_cid: '99',
        message: [1, 2, 3],
        request_id: null,
      },
    };

    try {
      instanceInboundRouter.routeMessage(cidRoutedMessage);
      expect(warn, 'buffering is not the failure; nothing to report yet').not.toHaveBeenCalled();

      // The owner registers -- so the buffer drains -- but it still does not own
      // the CID when the replay looks it up.
      eventEmitter.emit('instance:registered', { instanceId: 'follower-x', cid: 55555n });

      expect(instanceChannelMock.forwardToInstance,
        'no instance owned it, so nothing was forwarded').not.toHaveBeenCalled();
      expect(warn, 'the unclaimed drain must be reported').toHaveBeenCalledTimes(1);
      // Name the CID and the type, or the line cannot be acted on.
      expect(String(warn.mock.calls[0]?.[0])).toContain('55555');
      expect(String(warn.mock.calls[0]?.[0])).toContain('MessageNotification');
    } finally {
      console.warn = originalWarn;
      eventEmitter.off('websocket-message', local);
    }
  });

  it('falls back to local processing when the fallback timer fires before any cid-report', async () => {
    instanceManagerMock.findInstanceByCid.mockReturnValue(null);

    const local: ReturnType<typeof vi.fn> = vi.fn();
    eventEmitter.on('websocket-message', local);

    const cidRoutedMessage: { MessageNotification: { cid: string; peer_cid: string; message: number[]; request_id: null; }; } = {
      MessageNotification: {
        cid: '99999',
        peer_cid: '11',
        message: [9, 9, 9],
        request_id: null,
      },
    };

    try {
      vi.useFakeTimers();
      instanceInboundRouter.routeMessage(cidRoutedMessage);
      expect(local).not.toHaveBeenCalled();

      // Advance past the orphan buffer's fallback timeout. No
      // `instance:registered` arrived, so the fallback timer fires
      // and the leader processes the message locally — preserving the
      // pre-buffer guarantee that no message is ever silently dropped.
      vi.advanceTimersByTime(ORPHAN_BUFFER_TIMEOUT_MS + 1);

      // A MessageNotification is now held briefly for the P2P handler, which
      // never attaches in a unit test. The hold is bounded precisely so this
      // guarantee survives: past the release timeout it is emitted regardless,
      // to whoever IS listening. Holding forever would trade a rare lost
      // message for a permanently stranded one.
      vi.advanceTimersByTime(2001);

      expect(local).toHaveBeenCalledTimes(1);
      expect(local).toHaveBeenCalledWith(cidRoutedMessage);
    } finally {
      vi.useRealTimers();
      eventEmitter.off('websocket-message', local);
    }
  });

  it('does NOT request a CID report when an instance already owns the target CID', () => {
    instanceManagerMock.findInstanceByCid.mockReturnValue('follower-instance');

    const cidRoutedMessage: { MessageNotification: { cid: string; peer_cid: string; message: number[]; request_id: null; }; } = {
      MessageNotification: {
        cid: '12345',
        peer_cid: '99',
        message: [1, 2, 3],
        request_id: null,
      },
    };

    instanceInboundRouter.routeMessage(cidRoutedMessage);

    expect(instanceChannelMock.requestCidReport).not.toHaveBeenCalled();
    expect(instanceChannelMock.forwardToInstance).toHaveBeenCalledTimes(1);
    expect(instanceChannelMock.forwardToInstance).toHaveBeenCalledWith(
      'follower-instance',
      cidRoutedMessage,
      expect.any(String),
    );
  });

  it('does NOT request a CID report when the leader itself owns the target CID', () => {
    instanceManagerMock.findInstanceByCid.mockReturnValue('leader-instance');

    const local: ReturnType<typeof vi.fn> = vi.fn();
    eventEmitter.on('websocket-message', local);

    const cidRoutedMessage: { PeerRegisterNotification: { cid: string; peer_cid: string; request_id: null; }; } = {
      PeerRegisterNotification: {
        cid: '12345',
        peer_cid: '99',
        request_id: null,
      },
    };

    try {
      instanceInboundRouter.routeMessage(cidRoutedMessage);
      expect(instanceChannelMock.requestCidReport).not.toHaveBeenCalled();
      expect(instanceChannelMock.forwardToInstance).not.toHaveBeenCalled();
      expect(local).toHaveBeenCalledWith(cidRoutedMessage);
    } finally {
      eventEmitter.off('websocket-message', local);
    }
  });
});

/**
 * And the router has to consult the set.
 *
 * `a-media-frame-is-not-retained.test.ts` pins what the set contains, which it
 * would do whether or not `routeMessage` ever asked. This drives the router.
 */
describe('forwarding a media frame to another tab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    eventEmitter.emit('instance:leader-changed', {
      isLeader: true,
      leaderId: 'leader-instance',
    });
  });

  function mediaFrame(): { MediaFrameNotification: { cid: string; peer_cid: string; request_id: null } } {
    return { MediaFrameNotification: { cid: '12345', peer_cid: '99', request_id: null } };
  }

  it('forwards it without a requestId, so nothing is retained or acked', () => {
    instanceManagerMock.findInstanceByCid.mockReturnValue('follower-instance');

    instanceInboundRouter.routeMessage(mediaFrame());

    expect(instanceChannelMock.forwardToInstance).toHaveBeenCalledTimes(1);
    const [target, , requestId]: unknown[] = instanceChannelMock.forwardToInstance.mock.calls[0];
    expect(target).toBe('follower-instance');
    expect(
      requestId,
      'a media frame was retained: a uuid, a timer and the payload, per frame — and \
a missed ack decodes another tab’s video on this one',
    ).toBeUndefined();
  });

  it('still retains a chat message', () => {
    // The opposite failure: making every forward fire-and-forget would pass the
    // assertion above while silently dropping the messages that matter.
    instanceManagerMock.findInstanceByCid.mockReturnValue('follower-instance');

    instanceInboundRouter.routeMessage({
      MessageNotification: { cid: '12345', peer_cid: '99', message: [1], request_id: null },
    });

    expect(instanceChannelMock.forwardToInstance).toHaveBeenCalledTimes(1);
    const [, , requestId]: unknown[] = instanceChannelMock.forwardToInstance.mock.calls[0];
    expect(requestId, 'a chat message lost its delivery guarantee').toEqual(expect.any(String));
  });

  it('drops a frame for a CID nobody owns rather than replaying it later', async (): Promise<void> => {
    // A frame replayed after the orphan timeout is two seconds stale — a worse
    // artefact than the gap the pipeline already recovers from.
    //
    // The discriminating assertion is the REPLAY, not the immediate call:
    // buffering and dropping both request a cid-report and both forward
    // nothing, so an assertion on those two passes either way. Verified by
    // control, which is how this test came to check the wrong thing first.
    // What separates them is whether the frame reappears when the timer fires.
    instanceManagerMock.findInstanceByCid.mockReturnValue(null);

    const local: ReturnType<typeof vi.fn> = vi.fn();
    eventEmitter.on('websocket-message', local);
    vi.useFakeTimers();

    try {
      instanceInboundRouter.routeMessage(mediaFrame());
      vi.advanceTimersByTime(ORPHAN_BUFFER_TIMEOUT_MS + 100);

      expect(
        local,
        'a stale media frame was replayed on this tab after the orphan timeout',
      ).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
      eventEmitter.off('websocket-message', local);
    }
  });

  it('still replays a chat message for an unowned CID', async (): Promise<void> => {
    // The opposite failure: dropping every orphan would pass the assertion
    // above while losing the messages the buffer exists to save.
    instanceManagerMock.findInstanceByCid.mockReturnValue(null);

    const local: ReturnType<typeof vi.fn> = vi.fn();
    eventEmitter.on('websocket-message', local);
    vi.useFakeTimers();

    try {
      // FileTransferRequestNotification rather than MessageNotification: the
      // local emit holds P2P traffic until a handler is attached, and this
      // harness attaches none, so a chat message would never emit either way.
      instanceInboundRouter.routeMessage({
        FileTransferRequestNotification: { cid: '55555', peer_cid: '99', request_id: null },
      });
      vi.advanceTimersByTime(ORPHAN_BUFFER_TIMEOUT_MS + 100);

      expect(local, 'the orphan buffer stopped rescuing chat messages').toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
      eventEmitter.off('websocket-message', local);
    }
  });
});
