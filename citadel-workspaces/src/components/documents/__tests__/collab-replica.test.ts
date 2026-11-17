/**
 * The workspace keeper loads the collaboration session on first use and hands its failures to
 * the page: outside a signed-in session it fails by name instead of opening a replica nobody
 * shares, and a page gone before the load finishes is left alone. No doubles: the real keeper,
 * the real (empty) session state of a test process.
 */
import { describe, expect, it, vi, type Mock } from 'vitest';
import type { EditorSession } from '@/lib/cdoc/editor/editor-session';
import { collaborationKeeper } from '../collab-replica';
import { saveControl } from '../save/save-control';

const neverOpened = (): Promise<EditorSession> => Promise.reject(new Error('the keeper opened a replica'));

describe('collaborationKeeper', () => {
  it('fails, by name, outside a signed-in session, and opens nothing', async () => {
    const show: Mock<(editor: EditorSession) => void> = vi.fn();
    const fail: Mock<(error: unknown) => void> = vi.fn();
    const open: Mock<() => Promise<EditorSession>> = vi.fn(neverOpened);
    collaborationKeeper('plan-1', saveControl('plan-1'))(open, show, fail);
    // The first load compiles the whole collaboration module graph; a cold vitest takes seconds.
    await vi.waitFor((): void => expect(fail).toHaveBeenCalledOnce(), { timeout: 15_000 });
    expect(String(fail.mock.calls[0][0])).toContain('signed-in session');
    expect(open).not.toHaveBeenCalled();
    expect(show).not.toHaveBeenCalled();
  });

  it('does nothing for a page torn down before the session loaded', async () => {
    const fail: Mock<(error: unknown) => void> = vi.fn();
    const release: () => void = collaborationKeeper('plan-1', saveControl('plan-1'))(neverOpened, vi.fn(), fail);
    release();
    await import('@/lib/cdoc/collab/replica-keeper');
    await new Promise<void>((resolve: () => void): void => { setTimeout(resolve, 0); });
    expect(fail).not.toHaveBeenCalled();
  });
});
