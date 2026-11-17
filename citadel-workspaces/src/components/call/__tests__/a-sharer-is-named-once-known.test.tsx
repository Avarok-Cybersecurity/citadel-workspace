/**
 * The screen-share label names the sharer once the roster knows them.
 *
 * Seen on the dev build: the callee's stage read "Peer 513ES1 is sharing". The
 * share's name is the participant's, frozen when the call signal arrived --
 * before a freshly loaded page had its registration roster -- so the handle
 * `peerDisplayName` gives an unknown peer stayed on the stage for the whole
 * share. The participant tile already re-asks the roster (use-roster-name);
 * the share label and the "one screen at a time" reason did not.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type React from 'react';
import { act, render, screen } from '@testing-library/react';
import { CallStage } from '../CallStage';
import { eventEmitter } from '@/lib/event-emitter';
import { peerDisplayName } from '@/lib/peer-display';
import type { CallState } from '@/lib/call/call-state';

const ALICE: bigint = 14768729968876999829n;

// The roster is a network-backed singleton; the rule under test is only
// "ask it again when it changes", so the test decides what it holds.
const roster: { registered: Array<{ cid: bigint; username: string; fullName: string }> } = { registered: [] };
vi.mock('@/lib/p2p-registration-service', () => ({
  p2pRegistrationService: {
    getPeers: (): unknown => ({ registeredPeers: roster.registered, allPeers: [] }),
  },
}));
// jsdom has no getDisplayMedia; without this the share control's reason would
// be "This browser cannot share a screen" and the sharer's name never shown.
vi.mock('@/lib/call/screen-capability', () => ({ canShareScreen: (): boolean => true }));

// jsdom implements no media playback; the share view calls play() on mount.
HTMLMediaElement.prototype.play = (): Promise<void> => Promise.resolve();

/** jsdom has no MediaStream; the stage only passes it to a <video>. */
const STREAM: MediaStream = { getVideoTracks: (): MediaStreamTrack[] => [], getTracks: (): MediaStreamTrack[] => [] } as unknown as MediaStream;

function sharingCall(username: string): CallState {
  return {
    callId: 'c1', status: 'active', selfSpeaking: false, home: { kind: 'direct' }, outgoing: false, caller: ALICE,
    selfMedia: { audio: true, video: false, screen: false },
    participants: new Map([[ALICE, { cid: ALICE, username, status: 'active', media: { audio: true, video: false, screen: true }, speaking: false }]]),
    reason: null,
  };
}

function renderStage(username: string): void {
  const props: React.ComponentProps<typeof CallStage> = {
    call: sharingCall(username), selfUsername: 'Me', localStream: null,
    remoteStreams: new Map<bigint, MediaStream>(), remoteScreenStreams: new Map([[ALICE, STREAM]]),
    onToggleMic: vi.fn(), onToggleCamera: vi.fn(), onToggleScreenShare: vi.fn(), onLeave: vi.fn(),
  };
  render(<CallStage {...props} />);
}

describe("a peer's screen share", () => {
  beforeEach((): void => { roster.registered = []; });

  it('replaces a placeholder sharer name with the one the roster learns', () => {
    const placeholder: string = peerDisplayName({ cid: ALICE });
    renderStage(placeholder);
    expect(screen.getByText(`${placeholder} is sharing`)).toBeInTheDocument();

    roster.registered = [{ cid: ALICE, username: 'alice0924', fullName: '' }];
    act((): void => { eventEmitter.emit('p2p:peers-updated', {}); });

    expect(screen.getByText('alice0924 is sharing')).toBeInTheDocument();
    expect(screen.queryByText(`${placeholder} is sharing`)).toBeNull();
    expect(screen.getByTestId('call-toggle-screen')).toHaveAccessibleDescription('alice0924 is sharing — one screen at a time');
  });

  it('keeps a real name it was given', () => {
    // Positive control: the roster does not outrank a name that is already one.
    roster.registered = [{ cid: ALICE, username: 'someone-else', fullName: '' }];
    renderStage('alice0924');
    act((): void => { eventEmitter.emit('p2p:peers-updated', {}); });
    expect(screen.getByText('alice0924 is sharing')).toBeInTheDocument();
  });
});
