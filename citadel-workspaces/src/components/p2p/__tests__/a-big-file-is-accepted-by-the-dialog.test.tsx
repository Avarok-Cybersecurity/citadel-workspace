/**
 * The Send dialog takes a file up to the agent's real ceiling and refuses a larger
 * one at once, saying why and what works -- never a file the send would then refuse.
 * 40 MB: fine through an agent that stages uploads; through an older one, refused
 * with the 16 MB limit named. The agent's greeting is the one stand-in.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const agent: { stages: boolean } = vi.hoisted(() => ({ stages: true }));
vi.mock('@/lib/agent-conversations/capabilities', async (importOriginal: () => Promise<Record<string, unknown>>) => ({
  ...(await importOriginal()),
  agentStagesUploads: async (): Promise<boolean> => agent.stages,
}));

const { useFileTransfer } = await import('../useFileTransfer');

const MB: number = 1024 * 1024;
/** What the file input hands over when a file is chosen. */
const chosen = (file: File): React.ChangeEvent<HTMLInputElement> =>
  ({ target: { files: [file] } }) as unknown as React.ChangeEvent<HTMLInputElement>;

const video: File = new File([new Uint8Array(40 * MB)], 'video.mov', { type: 'video/quicktime' });

function dialog(): ReturnType<typeof renderHook<ReturnType<typeof useFileTransfer>, unknown>> {
  return renderHook(() => useFileTransfer({ onClose: vi.fn(), onSendFile: vi.fn(async (): Promise<void> => undefined), peerCid: '42', isOpen: true }));
}

describe('the Send dialog', () => {
  it('takes a 40 MB file and shows the 2 GB ceiling through a staging agent', async () => {
    agent.stages = true;
    const { result } = dialog();
    await waitFor(() => expect(result.current.maxFileSizeBytes).toBe(2 * 1024 * MB));
    act(() => result.current.handleInputChange(chosen(video)));
    expect(result.current.error).toBeNull();
    expect(result.current.selectedFile).toBe(video);
  });

  it('refuses it, naming the limit and the way that works, through an older agent', async () => {
    agent.stages = false;
    const { result } = dialog();
    await waitFor(() => expect(result.current.maxFileSizeBytes).toBe(16 * MB));
    act(() => result.current.handleInputChange(chosen(video)));
    expect(result.current.selectedFile).toBeNull();
    expect(result.current.error).toMatch(/up to 16 MB.*Browse Files/s);
  });
});
