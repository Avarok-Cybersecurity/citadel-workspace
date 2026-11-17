/**
 * "We could not load the people here" and "there is nobody here" are different
 * sentences, and the modal said the second when it meant the first.
 *
 * `usePeerDiscovery` initialised its list to `[]` and left it there when
 * discovery failed. `PeerDiscoveryModal` renders `[]` as:
 *
 *     No other users in this workspace yet
 *     People who join this workspace appear here…
 *
 * which is a confident claim about the workspace, made on the strength of a
 * query that did not answer. There IS a failure toast beside it — and a toast
 * is transient, so what remains on screen after it fades is the sentence that
 * contradicts it, on the one screen whose purpose is finding somebody to talk
 * to.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PeerDiscoveryModal } from '../PeerDiscoveryModal';
import type { Peer } from '../usePeerDiscovery';

const state: { peers: Peer[] | null; loading: boolean } = { peers: null, loading: false };

vi.mock('../usePeerDiscovery', () => ({
  usePeerDiscovery: (): unknown => ({
    peers: state.peers,
    registeredPeers: new Set<string>(),
    outgoingRequests: new Set<string>(),
    incomingRequests: new Map(),
    loading: state.loading,
    acceptingPeerCid: null,
    currentCid: 1n,
    currentUsername: 'me',
    discoverPeers: vi.fn(async () => {}),
    acceptIncomingRequest: vi.fn(async () => {}),
    registerWithPeer: vi.fn(async () => {}),
  }),
}));

describe('the peer discovery modal', () => {
  it('does not claim the workspace is empty when discovery has not succeeded', () => {
    state.peers = null;
    state.loading = false;

    render(<PeerDiscoveryModal isOpen onClose={() => {}} onOpenDirectory={() => {}} />);

    expect(screen.queryByText(/No other users in this workspace yet/i)).toBeNull();
    expect(screen.getByText(/Could not load the people in this workspace/i)).toBeInTheDocument();
  });

  it('still says so when the workspace really is empty', () => {
    // The positive control. Without it, never rendering the empty state at all
    // would satisfy the test above — and a user genuinely alone in a workspace
    // needs to be told that, not told the list failed to load.
    state.peers = [];
    state.loading = false;

    render(<PeerDiscoveryModal isOpen onClose={() => {}} onOpenDirectory={() => {}} />);

    expect(screen.getByText(/No other users in this workspace yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/Could not load the people in this workspace/i)).toBeNull();
  });
});
