/**
 * Every surface that can accept a peer request must expose the same handle.
 *
 * `peer-accept` lived on the peer list's accept button. The badge in the
 * sidebar opens `PendingRequestsModal` instead — a different component, with
 * its own Accept button, which never had one.
 *
 * So `acceptP2PRequest` found the badge, opened the modal, looked for
 * `peer-accept`, found nothing, retried twenty times and gave up. Four
 * reconnection legs and the peer-group leg died there, on a modal that was
 * rendering perfectly the whole time. Nothing in the failure said "this button
 * has no testid" — it said "Accept button not found in modal", which reads like
 * the request never arrived.
 *
 * This renders the real modal with a real pending request. A snapshot of the
 * markup would not do: the point is that the button EXISTS and is reachable by
 * the handle the shared helper uses.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PendingRequestsModal } from '../PendingRequestsModal';

const getPendingRequests: ReturnType<typeof vi.fn> = vi.hoisted(() => vi.fn());
vi.mock('@/lib/peer-registration-store', () => ({
  peerRegistrationStore: {
    getPendingRequests,
    acceptRequest: vi.fn(),
    declineRequest: vi.fn(),
  },
}));

describe('the pending-requests modal', () => {
  beforeEach((): void => {
    getPendingRequests.mockResolvedValue([
      {
        id: 'r1',
        peer_cid: 42n,
        peer_username: 'ada',
        timestamp: 1_700_000_000_000,
      },
    ]);
  });

  it('exposes accept and decline by the handles the helpers press', async (): Promise<void> => {
    render(<PendingRequestsModal isOpen onClose={vi.fn()} />);

    expect(await screen.findByTestId('peer-accept')).toBeInTheDocument();
    expect(screen.getByTestId('peer-decline')).toBeInTheDocument();
  });

  it('renders nothing to press when there is nothing pending', async (): Promise<void> => {
    // The positive control. Without it the assertion above is satisfied by a
    // modal that renders an Accept button for a request that does not exist.
    getPendingRequests.mockResolvedValue([]);
    render(<PendingRequestsModal isOpen onClose={vi.fn()} />);

    expect(await screen.findByText('No pending requests')).toBeInTheDocument();
    expect(screen.queryByTestId('peer-accept')).not.toBeInTheDocument();
  });
});
