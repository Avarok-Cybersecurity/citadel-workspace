/**
 * A file in Server Storage offers Download and Delete; and the folder and canvas
 * menus hold what the design gives them.
 *
 * Measured live: once the tenant stored uploads, a server file's menu offered only
 * Info, Rename, Cut and Copy. The menu listed the states that allow each action by
 * hand -- Download for Remote, Delete for Remote or Hosted -- and ServerStored, which
 * the download handler and isDownloadableState already accepted, was in neither.
 */
import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { VFSContextMenu } from '../VFSContextMenu';
import { RevfsFileState, SENT_FILES_DIR, type RevfsNode } from '@/types/revfs-types';
import { spyActions, type SpiedActions } from './grid-fixture';

function menuFor(node: RevfsNode | null, actions: SpiedActions = spyActions(), hasPasteItems: boolean = false): string[] {
  render(
    <VFSContextMenu node={node} folder="/" actions={actions} hasPasteItems={hasPasteItems} onStartRename={(): void => {}}>
      <div>target</div>
    </VFSContextMenu>,
  );
  fireEvent.contextMenu(screen.getByText('target'));
  return screen.getAllByRole('menuitem').map((item: HTMLElement): string => item.textContent ?? '');
}

const fileIn = (fileState: RevfsFileState): RevfsNode => ({ name: 'srv.bin', path: '/srv.bin', type: 'file', fileState, createdAt: 0, updatedAt: 0 });

describe('a file context menu', () => {
  it('lets the owner download and delete a server-stored file', () => {
    const items: string[] = menuFor(fileIn(RevfsFileState.ServerStored));
    expect(items.some((t: string) => /^Download/.test(t))).toBe(true);
    expect(items.some((t: string) => /^Delete/.test(t))).toBe(true);
  });

  // Downloadable since the uploader can be asked to send it (lib/revfs/request-share.ts);
  // before, the peer's file in shared storage could not be opened at all.
  it('offers a hosted file for download and for deletion', () => {
    const items: string[] = menuFor(fileIn(RevfsFileState.Hosted));
    expect(items.some((t: string) => /^Download/.test(t))).toBe(true);
    expect(items.some((t: string) => /^Delete/.test(t))).toBe(true);
  });

  it('copies a link to the file', () => {
    const actions: SpiedActions = spyActions();
    menuFor(fileIn(RevfsFileState.Remote), actions);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy link' }));
    expect(actions.copyLink).toHaveBeenCalledWith(expect.objectContaining({ path: '/srv.bin' }));
  });
});

describe('a folder context menu', () => {
  it('opens, shares, renames, moves and deletes an ordinary folder', () => {
    const items: string[] = menuFor({ name: 'Docs', path: '/Docs', type: 'directory', children: [], createdAt: 0, updatedAt: 0 });
    expect(items.map((t: string): string => t.replace(/(F2|Del)$/, ''))).toEqual(['Open', 'Share folder', 'Rename', 'Move to…', 'Delete']);
  });

  it('offers nothing that would change a seeded folder', () => {
    const items: string[] = menuFor({ name: 'Sent Files', path: SENT_FILES_DIR, type: 'directory', children: [], createdAt: 0, updatedAt: 0 });
    expect(items).toEqual(['Open', 'Share folder']);
  });
});

describe('the canvas menu', () => {
  it('creates, uploads and refreshes, and pastes only with something to paste', () => {
    expect(menuFor(null).map((t: string): string => t.replace(/(Ctrl\+V|⌘V)$/, ''))).toEqual(['New folder', 'Upload files', 'Refresh']);
  });

  it('pastes into the open folder', () => {
    const actions: SpiedActions = spyActions();
    menuFor(null, actions, true);
    fireEvent.click(screen.getByRole('menuitem', { name: /Paste/ }));
    expect(actions.paste).toHaveBeenCalledWith('/');
  });
});
