/**
 * The header mark and the changed-key screen it raises.
 *
 * Control (run by hand): make PeerKeyChangedDialog call `onAccept(presented)` when it opens →
 * "nothing is accepted until the person clicks Accept" fails.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PeerIdentityMark } from '../PeerIdentityMark';
import type { PeerIdentityView } from '@/lib/peer-identity/wire';

const MINE: string = 'aaaa-bbbb-cccc-dddd';
const PINNED: string = 'mmmm-nnnn-pppp-qqqq';
const NEW_KEY: string = 'wwww-xxxx-yyyy-zzzz';

function mark(view: PeerIdentityView | null, onAccept: (fp: string) => Promise<void> = vi.fn(async () => {})): ReturnType<typeof render> {
  return render(<PeerIdentityMark peerName="Bob" view={view} onAccept={onAccept} />);
}

describe('the peer identity mark', () => {
  it('says nothing before the agent answers', () => {
    mark(null);
    expect(screen.queryByTestId('peer-identity-mark')).toBeNull();
  });

  it('shows a verified peer and opens the safety number', () => {
    mark({ own: MINE, pinned: PINNED, pending: null });
    const button: HTMLElement = screen.getByTestId('peer-identity-mark');
    expect(button.dataset.kind).toBe('verified');
    expect(button.textContent).toContain('Verified');
    fireEvent.click(button);
    const lines: string[] = screen.getAllByTestId('safety-number-line').map((el: HTMLElement) => el.textContent ?? '');
    expect(lines).toEqual([MINE, PINNED]);
  });

  it('shows a legacy account unverified, with the reason and no number', () => {
    mark({ own: null, pinned: null, pending: null });
    const button: HTMLElement = screen.getByTestId('peer-identity-mark');
    expect(button.dataset.kind).toBe('unverified');
    fireEvent.click(button);
    expect(screen.getByTestId('peer-safety-number').textContent).toContain('no identity key');
    expect(screen.queryByTestId('safety-number-line')).toBeNull();
  });
});

describe('a changed key', () => {
  const changed: PeerIdentityView = { own: MINE, pinned: PINNED, pending: NEW_KEY };

  it('raises the screen with both keys, and nothing is accepted until the person clicks Accept', async () => {
    const onAccept: ReturnType<typeof vi.fn> = vi.fn(async () => {});
    mark(changed, onAccept);
    const dialog: HTMLElement = await screen.findByTestId('peer-key-changed');
    expect(screen.getByTestId('peer-key-previous').textContent).toBe(PINNED);
    expect(screen.getByTestId('peer-key-presented').textContent).toBe(NEW_KEY);
    expect(dialog.textContent).toContain("Bob's key changed");
    expect(onAccept).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('peer-key-accept'));
    await waitFor(() => expect(onAccept).toHaveBeenCalledWith(NEW_KEY));
    expect(onAccept).toHaveBeenCalledTimes(1);
  });

  it('Cancel accepts nothing, and the mark reopens the screen', async () => {
    const onAccept: ReturnType<typeof vi.fn> = vi.fn(async () => {});
    mark(changed, onAccept);
    await screen.findByTestId('peer-key-changed');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByTestId('peer-key-changed')).toBeNull());
    expect(onAccept).not.toHaveBeenCalled();
    const button: HTMLElement = screen.getByTestId('peer-identity-mark');
    expect(button.dataset.kind).toBe('changed');
    fireEvent.click(button);
    expect(await screen.findByTestId('peer-key-changed')).toBeTruthy();
  });

  it('keeps the screen open with the agent\'s reason when the accept is refused', async () => {
    mark(changed, async () => { throw new Error('no changed key is waiting for this peer'); });
    await screen.findByTestId('peer-key-changed');
    fireEvent.click(screen.getByTestId('peer-key-accept'));
    const alert: HTMLElement = await screen.findByRole('alert');
    await waitFor(() => expect(alert.textContent).toContain('no changed key is waiting'));
    expect(screen.getByTestId('peer-key-changed')).toBeTruthy();
  });
});
