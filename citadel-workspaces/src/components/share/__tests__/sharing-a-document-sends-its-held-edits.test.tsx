/**
 * Sharing a document asks for its edits held on this device to be sent (an open session's
 * Save, lib/document-sync-requests.ts); sharing anything else asks nothing. The production
 * launcher and registry; the session is a registered sync that records the request.
 */
import { act, renderHook, type RenderHookResult } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { registerDocumentSync } from '@/lib/document-sync-requests';
import { useShareLauncher, type ShareLauncher } from '../use-share-launcher';

function launcherWithOpenDocument(nodeId: string): { launcher: () => ShareLauncher; asked: string[]; close: () => void } {
  const asked: string[] = [];
  const close: () => void = registerDocumentSync({ nodeId, chatDoc: null }, (): Promise<void> => { asked.push(nodeId); return Promise.resolve(); });
  const view: RenderHookResult<ShareLauncher, unknown> = renderHook(useShareLauncher);
  return { launcher: (): ShareLauncher => view.result.current, asked, close };
}

describe('sharing', () => {
  it('a document sends the edits this device holds of it', () => {
    const { launcher, asked, close } = launcherWithOpenDocument('doc-1');
    act((): void => launcher().open({ kind: 'node', nodeId: 'doc-1', name: 'Plan' }));
    expect(asked).toEqual(['doc-1']);
    expect(launcher().dialog).not.toBeNull();
    close();
  });

  it('a file, a chat or another node asks nothing of that document', () => {
    const { launcher, asked, close } = launcherWithOpenDocument('doc-2');
    act((): void => launcher().open({ kind: 'peer-chat', peerUsername: 'bob', peerName: 'Bob' }));
    act((): void => launcher().open({ kind: 'directory', nodeId: 'doc-2', name: 'Directory' }));
    expect(asked).toEqual([]);
    close();
  });
});
