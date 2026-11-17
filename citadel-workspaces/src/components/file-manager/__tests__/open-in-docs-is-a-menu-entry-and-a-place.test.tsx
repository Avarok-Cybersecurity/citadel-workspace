/**
 * Opening in Citadel Docs is reachable without hover: a context-menu entry and an inspector
 * button (44 px) for a file Docs reads, and none for one it does not. Opening names the file in
 * the address, so a link opens the document, and Back returns to the folder.
 *
 * Actions are spies (grid-fixture): what is under test is which action a control reaches.
 */
import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { RevfsFileState, type RevfsNode } from '@/types/revfs-types';
import { VFSContextMenu } from '../VFSContextMenu';
import { VFSInspector } from '../VFSInspector';
import { useFileManagerPlace, type FileManagerPlace } from '../useFileManagerPlace';
import { spyActions, type SpiedActions } from './grid-fixture';
import { docsOpenAction } from '../docs-file-open';
import type { VFSItemActions } from '../vfs-item-actions';

const file = (name: string): RevfsNode => ({ name, path: `/Reports/${name}`, type: 'file', fileState: RevfsFileState.Remote, createdAt: 0, updatedAt: 0 });

function menuItems(node: RevfsNode, actions: VFSItemActions): string[] {
  render(<VFSContextMenu node={node} folder="/Reports" actions={actions} hasPasteItems={false} onStartRename={(): void => {}}><div>target</div></VFSContextMenu>);
  fireEvent.contextMenu(screen.getByText('target'));
  return screen.getAllByRole('menuitem').map((i: HTMLElement) => i.textContent ?? '');
}

describe('Open in Citadel Docs', () => {
  it('is in the context menu of a .docx and opens it', () => {
    const actions: SpiedActions = spyActions();
    expect(menuItems(file('plan.docx'), actions)).toContain('Open in Citadel Docs');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open in Citadel Docs' }));
    expect(actions.openInDocs).toHaveBeenCalledWith(expect.objectContaining({ path: '/Reports/plan.docx' }));
  });

  it('is not offered for a file Docs does not read', () => {
    expect(menuItems(file('photo.png'), spyActions())).not.toContain('Open in Citadel Docs');
  });

  it('is not offered, anywhere, for a file that is a local record rather than stored', () => {
    const actions: VFSItemActions = spyActions();
    const received: RevfsNode = { ...file('plan.docx'), fileState: RevfsFileState.Received };
    expect(docsOpenAction(actions, received)).toBeNull();
    expect(menuItems(received, actions)).not.toContain('Open in Citadel Docs');
    render(<VFSInspector node={received} actions={actions} peerName={null} storageName="Server Storage" from={null} modified="today" onClose={(): void => {}} />);
    expect(screen.queryByTestId('vfs-inspector-open-in-docs')).toBeNull();
  });

  it('is the inspector\'s first action, 44 px tall', () => {
    const actions: SpiedActions = spyActions();
    render(<VFSInspector node={file('notes.txt')} actions={actions} peerName={null} storageName="Server Storage" from={null} modified="today" onClose={(): void => {}} />);
    const open: HTMLElement = screen.getByTestId('vfs-inspector-open-in-docs');
    expect(open.className).toContain('h-[44px]');
    fireEvent.click(open);
    expect(actions.openInDocs).toHaveBeenCalledTimes(1);
  });
});

describe('the address of an opened file', () => {
  const wrapper = ({ children }: { children: ReactNode }): JSX.Element => (
    <MemoryRouter initialEntries={['/workspace?section=files&peer_id=server&path=%2FReports']}>{children}</MemoryRouter>
  );

  it('names the file, and Back returns to its folder', () => {
    const { result } = renderHook(() => ({ place: useFileManagerPlace(1n), search: useLocation().search, navigate: useNavigate() }), { wrapper });
    act(() => result.current.place.openFile('/Reports/plan.docx'));
    const opened: FileManagerPlace = result.current.place;
    expect(opened.path).toBe('/Reports/plan.docx');
    expect(new URLSearchParams(result.current.search).get('path')).toBe('/Reports/plan.docx');
    act(() => result.current.navigate(-1));
    expect(result.current.place.path).toBe('/Reports');
  });
});
