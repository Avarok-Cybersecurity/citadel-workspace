/**
 * DocumentHost's contract: the node and app it was given, the title, the region an editor
 * mounts in, the status bar it reserves, and a read-only notice when editing is not permitted.
 * No mocks: the Docs editor region runs the real cdoc wasm through the in-process runtime.
 */
import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { inProcessRuntime } from '@/lib/cdoc/__tests__/wasm-rig';
import type { CdocRuntime } from '@/lib/cdoc/runtime';
import { recordingDocumentFiles } from '@/test-utils/recording-document-files';
import { DocumentHost, UnreadableDocument, type DocumentHostProps } from '../DocumentHost';
import { keepBlankReplica } from '../blank-replica';
import type { DocumentEditing } from '../use-docs-document';
import { saveControl, type BindableSaveControl } from '../save/save-control';

const EDIT_BLANK: DocumentEditing = { kind: 'replica', keep: keepBlankReplica, save: null, pictures: null };

const EDITABLE: DocumentHostProps = {
  nodeId: 'plan-1',
  appId: 'docs',
  title: 'Quarterly plan',
  permissions: { edit: { enabled: true, reason: null } },
  documentSource: { kind: 'blank' },
  loadCdocRuntime: (): Promise<CdocRuntime> => Promise.resolve(inProcessRuntime('main-thread')),
  // Any signed-in name: these tests are about the host, not who signs a comment.
  commentAuthor: 'Ada',
  // Any fixed instant: these tests download nothing.
  files: recordingDocumentFiles('2026-10-17T00:00:00Z'),
  original: null,
  editing: EDIT_BLANK,
};

describe('DocumentHost', () => {
  it('shows the document title and its app, and marks the editor region', () => {
    render(<DocumentHost {...EDITABLE} />);
    const host: HTMLElement = screen.getByTestId('document-host');
    expect(host).toHaveAttribute('data-node-id', 'plan-1');
    expect(host).toHaveAttribute('data-app', 'docs');
    expect(screen.getByRole('heading', { name: 'Quarterly plan' })).toBeInTheDocument();
    expect(screen.queryByTestId('document-read-only')).toBeNull();
  });

  it('mounts the Citadel Docs page view on the blank document, with its page and zoom in the status bar', async () => {
    render(<DocumentHost {...EDITABLE} />);
    const editor: HTMLElement = screen.getByRole('region', { name: 'Citadel Docs editor' });
    expect(await within(editor).findByRole('group', { name: 'Page 1 of 1' })).toBeInTheDocument();
    const bar: HTMLElement = screen.getByTestId('document-status-bar');
    expect(await within(bar).findByText('Page 1 of 1')).toBeInTheDocument();
    expect(within(bar).getByRole('slider', { name: 'Zoom' })).toHaveValue('100');
  });

  it('keeps the placeholder for an app with no editor yet', () => {
    render(<DocumentHost {...EDITABLE} appId="pdf" />);
    expect(screen.getByRole('region', { name: 'Citadel PDF editor' })).toHaveTextContent('Citadel PDF editor loads here');
  });

  it('puts the save controls in the title bar of a document someone saves, and Ctrl/Cmd+S over its editor to them', () => {
    const save: BindableSaveControl = saveControl('plan-1');
    save.inputs.set({ autoSave: true, link: 'up', unacknowledged: 0, syncRequested: false, local: 'written', halted: false, locked: false });
    render(<DocumentHost {...EDITABLE} editing={{ kind: 'replica', keep: keepBlankReplica, save, pictures: null }} />);
    const header: HTMLElement = screen.getByRole('banner');
    expect(within(header).getByTestId('docs-save-status')).toHaveAttribute('data-status', 'saved');
    const region: HTMLElement = screen.getByRole('region', { name: 'Citadel Docs editor' });
    // Kept from the browser's "save page", whatever there is to save.
    expect(fireEvent.keyDown(region, { key: 's', ctrlKey: true })).toBe(false);
  });

  it('has no save controls for a replica nobody saves', () => {
    render(<DocumentHost {...EDITABLE} />);
    expect(screen.queryByTestId('docs-save-controls')).toBeNull();
    expect(fireEvent.keyDown(screen.getByRole('region', { name: 'Citadel Docs editor' }), { key: 's', ctrlKey: true })).toBe(true);
  });

  it('says it is read only, and why, when editing is not permitted', () => {
    render(<DocumentHost {...EDITABLE} permissions={{ edit: { enabled: false, reason: "You don't have permission to edit this content" } }} />);
    expect(screen.getByTestId('document-read-only')).toHaveTextContent("Read only. You don't have permission to edit this content");
  });

  it('names an app it cannot read without opening anything', () => {
    render(<UnreadableDocument title="From the future" reason="The document's app record is version 2." />);
    expect(screen.getByRole('alert')).toHaveTextContent('version 2');
    expect(screen.queryByTestId('document-editor-region')).toBeNull();
  });
});
