/**
 * The group surfaces are judged on the cases the 1:1 flow never hits: a room
 * too big for the mesh, a call already ringing that must be JOINED rather than
 * restarted, and a stage that must stay inside its own room.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen , type RenderResult } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CallContext, type CallContextValue } from '@/lib/call/call-context';
import { MAX_VIDEO_PARTICIPANTS, type CallParticipant, type CallState } from '@/lib/call/call-state';
import { GroupCallControls, type GroupCallMember } from '../GroupCallControls';
import { GroupCallDock } from '../GroupCallDock';

const ROOM: "room-1" = 'room-1';

function members(count: number): GroupCallMember[] {
  return Array.from({ length: count }, (_, i) => ({
    cid: BigInt(i + 2),
    username: `user-${i + 2}`,
  }));
}

function participant(cid: bigint): CallParticipant {
  return {
    cid,
    username: `user-${cid}`,
    status: 'active',
    media: { audio: true, video: false, screen: false },
    speaking: false,
  };
}

function callState(overrides: Partial<CallState> = {}): CallState {
  return {
    callId: 'c1',
    status: 'active',
    home: { kind: 'group', roomId: ROOM },
    outgoing: true,
    caller: null,
    selfMedia: { audio: true, video: false, screen: false },
    selfSpeaking: false,
    participants: new Map([[2n, participant(2n)]]),
    reason: null,
    ...overrides,
  };
}

function ctx(overrides: Partial<CallContextValue> = {}): CallContextValue {
  return {
    call: null,
    localStream: null,
    remoteStreams: new Map(),
    remoteAudioStreams: new Map(),
    remoteScreenStreams: new Map<bigint, MediaStream>(),
    screenStream: null,
    qualities: new Map(),
    captureFailure: null,
    capability: { supported: true },
    startCall: vi.fn(async () => {}),
    accept: vi.fn(async () => {}),
    decline: vi.fn(async () => {}),
    leave: vi.fn(async () => {}),
    toggleMic: vi.fn(async () => {}),
    toggleCamera: vi.fn(async () => {}),
    toggleScreenShare: vi.fn(async (): Promise<void> => {}),
    annotate: (): void => {},
    videoQuality: 'auto' as const,
    setVideoQuality: (): void => {},
    ...overrides,
  };
}

function renderControls(value: CallContextValue, roster: GroupCallMember[]): RenderResult {
  return render(
    <CallContext.Provider value={value}>
      <GroupCallControls home={{ kind: 'group', roomId: ROOM }} roomName="Design" members={roster} notConnected={[]} />
    </CallContext.Provider>,
  );
}

describe('GroupCallControls — starting', () => {
  it('starts a video call with the full roster and the room id', async () => {
    const value: CallContextValue = ctx();
    renderControls(value, members(3));

    await userEvent.click(screen.getByTestId('group-call-start-video'));

    expect(value.startCall).toHaveBeenCalledWith(members(3), true, { kind: 'group', roomId: ROOM });
  });

  it('starts an audio call with the room id', async () => {
    const value: CallContextValue = ctx();
    renderControls(value, members(3));

    await userEvent.click(screen.getByTestId('group-call-start-audio'));

    expect(value.startCall).toHaveBeenCalledWith(members(3), false, { kind: 'group', roomId: ROOM });
  });

  it('disables only video when the room outgrows the video mesh', () => {
    renderControls(ctx(), members(MAX_VIDEO_PARTICIPANTS + 1));

    expect(screen.getByTestId('group-call-start-video')).toBeDisabled();
    expect(screen.getByTestId('group-call-start-audio')).toBeEnabled();
  });

  it('disables both buttons with the browser reason when calls are unsupported', () => {
    renderControls(ctx({ capability: { supported: false, reason: 'No WebCodecs here.' } }), members(2));

    expect(screen.getByTestId('group-call-start-audio')).toBeDisabled();
    expect(screen.getByTestId('group-call-start-video')).toBeDisabled();
  });

  it('disables starting while a DM call owns the tab', () => {
    renderControls(ctx({ call: callState({ home: { kind: 'direct' } }) }), members(2));

    expect(screen.getByTestId('group-call-start-audio')).toBeDisabled();
    expect(screen.getByTestId('group-call-start-video')).toBeDisabled();
  });
});

describe('GroupCallControls — joining a call in progress', () => {
  it('offers Join with the participant count instead of a start button', () => {
    renderControls(ctx({ call: callState({ status: 'ringing-in' }) }), members(4));

    expect(screen.getByTestId('group-call-join-audio')).toHaveTextContent('Join call');
    expect(screen.getByTestId('group-call-join-audio')).toHaveTextContent('1');
    expect(screen.queryByTestId('group-call-start-audio')).not.toBeInTheDocument();
  });

  it('joins with audio via accept, so both people land in ONE call', async () => {
    const value: CallContextValue = ctx({ call: callState({ status: 'ringing-in' }) });
    renderControls(value, members(4));

    await userEvent.click(screen.getByTestId('group-call-join-audio'));

    expect(value.accept).toHaveBeenCalledWith({ audio: true, video: false, screen: false });
    expect(value.startCall).not.toHaveBeenCalled();
  });

  it('joins with video via the video join button', async () => {
    const value: CallContextValue = ctx({ call: callState({ status: 'ringing-in' }) });
    renderControls(value, members(4));

    await userEvent.click(screen.getByTestId('group-call-join-video'));

    expect(value.accept).toHaveBeenCalledWith({ audio: true, video: true, screen: false });
  });

  it('closes video join when the call is already at the video cap', () => {
    const participants: Map<bigint, CallParticipant> = new Map<bigint, CallParticipant>();
    for (let i: number = 0; i < MAX_VIDEO_PARTICIPANTS; i++) {
      const cid: bigint = BigInt(i + 2);
      participants.set(cid, participant(cid));
    }
    renderControls(ctx({ call: callState({ status: 'ringing-in', participants }) }), members(4));

    expect(screen.getByTestId('group-call-join-video')).toBeDisabled();
    expect(screen.getByTestId('group-call-join-audio')).toBeEnabled();
  });
});

describe('GroupCallControls — in call', () => {
  it('offers only Leave while in this room’s call', async () => {
    const value: CallContextValue = ctx({ call: callState() });
    renderControls(value, members(2));

    expect(screen.queryByTestId('group-call-start-audio')).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId('group-call-leave'));

    expect(value.leave).toHaveBeenCalled();
  });
});

describe('GroupCallDock — scoping', () => {
  function renderDock(value: CallContextValue, roomId: string = ROOM): RenderResult {
    return render(
      <CallContext.Provider value={value}>
        <GroupCallDock roomId={roomId} />
      </CallContext.Provider>,
    );
  }

  it('docks the stage for this room’s active call', () => {
    renderDock(ctx({ call: callState() }));

    expect(screen.getByTestId('call-stage')).toBeInTheDocument();
  });

  it('never docks another room’s call here', () => {
    renderDock(ctx({ call: callState({ home: { kind: 'group', roomId: 'other-room' } }) }));

    expect(screen.queryByTestId('call-stage')).not.toBeInTheDocument();
  });

  it('never docks a DM call over a group surface', () => {
    renderDock(ctx({ call: callState({ home: { kind: 'direct' } }) }));

    expect(screen.queryByTestId('call-stage')).not.toBeInTheDocument();
  });

  it('stays out while the call is only ringing us — ringing belongs to the incoming card', () => {
    renderDock(ctx({ call: callState({ status: 'ringing-in' }) }));

    expect(screen.queryByTestId('call-stage')).not.toBeInTheDocument();
  });

  it('keeps the failed panel visible so the user gets the reason', () => {
    renderDock(ctx({ call: callState({ status: 'failed', reason: 'Capture failed' }) }));

    expect(screen.getByTestId('call-stage')).toBeInTheDocument();
  });
});
