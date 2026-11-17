/**
 * The sender's group bubble names every member and what happened to their copy,
 * and moves when the transfer service learns more; a member's bubble says where
 * the offer to accept is. Rendered through MessageBubble from the message the
 * group transport maps (groupChatMessage), so the card being wired into the
 * thread is part of what is tested.
 *
 * `@/lib/file-transfer` is replaced by its record lookup and the real event
 * names: the service singleton initialises against IndexedDB and the socket on
 * import, and the bubble reads nothing from it but `getTransfer`. The event
 * emitter is the real one, so the live update goes through production code.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import type { FileTransfer } from '@/lib/file-transfer/types';
import type { GroupMessage } from '@/types/workspace-entities';
import type { GroupFileShare } from '@/types/group-file-share';

const records: Map<string, FileTransfer> = vi.hoisted((): Map<string, FileTransfer> => new Map<string, FileTransfer>());
vi.mock('@/lib/file-transfer', () => ({
  fileTransferService: { getTransfer: (id: string): FileTransfer | undefined => records.get(id) },
  FILE_TRANSFER_EVENTS: { STATE_CHANGED: 'file-transfer:state-changed', COMPLETED: 'file-transfer:completed' },
}));

import { MessageBubble } from '@/components/p2p/bubbles/MessageBubble';
import { groupChatMessage } from '@/lib/chat/transport/group-chat-message';
import { eventEmitter } from '@/lib/event-emitter';

function record(id: string, state: FileTransfer['state'], errorMessage?: string): FileTransfer {
  return {
    id, fileName: 'plan.pdf', fileSize: 2048, fileType: 'application/pdf', state, progress: 0,
    senderCid: '1', recipientCid: '2', createdAt: 0, updatedAt: 0, isIncoming: false, errorMessage,
  };
}

function message(share: GroupFileShare): GroupMessage {
  return {
    id: 'f1', group_id: '1:5', sender_id: '1', sender_name: 'ada', message_type: 'Text',
    content: 'Shared a file: plan.pdf (2 KB)', timestamp: 1n, reply_to: null, reply_count: 0, mentions: [],
    edited_at: null, file_share: share,
  } as GroupMessage;
}

function renderShare(share: GroupFileShare): void {
  render(<MessageBubble message={groupChatMessage(message(share), null, 'sent')} isOwn={false} quoted={null} showSenderName senderName="ada" />);
}

const senderShare: GroupFileShare = {
  name: 'plan.pdf', size: 2048, mimeType: 'application/pdf', senderCid: 1n,
  deliveries: [
    { kind: 'offered', cid: 2n, username: 'bob', transferId: 't-bob' },
    { kind: 'skipped', cid: 3n, username: 'cy', reason: 'offline' },
    { kind: 'skipped', cid: 4n, username: 'dee', reason: 'not P2P-registered with you' },
  ],
};

function rows(): string[] {
  return screen.getAllByTestId('group-file-delivery').map((el: HTMLElement): string => el.textContent ?? '');
}

beforeEach((): void => { records.clear(); });

describe('a file shared into a group', () => {
  it('shows the sender each member, the reason for each one not delivered, and the total', () => {
    records.set('t-bob', record('t-bob', 'pending'));
    renderShare(senderShare);
    expect(screen.getByText('plan.pdf')).toBeTruthy();
    expect(screen.getByText(/2 KB · shared by ada/)).toBeTruthy();
    expect(rows()).toEqual([
      'bob: sent, awaiting an answer',
      'cy: not delivered — offline',
      'dee: not delivered — not P2P-registered with you',
    ]);
    expect(screen.getByTestId('group-file-summary').textContent).toBe('Sent to 3 members: 1 awaiting an answer, 2 not delivered');
  });

  it('moves when the member answers', () => {
    records.set('t-bob', record('t-bob', 'pending'));
    renderShare(senderShare);
    const declined: FileTransfer = record('t-bob', 'declined', 'no room');
    records.set('t-bob', declined);
    act((): void => { eventEmitter.emit('file-transfer:state-changed', declined); });
    expect(rows()[0]).toBe('bob: declined — no room');
    expect(screen.getByTestId('group-file-summary').textContent).toContain('1 declined');
  });

  it('tells a member where to accept it, and shows no ledger', () => {
    renderShare({ name: 'plan.pdf', size: 2048, mimeType: 'application/pdf', senderCid: 1n });
    expect(screen.getByText(/Accept or decline it in your chat with ada/)).toBeTruthy();
    expect(screen.queryByTestId('group-file-deliveries')).toBeNull();
  });
});
