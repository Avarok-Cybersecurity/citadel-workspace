/**
 * The UX review's findings on the send flow, each pinned where it was found:
 *  - a file chosen before the agent has said what it takes waits for the answer (7),
 *    and a failed question is said, not swallowed;
 *  - "Send to their storage" says it worked, and shows its own busy state (3);
 *  - its explanation is visible, not a hover title (6);
 *  - Send's label uses the primary's own foreground (4);
 *  - the sender's bubble Cancel names what it cancels and uses the bubble's foreground (5, 8).
 * Stand-ins: the agent's greeting and the storage call (the two I/O edges), and the toast.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, act, waitFor, fireEvent, renderHook } from '@testing-library/react';

const edge: { answer: () => Promise<boolean>; stored: boolean } = vi.hoisted(() => ({ answer: async () => true, stored: true }));
vi.mock('@/lib/agent-conversations/capabilities', async (importOriginal: () => Promise<Record<string, unknown>>) => ({
  ...(await importOriginal()),
  agentStagesUploads: (): Promise<boolean> => edge.answer(),
}));
vi.mock('@/lib/revfs/send-to-their-storage-io', () => ({ sendToTheirStorageNow: async (): Promise<boolean> => edge.stored }));
const toasted: string[] = vi.hoisted(() => []);
vi.mock('sonner', () => ({ toast: { success: (m: string): void => { toasted.push(m); }, error: (): void => undefined } }));

const { useFileTransfer } = await import('../useFileTransfer');
const { FileTransferModal } = await import('../FileTransferModal');
const { FileTransferBubble } = await import('../bubbles/FileTransferBubble');
import type { P2PMessage } from '@/lib/p2p';
import { fileTransferService } from '@/lib/file-transfer';
import type { FileTransfer } from '@/lib/file-transfer/types';

afterEach((): void => { cleanup(); toasted.length = 0; });

const MB: number = 1024 * 1024;
const chosen = (file: File): React.ChangeEvent<HTMLInputElement> =>
  ({ target: { files: [file] } }) as unknown as React.ChangeEvent<HTMLInputElement>;
const hook = (): ReturnType<typeof renderHook<ReturnType<typeof useFileTransfer>, unknown>> =>
  renderHook(() => useFileTransfer({ onClose: vi.fn(), onSendFile: vi.fn(async (): Promise<void> => undefined), peerCid: '42', isOpen: true }));

describe('a file chosen before the agent has answered', () => {
  it('waits for the answer, then is judged by it', async () => {
    let say: (v: boolean) => void = (): void => undefined;
    edge.answer = (): Promise<boolean> => new Promise((r) => { say = r; });
    const { result } = hook();
    act(() => result.current.handleInputChange(chosen(new File([new Uint8Array(40 * MB)], 'video.mov'))));
    expect(result.current.maxFileSizeBytes).toBeNull();
    expect(result.current.error).toBeNull();
    await act(async () => { say(true); });
    await waitFor(() => expect(result.current.selectedFile?.name).toBe('video.mov'));
    expect(result.current.error).toBeNull();
  });

  it('asks again each time the dialog opens, so reopening is a real retry', async () => {
    let asks: number = 0;
    edge.answer = async (): Promise<boolean> => { asks += 1; throw new Error('agent unreachable'); };
    const { result, rerender } = renderHook(({ open }: { open: boolean }) =>
      useFileTransfer({ onClose: vi.fn(), onSendFile: vi.fn(async (): Promise<void> => undefined), peerCid: '42', isOpen: open }), { initialProps: { open: true } });
    await waitFor(() => expect(result.current.ceilingFailure).not.toBeNull());
    rerender({ open: false });
    expect(result.current.ceilingFailure).toBeNull();
    edge.answer = async (): Promise<boolean> => { asks += 1; return true; };
    rerender({ open: true });
    await waitFor(() => expect(result.current.maxFileSizeBytes).toBe(2 * 1024 * MB));
    expect(result.current.ceilingFailure).toBeNull();
    expect(asks).toBe(2);
  });

  it('says so when the agent could not be asked', async () => {
    edge.answer = async (): Promise<boolean> => { throw new Error('agent unreachable'); };
    const { result } = hook();
    await waitFor(() => expect(result.current.ceilingFailure).toMatch(/agent unreachable.*16 MB/s));
  });
});

describe('the dialog', () => {
  it('reports a storage put, labels its own busy button, and explains it in sight', async () => {
    edge.answer = async (): Promise<boolean> => true;
    render(<FileTransferModal isOpen onClose={vi.fn()} onSendFile={vi.fn()} peerCid="42" />);
    const input: HTMLInputElement = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['abc'], 'notes.txt')] } });
    const storage: HTMLElement = await screen.findByTestId('send-to-their-storage');
    expect(storage.getAttribute('aria-describedby')).toBe('send-to-storage-help');
    expect(screen.getByText(/you must be online then/)).toBeVisible();
    expect(screen.getByRole('button', { name: /^send$/i }).className).toContain('text-primary-foreground');
    await waitFor(() => expect(storage).not.toBeDisabled());
    await act(async () => { fireEvent.click(storage); });
    await waitFor(() => expect(toasted).toEqual(['Put notes.txt in your shared storage']));
    // The agent-question notice is always in the tree, so its text is announced (re-review 4).
    expect(screen.getAllByRole('status').length).toBeGreaterThan(0);
  });
});

describe('the sender\'s bubble', () => {
  it('names what Cancel cancels, in the bubble\'s own foreground', () => {
    const message: P2PMessage = {
      id: 'm1', content: 'File transfer: a.bin', senderCid: 7n, recipientCid: 42n, timestamp: 1, status: 'sent',
      message_type: 'file_transfer', transfer_id: 'q1', file_name: 'a.bin', file_size: 3, transfer_state: 'pending',
    } as P2PMessage;
    // 'preparing' lives on the service's record (the stored entry says 'pending'), as in the app.
    (fileTransferService as unknown as { state: { setTransfer: (t: FileTransfer) => void } }).state.setTransfer({
      id: 'q1', fileName: 'a.bin', fileSize: 3, fileType: '', state: 'preparing', progress: 40,
      senderCid: '7', recipientCid: '42', createdAt: 0, updatedAt: 0, isIncoming: false,
    });
    render(<FileTransferBubble message={message} isOwn onCancel={(): void => undefined} />);
    const cancel: HTMLElement = screen.getByRole('button', { name: /cancel send/i });
    expect(cancel.className).toContain('text-primary-foreground');
    // Its status icon and progress fill take the bubble's foreground too (re-review 2).
    const bubble: HTMLElement = screen.getByTestId('file-transfer-bubble');
    expect(bubble.querySelector('svg.animate-spin')?.getAttribute('class')).toContain('text-primary-foreground');
    expect(bubble.querySelector('[role="progressbar"] > div')?.className).toContain('bg-primary-foreground');
  });
});
