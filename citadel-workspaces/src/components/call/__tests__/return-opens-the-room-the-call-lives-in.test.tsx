/**
 * "Return" on the ongoing-call bar must open the conversation the call lives in.
 *
 * It navigated to `/groups/${roomId}` for every room call. An office or room
 * call's roomId is the node's CHAT CHANNEL id, which no group has, so the group
 * page toasted "Group not found" and bounced to /workspace -- and for a room
 * call accepted from another page (accepting does not navigate), Return was the
 * only way back to the stage.
 *
 * The call state comes from a real CallManager receiving a real invite, so the
 * receiver's resolution of the room is under test, not assumed. Its transport
 * is a fake: it is the manager's one I/O boundary (signals and media sessions),
 * and nothing here is about what crosses it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { ConfirmDialogProvider } from '@/components/shared/confirm-dialog';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { OngoingCallBar } from '../OngoingCallBar';
import { CallContext, type CallContextValue } from '@/lib/call/call-context';
import { CallManager, MEDIA_WIRE_VERSION } from '@/lib/call/call-manager';
import { publishChannelNames } from '@/lib/call/room-names';
import { forgetAllTabs, rememberedTab } from '@/lib/node-tabs/tab-memory';
import type { CallTransport } from '@/lib/call/call-transport';
import type { CallHome, CallState } from '@/lib/call/call-state';
import type { CallMediaKinds } from '@/types/p2p-commands';
import type { DomainNode } from '@/components/layout/sidebar/tree-node-types';

const AUDIO: CallMediaKinds = { audio: true, video: false, screen: false };
const BOB: bigint = 2n;
const CHANNEL: string = '03347dcf-54be-4ef6-ad99-3cff1ced04a3';
const NODE: string = 'office-n1';

function manager(): CallManager {
  const transport: CallTransport = {
    openSession: vi.fn().mockResolvedValue(undefined),
    closeSession: vi.fn().mockResolvedValue(undefined),
    sendFrame: vi.fn(),
    sendSignal: vi.fn().mockResolvedValue(undefined),
  } as unknown as CallTransport;
  return new CallManager({
    transport,
    selfCid: 1n,
    capabilities: { audio: ['opus'], video: [] },
    now: (): number => 0,
    schedule: (): (() => void) => (): void => {},
    onStateChanged: (): void => {},
    resolvePeerName: (cid: bigint): string => `peer-${cid}`,
    onKeyframeRequested: (): void => {},
  });
}

async function receivedRoomCall(roomId: string): Promise<CallState> {
  const m: CallManager = manager();
  await m.handleSignal(BOB, 'bob', {
    kind: 'CallInvite',
    call_id: 'room-call',
    media: AUDIO,
    codecs: { audio: ['opus'], video: [] },
    media_wire_version: MEDIA_WIRE_VERSION,
    group: { room_id: roomId, members: ['1', '2'] },
  });
  await m.accept(AUDIO, null);
  const state: CallState | null = m.getState();
  if (!state) throw new Error('the invite produced no call');
  return state;
}

async function placedCall(home: CallHome): Promise<CallState> {
  const m: CallManager = manager();
  await m.start('placed', [{ cid: BOB, username: 'bob' }], AUDIO, home, null);
  const state: CallState | null = m.getState();
  if (!state) throw new Error('start produced no call');
  return { ...state, status: 'active' };
}

function Where(): JSX.Element {
  const location: ReturnType<typeof useLocation> = useLocation();
  return <div data-testid="where">{location.pathname + location.search}</div>;
}

async function pressReturn(call: CallState): Promise<string> {
  render(
    <CallContext.Provider value={{ call, leave: vi.fn() } as unknown as CallContextValue}>
      <ConfirmDialogProvider>
        <MemoryRouter initialEntries={['/files']}>
          <OngoingCallBar />
          <Routes>
            <Route path="*" element={<Where />} />
          </Routes>
        </MemoryRouter>
      </ConfirmDialogProvider>
    </CallContext.Provider>,
  );
  await userEvent.click(screen.getByRole('button', { name: 'Return' }));
  // Return is guarded (it may ask about an unsaved edit first), so it lands a tick later.
  await waitFor((): void => { expect(screen.getByTestId('where').textContent).not.toBe('/files'); });
  return screen.getByTestId('where').textContent ?? '';
}

describe('Return on the ongoing-call bar', () => {
  beforeEach(() => {
    cleanup();
    forgetAllTabs();
    publishChannelNames({ [NODE]: { id: NODE, name: 'Office', chat_channel_id: CHANNEL } as DomainNode });
  });

  it("opens an office call's node on its Chat tab, not a group page", async () => {
    const call: CallState = await receivedRoomCall(CHANNEL);
    expect(call.home).toEqual({ kind: 'node', roomId: CHANNEL, nodeId: NODE });

    expect(await pressReturn(call)).toBe(`/workspace?nodeId=${NODE}`);
    expect(rememberedTab(NODE)).toBe('chat');
  });

  it('opens the node of an office call this user placed', async () => {
    const call: CallState = await placedCall({ kind: 'node', roomId: CHANNEL, nodeId: NODE });
    expect(await pressReturn(call)).toBe(`/workspace?nodeId=${NODE}`);
  });

  it("still opens a peer group's page for a group call", async () => {
    // The control for the two above: a bar that sent everything to the
    // workspace would pass them and break this.
    const call: CallState = await receivedRoomCall('grp-1');
    expect(await pressReturn(call)).toBe('/groups/grp-1');
  });

  it("still opens the peer's conversation for a 1:1 call", async () => {
    const call: CallState = await placedCall({ kind: 'direct' });
    expect(await pressReturn(call)).toBe(`/messages?channel=${BOB.toString()}`);
  });
});
