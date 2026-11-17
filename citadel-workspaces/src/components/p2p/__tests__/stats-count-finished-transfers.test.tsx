/**
 * The chat's Stats tab counts the files that were actually transferred.
 *
 * Two defects gave "0 Files Transferred" after a completed transfer:
 *
 * - The history is stored under an account-scoped key and loaded at import,
 *   before the tab knows its account, so after a reload no transfer record
 *   existed at all and nothing read the scoped key later.
 * - The count was every record of any state, taken once as the panel opened.
 */
import { describe, it, expect } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { instanceManager } from '@/lib/multi-instance';
import { fileTransferService } from '@/lib/file-transfer';
import { useChatSettings } from '../useChatSettings';

function record(id: string, state: string): Record<string, unknown> {
  const now: number = Date.now();
  return {
    id, fileName: `${id}.pdf`, fileSize: 10, senderCid: '7', recipientCid: '42',
    state, isIncoming: false, mode: 'p2p', createdAt: now, updatedAt: now,
  };
}

describe('Stats after a reload', () => {
  it('counts the finished transfer this account made, and not the declined one', async () => {
    // What a previous page load wrote for account 7.
    localStorage.setItem('citadel:file-transfers:7', JSON.stringify({
      done: record('done', 'complete'),
      refused: record('refused', 'declined'),
    }));
    // The service loaded at import, with no account yet.
    await fileTransferService.initialize();

    // Then the tab learns who it is.
    instanceManager.setCid(7n);

    const { result } = renderHook(() => useChatSettings(true, '42'));
    await waitFor(() => expect(result.current.stats.files).toBe(1));
  });
});
