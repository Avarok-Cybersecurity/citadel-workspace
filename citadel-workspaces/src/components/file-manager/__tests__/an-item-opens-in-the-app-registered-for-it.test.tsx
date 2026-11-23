/**
 * The file manager opens a file in the app registered for its extension: the menu's "Open in
 * <app>" carries the app's icon and name, "Open with…" appears only when several apps claim the
 * extension, Download is always there, and activating a file no app opens downloads it with a
 * notice that says why.
 *
 * Actions are spies (grid-fixture) over the product's lookup; the second app below is a test
 * double for an opener that does not exist yet, so "several apps" can be shown at all.
 */
import { describe, expect, it, vi, type Mock } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { FileType } from 'lucide-react';
import { RevfsFileState, type RevfsNode } from '@/types/revfs-types';
import { BUILT_IN_OPENERS } from '@/lib/citadel-apps/openers/built-in-openers';
import type { FileOpener } from '@/lib/citadel-apps/openers/openers';
import { VFSContextMenu } from '../VFSContextMenu';
import { VFSInspector } from '../VFSInspector';
import { activateFile, openersOfNode } from '../file-openers';
import { spyActions, type SpiedActions } from './grid-fixture';

const file = (name: string): RevfsNode => ({ name, path: `/Reports/${name}`, type: 'file', fileState: RevfsFileState.Remote, createdAt: 0, updatedAt: 0 });
// A second app claiming .md, as an installed app would; only its name and icon are under test here.
const OTHER: FileOpener = { kind: 'installed', id: 'com.example.markdown', name: 'Other Markdown', icon: FileType, firstParty: false, opens: ['md'], maxBytes: 1024n, where: null };
const withOther = (actions: SpiedActions): SpiedActions => {
  actions.openersOf.mockImplementation((node: RevfsNode) => openersOfNode(node, [OTHER, ...BUILT_IN_OPENERS], null));
  return actions;
};

function openMenu(node: RevfsNode, actions: SpiedActions): string[] {
  render(<VFSContextMenu node={node} folder="/Reports" actions={actions} hasPasteItems={false} onStartRename={(): void => {}}><div>target</div></VFSContextMenu>);
  fireEvent.contextMenu(screen.getByText('target'));
  return screen.getAllByRole('menuitem').map((i: HTMLElement) => i.textContent ?? '');
}
// An entry's text carries its keyboard hint after the label (Download⌘D).
const hasEntry = (items: string[], label: string): boolean => items.some((t: string): boolean => t.startsWith(label));

describe('the file menu', () => {
  it('names the app and shows its icon, with Download beside it and no Open with… for one app', () => {
    const items: string[] = openMenu(file('notes.odt'), spyActions());
    expect(items).toContain('Open in Citadel Docs');
    expect(hasEntry(items, 'Download')).toBe(true);
    expect(screen.queryByRole('group', { name: 'Open with…' })).toBeNull();
    expect(screen.getByTestId('vfs-open-in-app').querySelector('svg.lucide-file-text')).not.toBeNull();
  });

  it('offers no Open for a file no app opens, and still Download', () => {
    const items: string[] = openMenu(file('archive.tar.gz'), spyActions());
    expect(items.some((t: string): boolean => t.startsWith('Open in'))).toBe(false);
    expect(hasEntry(items, 'Download')).toBe(true);
  });

  it('adds Open with… when several apps claim the extension, first-party first', () => {
    const actions: SpiedActions = withOther(spyActions());
    const items: string[] = openMenu(file('readme.md'), actions);
    expect(items).toContain('Open in Citadel Docs');
    const openWith: HTMLElement = screen.getByRole('group', { name: 'Open with…' });
    expect([...openWith.querySelectorAll('[role="menuitem"]')].map((i: Element) => i.textContent)).toEqual(['Citadel Docs', 'Other Markdown']);
  });

  it('shows every claiming app as an inspector button, 44 px, the preferred first', () => {
    render(<VFSInspector node={file('readme.md')} actions={withOther(spyActions())} peerName={null} storageName="Server Storage" from={null} modified="today" onClose={(): void => {}} />);
    expect(screen.getByTestId('vfs-inspector-open-in-app')).toHaveTextContent('Open in Citadel Docs');
    const other: HTMLElement = screen.getByTestId('vfs-inspector-open-with-app');
    expect(other).toHaveTextContent('Open in Other Markdown');
    expect(other.className).toContain('h-[44px]');
  });
});

describe('activating a file', () => {
  it('opens it in its app, without a notice', () => {
    const actions: SpiedActions = spyActions();
    const notify: Mock<(notice: string) => void> = vi.fn();
    activateFile(file('plan.DOCX'), actions, notify);
    expect(actions.openIn).toHaveBeenCalledWith(expect.objectContaining({ id: 'docs' }), expect.objectContaining({ name: 'plan.DOCX' }));
    expect(actions.download).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it('downloads a file no app opens, saying so', () => {
    const actions: SpiedActions = spyActions();
    const notify: Mock<(notice: string) => void> = vi.fn();
    activateFile(file('photo.xyz'), actions, notify);
    expect(actions.download).toHaveBeenCalledTimes(1);
    expect(actions.openIn).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith('Downloading instead — no app here opens .xyz files');
  });

  it('downloads a file whose bytes no app could read here without claiming no app opens it', () => {
    const actions: SpiedActions = spyActions();
    const notify: Mock<(notice: string) => void> = vi.fn();
    activateFile({ ...file('plan.docx'), fileState: RevfsFileState.Received }, actions, notify);
    expect(actions.download).toHaveBeenCalledTimes(1);
    expect(notify).not.toHaveBeenCalled();
  });
});
