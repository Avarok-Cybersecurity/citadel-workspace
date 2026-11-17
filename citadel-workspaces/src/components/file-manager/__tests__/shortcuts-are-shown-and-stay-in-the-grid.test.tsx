/**
 * The file manager's keyboard shortcuts are discoverable, and do not fire from
 * inside a dialog; and selecting a file does not download it.
 *
 * - F2, Delete and Ctrl+X/C/V/A worked, and nothing on screen said so.
 * - With a dialog open over the grid, Delete and Backspace reached the grid's
 *   document-level handler and acted on the selection behind the dialog.
 * - A single click on a file both selected it and started a download, so
 *   selecting a file to cut or inspect pulled it from the peer.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RevfsFileState, type RevfsNode } from '@/types/revfs-types';
import { VFSContentGrid, type ContentView } from '../VFSContentGrid';
import { shortcutLabel, VFS_SHORTCUTS, matchesShortcut } from '../vfs-shortcuts';
import { gridProps, spyActions, type SpiedActions } from './grid-fixture';

function file(name: string): RevfsNode {
  return {
    name, path: `/${name}`, type: 'file', fileState: RevfsFileState.Remote, createdAt: 0, updatedAt: 0,
    fileMetadata: { fileId: name, fileName: name, fileSize: 1, fileType: '', virtualDirectory: `/${name}`, uploadedByCid: 1n },
  };
}
const tree: RevfsNode = { name: '', path: '/', type: 'directory', children: [file('a.txt')], createdAt: 0, updatedAt: 0 };

function grid(actions: SpiedActions, selected: Set<string>, onSelect: ReturnType<typeof vi.fn> = vi.fn(), view: ContentView = 'list'): void {
  render(
    <>
      <VFSContentGrid {...gridProps(tree, { actions, selectedPaths: selected, onSelect, view })} />
      <div role="dialog"><button>Cancel</button></div>
    </>,
  );
}

describe('the shortcuts', () => {
  it('delete the selection', () => {
    const actions: SpiedActions = spyActions();
    grid(actions, new Set(['/a.txt']));
    fireEvent.keyDown(document.body, { key: 'Delete' });
    expect(actions.remove).toHaveBeenCalledTimes(1);
  });

  it('do nothing when the key was pressed inside a dialog', () => {
    const actions: SpiedActions = spyActions();
    grid(actions, new Set(['/a.txt']));
    fireEvent.keyDown(screen.getByRole('button', { name: 'Cancel' }), { key: 'Backspace' });
    fireEvent.keyDown(screen.getByRole('button', { name: 'Cancel' }), { key: 'Delete' });
    expect(actions.remove).not.toHaveBeenCalled();
  });

  it('are named in the file menu with the keys the handler answers', () => {
    grid(spyActions(), new Set());
    fireEvent.contextMenu(screen.getByText('a.txt'));
    const names: string[] = screen.getAllByRole('menuitem').map((m: HTMLElement): string => m.textContent ?? '');
    expect(names.map((n: string): string => n.replace(/(Space|Ctrl\+D|F2|Del)$/, ''))).toEqual(
      ['Preview', 'Open in Citadel Docs', 'Download', 'Share…', 'Rename', 'Move to…', 'Copy link', 'Delete'],
    );
    const rename: HTMLElement = screen.getByRole('menuitem', { name: /Rename/ });
    expect(rename).toHaveTextContent('F2');
    expect(rename).toHaveAttribute('aria-keyshortcuts', 'F2');
    expect(screen.getByRole('menuitem', { name: /Preview/ })).toHaveTextContent('Space');
    expect(screen.getByRole('menuitem', { name: /^Download/ })).toHaveTextContent(shortcutLabel(VFS_SHORTCUTS.download, false));
    expect(screen.getByRole('menuitem', { name: /^Delete/ })).toHaveTextContent('Del');
  });

  it('label the modifier the platform uses', () => {
    expect(shortcutLabel(VFS_SHORTCUTS.paste, true)).toBe('⌘V');
    expect(shortcutLabel(VFS_SHORTCUTS.paste, false)).toBe('Ctrl+V');
    expect(matchesShortcut({ key: 'v', ctrlKey: false, metaKey: true }, VFS_SHORTCUTS.paste)).toBe(true);
    expect(matchesShortcut({ key: 'v', ctrlKey: false, metaKey: false }, VFS_SHORTCUTS.paste)).toBe(false);
  });
});

describe('every shortcut a menu names', () => {
  it('reaches its action', () => {
    const actions: SpiedActions = spyActions();
    const onSelectAll: ReturnType<typeof vi.fn> = vi.fn();
    const onClearSelection: ReturnType<typeof vi.fn> = vi.fn();
    render(<VFSContentGrid {...gridProps(tree, { actions, selectedPaths: new Set(['/a.txt']), hasPasteItems: true, onSelectAll, onClearSelection })} />);
    fireEvent.keyDown(document.body, { key: 'c', ctrlKey: true });
    fireEvent.keyDown(document.body, { key: 'x', metaKey: true });
    fireEvent.keyDown(document.body, { key: 'v', ctrlKey: true });
    fireEvent.keyDown(document.body, { key: 'd', ctrlKey: true });
    fireEvent.keyDown(document.body, { key: 'a', ctrlKey: true });
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(actions.copy).toHaveBeenCalledTimes(1);
    expect(actions.cut).toHaveBeenCalledTimes(1);
    expect(actions.paste).toHaveBeenCalledWith('/');
    expect(actions.download).toHaveBeenCalledTimes(1);
    expect(onSelectAll).toHaveBeenCalledTimes(1);
    expect(onClearSelection).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document.body, { key: 'F2' });
    expect(screen.getByRole('textbox')).toHaveValue('a.txt');
  });
});

describe('opening a file', () => {
  it.each<ContentView>(['list', 'grid'])('is not what a click does in the %s: a click selects', (view: ContentView) => {
    const actions: SpiedActions = spyActions();
    const onSelect: ReturnType<typeof vi.fn> = vi.fn();
    grid(actions, new Set(), onSelect, view);
    fireEvent.click(screen.getByText('a.txt'));
    expect(onSelect).toHaveBeenCalledWith('/a.txt', 'replace', ['/a.txt']);
    expect(actions.openFile).not.toHaveBeenCalled();
  });

  it('extends or toggles the selection with a modifier', () => {
    const onSelect: ReturnType<typeof vi.fn> = vi.fn();
    grid(spyActions(), new Set(), onSelect);
    fireEvent.click(screen.getByText('a.txt'), { metaKey: true });
    fireEvent.click(screen.getByText('a.txt'), { shiftKey: true });
    expect(onSelect.mock.calls.map((c: unknown[]) => c[1])).toEqual(['toggle', 'range']);
  });

  it('is what a double-click or Enter does', () => {
    const actions: SpiedActions = spyActions();
    grid(actions, new Set());
    fireEvent.doubleClick(screen.getByText('a.txt'));
    fireEvent.keyDown(screen.getByTitle(/a\.txt/), { key: 'Enter' });
    expect(actions.openFile).toHaveBeenCalledTimes(2);
  });
});
