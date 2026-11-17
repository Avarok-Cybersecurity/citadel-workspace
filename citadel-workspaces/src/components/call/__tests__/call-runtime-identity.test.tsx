/**
 * Calling must not outlive the identity it was built for.
 *
 * A CallManager bakes `selfCid` into itself and into its transport, but
 * CallLayer keeps the provider mounted across login and workspace routes and
 * only polls the CID. So nothing here remounts on logout, reconnect or account
 * switching — the runtime has to notice on its own, and these are the cases
 * where it previously did not.
 *
 * CallManager and the two on-demand imports are stubbed. The subject is the
 * lifecycle rule, not the call machinery, and that machinery is already covered
 * against a fake transport elsewhere; constructing the real thing here would
 * pull in WebCodecs and a capture pump to observe one identity comparison.
 */
import { describe, it, expect, vi, beforeEach   } from 'vitest';
import { renderHook, act, waitFor , type RenderHookResult } from '@testing-library/react';

const built: Array<{ selfCid: bigint; end: ReturnType<typeof vi.fn>; status: string }> = [];

vi.mock('@/lib/call/call-manager', () => ({
  CallManager: class {
    selfCid: bigint;
    end: ReturnType<typeof vi.fn> = vi.fn();
    status: string = 'active';
    constructor(config: { selfCid: bigint }) {
      this.selfCid = config.selfCid;
      built.push(this);
    }
    getState(): { status: string; } {
      return { status: this.status };
    }
  },
}));
vi.mock('@/lib/call/websocket-call-transport', () => ({
  WebSocketCallTransport: class {},
}));
vi.mock('@/lib/call/codec-support', () => ({
  localCapabilities: (): Promise<{}> => Promise.resolve({}),
  probeMediaCapabilities: (): Promise<{ supported: boolean; }> => Promise.resolve({ supported: true }),
}));
vi.mock('@/lib/roster-peer-name', () => ({ rosterPeerName: (): string => 'Peer' }));

import { useCallRuntime } from '../use-call-runtime';
import type { CallManager } from '@/lib/call/call-manager';
import type { MutableRefObject } from 'react';
import type { CallSession } from '@/lib/call/call-session';

function setup(selfCid: bigint | null): RenderHookResult<{ managerRef: MutableRefObject<CallManager | null>; sessionRef: MutableRefObject<CallSession | null>; teardown: () => void; ensureManager: () => Promise<CallManager | null>; ensureSession: () => Promise<CallSession>; }, { cid: bigint | null; }> {
  return renderHook(
    ({ cid }: { cid: bigint | null }) =>
      useCallRuntime({
        selfCid: cid,
        senderConfig: {} as never,
        setCall: vi.fn(),
        setStreamsVersion: vi.fn(),
        setCaptureFailure: vi.fn(),
      }),
    { initialProps: { cid: selfCid } },
  );
}

beforeEach(() => {
  built.length = 0;
});

describe('call runtime identity', () => {
  it('builds a fresh manager when the account changes', async () => {
    const { result, rerender } = setup(11n);

    const first: CallManager | null = await act((): Promise<CallManager | null> => result.current.ensureManager());
    expect(first).not.toBeNull();
    expect(built).toHaveLength(1);
    expect(built[0].selfCid).toBe(11n);

    act(() => rerender({ cid: 22n }));

    const second: CallManager | null = await act((): Promise<CallManager | null> => result.current.ensureManager());
    // The whole point: not the cached manager wired to 11n.
    expect(second).not.toBe(first);
    expect(built).toHaveLength(2);
    expect(built[1].selfCid).toBe(22n);
  });

  it('hangs up a call in progress when the account changes', async () => {
    const { result, rerender } = setup(11n);
    await act(() => result.current.ensureManager());

    act(() => rerender({ cid: 22n }));

    // Otherwise the peer sits ringing on a call nobody is in until their own
    // timeout fires.
    await waitFor(() => expect(built[0].end).toHaveBeenCalledWith('hangup'));
  });

  it('does not hang up a call that already ended', async () => {
    const { result, rerender } = setup(11n);
    await act(() => result.current.ensureManager());
    built[0].status = 'ended';

    act(() => rerender({ cid: 22n }));

    await waitFor(() => expect(built).toHaveLength(1));
    expect(built[0].end).not.toHaveBeenCalled();
  });

  it('abandons a manager whose construction outlived its identity', async () => {
    const { result, rerender } = setup(11n);

    // Started under 11n, resolved after the switch: installing it would hand
    // the new account a manager wired to the old CID.
    const pending: Promise<CallManager | null> = result.current.ensureManager();
    act(() => rerender({ cid: 22n }));
    const resolved: CallManager | null = await act((): Promise<CallManager | null> => pending);

    expect(resolved).toBeNull();
  });

  it('reuses the manager while the identity is unchanged', async () => {
    const { result, rerender } = setup(11n);

    const first: CallManager | null = await act((): Promise<CallManager | null> => result.current.ensureManager());
    act(() => rerender({ cid: 11n }));
    const second: CallManager | null = await act((): Promise<CallManager | null> => result.current.ensureManager());

    expect(second).toBe(first);
    expect(built).toHaveLength(1);
  });
});
