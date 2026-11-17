/**
 * There is one way to send a file: the Citadel protocol. The dialog used to
 * offer "Send File (Recommended)" and "P2P Only Transfer", two names for what
 * became one mechanism, and the chat settings a third choice nothing read.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FileTransferModal } from '../FileTransferModal';
import { MAX_QUEUED_BYTES, MAX_QUEUED_FILES } from '@/lib/file-transfer/send-queue';
import { formatBytes } from '@/lib/format-bytes';
import { MAX_BYTE_CONTENTS_BYTES } from '@/lib/file-transfer/server-upload';

// The agent's greeting is the edge: an agent that does not stage (the inline route).
vi.mock('@/lib/agent-conversations/capabilities', async (importOriginal: () => Promise<Record<string, unknown>>) => ({
  ...(await importOriginal()),
  agentStagesUploads: async (): Promise<boolean> => false,
}));

describe('the send dialog', () => {
  it('offers no transfer method, one Send, and the real size ceiling', async () => {
    render(<FileTransferModal isOpen onClose={vi.fn()} onSendFile={vi.fn()} peerCid="42" />);

    expect(screen.queryByText(/transfer method/i)).toBeNull();
    expect(screen.queryByText(/P2P Only/i)).toBeNull();
    expect(screen.queryByText(/Recommended/i)).toBeNull();
    expect(screen.getAllByRole('button', { name: /^Send$/ })).toHaveLength(1);
    const limit: string = `${MAX_BYTE_CONTENTS_BYTES / (1024 * 1024)} MB`;
    // Said once the agent has answered (no agent here: the inline route).
    expect(await screen.findByText(new RegExp(`Maximum size: ${limit}`))).toBeInTheDocument();
  });
});

describe('Send to their storage', () => {
  it('is a separate action, offered only once a file is chosen', () => {
    render(<FileTransferModal isOpen onClose={vi.fn()} onSendFile={vi.fn()} peerCid="42" />);
    const action: HTMLElement = screen.getByTestId('send-to-their-storage');
    expect(action).toHaveTextContent('Send to their storage');
    expect(action).toBeDisabled();
  });
});

describe('the offline hold', () => {
  it('states its limit before a send is committed, from the limit the queue enforces', async () => {
    render(<FileTransferModal isOpen onClose={vi.fn()} onSendFile={vi.fn()} peerCid="42" />);
    expect(screen.getByTestId('offline-hold-note').textContent)
      .toBe(`If they are offline, it waits in this browser and goes when they are back: up to ${MAX_QUEUED_FILES} files, ${formatBytes(MAX_QUEUED_BYTES)} in all.`);
    expect(formatBytes(MAX_QUEUED_BYTES)).toBe('512 MB');
  });
});
