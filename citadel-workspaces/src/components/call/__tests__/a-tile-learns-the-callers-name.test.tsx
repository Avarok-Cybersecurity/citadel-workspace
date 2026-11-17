/**
 * A participant tile shows the caller's name once the roster knows it.
 *
 * Seen on the live bench after a page reload: the callee's tile for the caller
 * read "Peer 6W1TP1". The name is resolved once, when the invite arrives, and
 * a page that has just reloaded has not loaded its registration roster yet --
 * so the handle `peerDisplayName` gives a peer it cannot name was frozen into
 * the call state for the rest of the call, while the sidebar beside it had long
 * since learned "alice".
 *
 * The tile now asks again when the roster changes, for as long as what it holds
 * is a placeholder.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { ParticipantTile } from '../ParticipantTile';
import { eventEmitter } from '@/lib/event-emitter';
import { peerDisplayName } from '@/lib/peer-display';
import type { CallParticipant } from '@/lib/call/call-state';

const ALICE: bigint = 14768729968876999829n;

// The roster is a network-backed singleton; the tile's rule is only "ask it
// again when it changes", so the test decides what it holds.
const roster: { registered: Array<{ cid: bigint; username: string; fullName: string }> } = { registered: [] };
vi.mock('@/lib/p2p-registration-service', () => ({
  p2pRegistrationService: {
    getPeers: (): unknown => ({ registeredPeers: roster.registered, allPeers: [] }),
  },
}));

function caller(username: string): CallParticipant {
  return { cid: ALICE, username, status: 'active', media: { audio: true, video: false, screen: false }, speaking: false };
}

describe("the caller's tile", () => {
  beforeEach((): void => { roster.registered = []; });

  it('replaces a placeholder with the name the roster learns later', () => {
    const placeholder: string = peerDisplayName({ cid: ALICE });
    render(<ParticipantTile participant={caller(placeholder)} stream={null} isSelf={false} />);
    expect(screen.getByTestId(`participant-tile-${ALICE}`)).toHaveTextContent(placeholder);

    roster.registered = [{ cid: ALICE, username: 'alice0924', fullName: '' }];
    act((): void => { eventEmitter.emit('p2p:peers-updated', {}); });

    const tile: HTMLElement = screen.getByTestId(`participant-tile-${ALICE}`);
    expect(tile).toHaveTextContent('alice0924');
    expect(tile).not.toHaveTextContent(placeholder);
  });

  it('keeps a real name it was given', () => {
    // Positive control: the roster does not outrank a name that is already one.
    roster.registered = [{ cid: ALICE, username: 'someone-else', fullName: '' }];
    render(<ParticipantTile participant={caller('alice0924')} stream={null} isSelf={false} />);
    act((): void => { eventEmitter.emit('p2p:peers-updated', {}); });
    expect(screen.getByTestId(`participant-tile-${ALICE}`)).toHaveTextContent('alice0924');
  });
});
