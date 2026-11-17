/**
 * "Download as…" on a file opened read-only, end to end in the page: the menu (reached by keyboard)
 * lists every format, the file's read-only replica writes the chosen one, and the bytes
 * are handed to the save port with the format's MIME type and a name from the title; what the
 * format dropped is shown, and a document being edited downloads from its live replica.
 * Real cdoc wasm through the in-process runtime. The one double is the save port
 * (recording-document-files): jsdom has no Blob URLs or downloads to observe.
 */
import { describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { inProcessRuntime } from '@/lib/cdoc/__tests__/wasm-rig';
import type { CdocRuntime } from '@/lib/cdoc/runtime';
import { recordingDocumentFiles, type RecordingDocumentFiles } from '@/test-utils/recording-document-files';
import type { DocumentSource } from '@/lib/cdoc/document-source';
import { DocumentHost } from '../DocumentHost';
import { keepBlankReplica } from '../blank-replica';
import type { DocumentEditing } from '../use-docs-document';
import { DownloadAsMenu } from '../page-view/DownloadAsMenu';

const FILE: DocumentSource = { kind: 'file', format: 'md', bytes: new TextEncoder().encode('# Quarterly plan\n\nShip **open** and *export*.\n') };

/** A file opens as the file manager opens it, read only; a blank document is edited through a kept replica. */
const READ_ONLY: DocumentEditing = { kind: 'readOnly', reason: 'Read only here.' };
const EDIT_BLANK: DocumentEditing = { kind: 'replica', keep: keepBlankReplica, save: null, pictures: null };

function host(files: RecordingDocumentFiles, documentSource: DocumentSource = FILE): void {
  const editing: DocumentEditing = documentSource.kind === 'blank' ? EDIT_BLANK : READ_ONLY;
  render(
    <DocumentHost
      nodeId="plan-1" appId="docs" title="Quarterly plan" permissions={{ edit: editing.kind === 'readOnly' ? { enabled: false, reason: editing.reason } : { enabled: true, reason: null } }}
      documentSource={documentSource} files={files} original={null} commentAuthor="Ada" editing={editing}
      loadCdocRuntime={(): Promise<CdocRuntime> => Promise.resolve(inProcessRuntime('main-thread'))}
    />,
  );
}

/** The menu's trigger once the document has opened (a placeholder holds its place until then). */
async function trigger(): Promise<HTMLElement> {
  const found: HTMLElement = await screen.findByTestId('docs-download-as');
  expect(found).toHaveAccessibleName('Download as…');
  return found;
}

async function choose(label: RegExp): Promise<void> {
  const trigger_: HTMLElement = await trigger();
  trigger_.focus();
  await userEvent.keyboard('{Enter}');
  await userEvent.click(await screen.findByRole('menuitem', { name: label }));
}

const text = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

describe('Download as…', () => {
  it('lists the six formats', async () => {
    host(recordingDocumentFiles('2026-10-18T00:00:00Z'));
    (await trigger()).focus();
    await userEvent.keyboard('{Enter}');
    const items: string[] = (await screen.findAllByRole('menuitem')).map((i: HTMLElement) => i.textContent ?? '');
    expect(items).toEqual(['Word document (.docx)', 'Word template (.dotx)', 'OpenDocument text (.odt)', 'Markdown (.md)', 'Plain text (.txt)', 'PDF (.pdf)']);
  });

  it('saves Markdown under the title with its MIME type, and shows the export report', async () => {
    const files: RecordingDocumentFiles = recordingDocumentFiles('2026-10-18T00:00:00Z');
    host(files);
    await choose(/Markdown/);
    await waitFor(() => expect(files.saved).toHaveLength(1));
    expect(files.saved[0]).toMatchObject({ name: 'Quarterly plan.md', mime: 'text/markdown' });
    expect(text(files.saved[0].bytes)).not.toContain('{');
    const report: HTMLElement = await screen.findByTestId('docs-export-report');
    expect(report).toHaveTextContent('Downloaded Quarterly plan.md: 1 thing could not be carried over.');
    expect(within(report).getByText('Layout simplified: section page setup — markdown')).toBeInTheDocument();
  });

  it('announces progress and the download, keeps focus on the trigger and the document in view of assistive tech', async () => {
    const files: RecordingDocumentFiles = recordingDocumentFiles('2026-10-18T00:00:00Z');
    host(files);
    const opened: HTMLElement = await trigger();
    const status: HTMLElement = screen.getByTestId('docs-export-status');
    expect(status).toHaveAttribute('role', 'status');
    expect(status).toHaveTextContent('');
    opened.focus();
    await userEvent.keyboard('{Enter}');
    await screen.findAllByRole('menuitem');
    expect(screen.getByTestId('docs-document-bar').closest('[aria-hidden="true"]')).toBeNull();
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{Enter}');
    await waitFor(() => expect(files.saved).toHaveLength(1));
    expect(status).toHaveTextContent('Downloaded Quarterly plan.md.');
    expect(document.activeElement).toBe(opened);
  });

  it('saves a PDF with the time the save port gives', async () => {
    const files: RecordingDocumentFiles = recordingDocumentFiles('2031-02-03T04:05:06Z');
    host(files);
    await choose(/PDF/);
    await waitFor(() => expect(files.saved).toHaveLength(1));
    expect(files.saved[0]).toMatchObject({ name: 'Quarterly plan.pdf', mime: 'application/pdf' });
    expect(text(files.saved[0].bytes)).toContain('20310203');
    // What the e2e spec reads: the name alone, since the PDF writer reports nothing to list.
    expect(await screen.findByTestId('docs-export-report')).toHaveTextContent(/^Downloaded Quarterly plan\.pdf$/);
    expect(screen.getByTestId('docs-export-status')).toHaveTextContent(/^Downloaded Quarterly plan\.pdf\.$/);
  });

  it('saves a .docx as a zip package', async () => {
    const files: RecordingDocumentFiles = recordingDocumentFiles('2026-10-18T00:00:00Z');
    host(files);
    await choose(/Word document/);
    await waitFor(() => expect(files.saved).toHaveLength(1));
    expect(files.saved[0].mime).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(text(files.saved[0].bytes.slice(0, 2))).toBe('PK');
  });

  it('saves an .odt package', async () => {
    const files: RecordingDocumentFiles = recordingDocumentFiles('2026-10-18T00:00:00Z');
    host(files);
    await choose(/OpenDocument/);
    await waitFor(() => expect(files.saved).toHaveLength(1));
    expect(files.saved[0]).toMatchObject({ name: 'Quarterly plan.odt', mime: 'application/vnd.oasis.opendocument.text' });
  });

  it('downloads a document being edited from the live replica', async () => {
    const files: RecordingDocumentFiles = recordingDocumentFiles('2026-10-18T00:00:00Z');
    host(files, { kind: 'blank' });
    await choose(/Markdown/);
    await waitFor(() => expect(files.saved).toHaveLength(1));
    expect(files.saved[0]).toMatchObject({ name: 'Quarterly plan.md', mime: 'text/markdown' });
    expect(screen.queryByTestId('docs-export-error')).toBeNull();
    expect(within(screen.getByTestId('docs-document-bar')).getByRole('button', { name: 'Download as…' })).toBeEnabled();
  });

  it('downloads a PDF of a document being edited, through the PDF artefact, with nothing to report', async () => {
    const files: RecordingDocumentFiles = recordingDocumentFiles('2026-10-18T00:00:00Z');
    host(files, { kind: 'blank' });
    await choose(/PDF/);
    await waitFor(() => expect(files.saved).toHaveLength(1));
    expect(text(files.saved[0].bytes.slice(0, 5))).toBe('%PDF-');
    expect(await screen.findByTestId('docs-export-report')).toHaveTextContent('Downloaded Quarterly plan.pdf');
  });
});

describe('Download as… while a download is being written', () => {
  it('stays focusable, so focus can return to it, and its entries wait', async () => {
    const chosen: string[] = [];
    render(<DownloadAsMenu state={{ kind: 'exporting', format: 'pdf' }} onExport={(format): void => { chosen.push(format); }} />);
    const trigger: HTMLElement = screen.getByRole('button', { name: 'Preparing .pdf…' });
    trigger.focus();
    expect(document.activeElement).toBe(trigger);
    expect(trigger).toHaveAttribute('aria-disabled', 'true');
    await userEvent.keyboard('{Enter}');
    const items: HTMLElement[] = await screen.findAllByRole('menuitem');
    expect(items.every((i: HTMLElement): boolean => i.getAttribute('aria-disabled') === 'true')).toBe(true);
    await userEvent.click(items[0]);
    expect(chosen).toEqual([]);
  });
});
