/**
 * The file bubble is not a button around buttons.
 *
 * Found while automating a two-machine test (2026-09-27): the whole bubble was a div with
 * role="button" and tabIndex 0 in every state, wrapped around the real Accept, Decline and Cancel
 * buttons. Assistive tech announced a button inside a button, keyboard focus stopped on a
 * "button" that did nothing whenever there was nothing to open, and "the Accept button" matched
 * two elements. Only the file header of a finished download opens anything, so only it is a button.
 *
 * Real: the bubble. Mocked: the socket and the tab's session lookup (IndexedDB), which it imports.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

vi.mock('@/lib/tab-context', () => ({
  getSelectedUser: async (): Promise<{ selectedCid: bigint }> => ({ selectedCid: 7n }),
}));
vi.mock('@/lib/websocket-service', () => ({
  websocketService: {
    sendRequest: async (): Promise<void> => undefined,
    sendP2PMessageReliable: async (): Promise<void> => undefined,
    ensureMessengerOpen: async (): Promise<boolean> => false,
    canSendRequests: (): boolean => false,
  },
}));

import { FileTransferBubble } from '../FileTransferBubble';
import type { P2PMessage } from '@/lib/p2p';

afterEach(cleanup);

function message(state: string, isIncoming: boolean): P2PMessage {
  return {
    id: 'msg-t1', content: 'File transfer: a.bin', senderCid: isIncoming ? 42n : 7n, recipientCid: isIncoming ? 7n : 42n,
    timestamp: 1, status: 'delivered', message_type: 'file_transfer', transfer_id: 't1',
    file_name: 'a.bin', file_size: 3000, transfer_mode: 'p2p', transfer_state: state,
  } as P2PMessage;
}

const BUTTONISH: string = 'button, [role="button"]';
function nestedButtons(container: HTMLElement): boolean {
  return [...container.querySelectorAll(BUTTONISH)].some((b: Element) => b.querySelector(BUTTONISH) !== null);
}

describe('the file bubble', () => {
  it('a finished download has one button that opens it, with nothing nested', () => {
    const { container } = render(<FileTransferBubble message={message('complete', true)} isOwn={false} onOpen={(): void => {}} />);
    expect(nestedButtons(container)).toBe(false);
    expect(screen.getAllByRole('button').map((b: HTMLElement) => b.textContent)).toEqual([expect.stringContaining('a.bin')]);
  });

  it('a bubble with nothing to open or answer is not a button at all', () => {
    // An outgoing offer this page did not start renders as expired (no live service record);
    // it used to be a focusable role="button" that did nothing when pressed.
    render(<FileTransferBubble message={message('pending', false)} isOwn onCancel={(): void => {}} />);
    expect(screen.getByTestId('file-transfer-bubble').getAttribute('data-transfer-state')).toBe('expired');
    // The delivery tick is a button that opens the message's details; nothing else is.
    expect(screen.queryAllByRole('button').map((b: HTMLElement) => b.getAttribute('data-testid'))).toEqual(['message-status-details-trigger']);
  });
});
