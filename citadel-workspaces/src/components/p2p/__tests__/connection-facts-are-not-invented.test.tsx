/**
 * The Stats tab states only what the conversation's records back.
 *
 * "Storage Used" was `quota - quota * 0.85` -- 15 MB on the default quota,
 * whatever was stored -- and "First Connected" was the first time this browser
 * opened the panel, written to localStorage during render.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConnectionFacts } from '../ConnectionFacts';
import { conversationFacts, type ConversationFacts } from '../connection-facts';
import type { FileTransfer } from '@/lib/file-transfer/types';

function transfer(overrides: Partial<FileTransfer>): FileTransfer {
  return { id: 't', fileName: 'a.bin', fileSize: 1000, fileType: 'x', mode: 'browser', state: 'complete', progress: 100,
    senderCid: '1', recipientCid: '2', createdAt: 5000, updatedAt: 5000, isIncoming: false, ...overrides } as FileTransfer;
}

afterEach((): void => { vi.restoreAllMocks(); });

describe('the conversation facts', () => {
  it('total the finished transfers and date the earliest contact', () => {
    const facts: ConversationFacts = conversationFacts(9000, [
      transfer({ id: 'a', fileSize: 1024, createdAt: 7000 }),
      transfer({ id: 'b', fileSize: 2048, createdAt: 3000 }),
      transfer({ id: 'c', fileSize: 999999, state: 'error', createdAt: 8000 }),
    ]);
    expect(facts).toEqual({ firstContact: 3000, transferredBytes: 3072 });
  });

  it('say nothing when there is nothing to say', () => {
    expect(conversationFacts(null, [])).toEqual({ firstContact: null, transferredBytes: null });
    expect(conversationFacts(0, [transfer({ state: 'declined', createdAt: 0 })])).toEqual({ firstContact: null, transferredBytes: null });
  });
});

describe('the Stats rows', () => {
  it('are hidden without records, and nothing is written while rendering', () => {
    const write: ReturnType<typeof vi.spyOn> = vi.spyOn(Storage.prototype, 'setItem');
    render(<ConnectionFacts peerCid="12345678901234567890" firstContact={null} transferredBytes={null} />);
    expect(screen.queryByTestId('fact-first-contact')).toBeNull();
    expect(screen.queryByTestId('fact-transferred')).toBeNull();
    expect(screen.queryByText(/storage used/i)).toBeNull();
    expect(write).not.toHaveBeenCalled();
  });

  it('show the derived values when there are records', () => {
    render(<ConnectionFacts peerCid="12345678901234567890" firstContact={Date.UTC(2026, 0, 2)} transferredBytes={3072} />);
    expect(screen.getByTestId('fact-transferred')).toHaveTextContent('3');
    expect(screen.getByTestId('fact-first-contact')).toHaveTextContent(new Date(Date.UTC(2026, 0, 2)).toLocaleDateString());
  });
});
