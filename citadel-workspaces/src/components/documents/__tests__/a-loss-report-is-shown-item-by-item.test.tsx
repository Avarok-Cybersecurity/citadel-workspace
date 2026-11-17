/**
 * The import report of an opened file: a summary always in view, every entry behind a
 * disclosure, macros named with their size. And a Word file with macros, opened for real
 * (in-process runtime, real wasm), is not opened as a Docs document and offers no Download as.
 * The bar is given reports as data; the end-to-end case drives the production engine.
 */
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { inProcessRuntime } from '@/lib/cdoc/__tests__/wasm-rig';
import { fixture } from '@/lib/cdoc/__tests__/files-rig';
import type { ConversionReport } from '@/lib/cdoc/editor/file-formats';
import type { CdocRuntime } from '@/lib/cdoc/runtime';
import { recordingDocumentFiles, type RecordingDocumentFiles } from '@/test-utils/recording-document-files';
import { DocsDocumentBar } from '../page-view/DocsDocumentBar';
import { DocumentHost } from '../DocumentHost';
import type { DocumentEditing } from '../use-docs-document';

/** A file shown as the file manager shows it: read only, with no kept replica. */
const READ_ONLY: DocumentEditing = { kind: 'readOnly', reason: 'Read only here.' };

// Any fixed instant: nothing is downloaded here.
const FILES: RecordingDocumentFiles = recordingDocumentFiles('2026-10-18T00:00:00Z');
const LOSSY: ConversionReport = {
  losses: [
    { kind: 'counted', part: 'word/document.xml', what: 'w:rPr/w:spacing', count: 18, severity: 'minor', label: 'Character formatting simplified' },
    { kind: 'counted', part: 'word/document.xml', what: 'w:object', count: 1, severity: 'major', label: 'Embedded object not carried' },
    { kind: 'macros', part: 'word/vbaProject.bin', bytes: 12800n, severity: 'info', label: 'Macros removed' },
  ],
  problems: ['a style names a missing base'],
};

const bar = (importReport: ConversionReport): void => {
  render(<DocsDocumentBar title="report.docx" files={FILES} importReport={importReport} refused={false} exporter={null} />);
};

describe('the import report', () => {
  it('summarises, then lists every loss and problem when asked', () => {
    bar(LOSSY);
    expect(screen.getByRole('region', { name: 'Opening report.docx' })).toHaveTextContent('Opening report.docx: 3 things could not be carried over (1 changes what you see), 1 problem found.');
    const list: HTMLElement = screen.getByRole('list', { hidden: true });
    expect(list).not.toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Show details' }));
    expect(list).toBeVisible();
    expect(Array.from(list.querySelectorAll('li'), (li: HTMLLIElement) => li.textContent)).toEqual([
      'Character formatting simplified: w:rPr/w:spacing — word/document.xml (18 times)', 'Embedded object not carried: w:object — word/document.xml',
      'Macros removed, never run: word/vbaProject.bin (12800 bytes)', 'Problem: a style names a missing base',
    ]);
    expect(screen.getByRole('button', { name: 'Hide details' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('says nothing was lost when nothing was', () => {
    bar({ losses: [], problems: [] });
    expect(screen.getByRole('region', { name: 'Opening report.docx' })).toHaveTextContent('nothing was lost.');
    expect(screen.queryByRole('button', { name: 'Show details' })).toBeNull();
  });
});

describe('a Word file with macros', () => {
  it('is not opened, says why, names its macro parts and offers no Download as', async () => {
    render(
      <DocumentHost
        nodeId="m" appId="docs" title="budget.docx" permissions={{ edit: { enabled: false, reason: 'Read only here.' } }} files={FILES} original={null} commentAuthor={null} editing={READ_ONLY}
        documentSource={{ kind: 'file', format: 'docx', bytes: fixture('poi-simple-macro.docm') }}
        loadCdocRuntime={(): Promise<CdocRuntime> => Promise.resolve(inProcessRuntime('main-thread'))}
      />,
    );
    expect(await screen.findByTestId('page-view-refused')).toHaveTextContent('never runs or keeps');
    expect(screen.getByRole('region', { name: 'Why budget.docx was not opened' })).toBeInTheDocument();
    expect(screen.queryByTestId('docs-page-status')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show details' }));
    const items: string[] = screen.getAllByRole('listitem').map((li: HTMLElement) => li.textContent ?? '');
    expect(items).toContain('Macros removed, never run: word/vbaProject.bin (12800 bytes)');
    expect(screen.queryByRole('button', { name: 'Download as…' })).toBeNull();
  });
});

describe('the bar while a file opens', () => {
  const open = (bytes: Uint8Array): void => {
    render(
      <DocumentHost
        nodeId="o" appId="docs" title="report.docx" permissions={{ edit: { enabled: false, reason: 'Read only here.' } }} files={FILES} original={null} commentAuthor={null} editing={READ_ONLY}
        documentSource={{ kind: 'file', format: 'docx', bytes }}
        loadCdocRuntime={(): Promise<CdocRuntime> => Promise.resolve(inProcessRuntime('main-thread'))}
      />,
    );
  };

  it('holds the report\'s and the menu\'s places, so the pages below do not move when they arrive', async () => {
    open(fixture('textutil.docx'));
    // Checked in one go on the DOM change that shows them: the in-process open replaces them soon after.
    await waitFor((): void => {
      expect(screen.getByText('Opening report.docx…')).toBeInTheDocument();
      expect(screen.getByTestId('docs-download-as-pending')).toHaveAttribute('aria-disabled', 'true');
    });
    expect(await screen.findByTestId('docs-download-as')).toBeInTheDocument();
    expect(screen.queryByTestId('docs-download-as-pending')).toBeNull();
    expect(screen.queryByText('Opening report.docx…')).toBeNull();
  });

  it('gives both places up, and the page count, when the file fails to open', async () => {
    open(new TextEncoder().encode('not a Word file'));
    expect(await screen.findByTestId('page-view-error')).toBeInTheDocument();
    expect(screen.queryByTestId('docs-download-as-pending')).toBeNull();
    expect(screen.queryByText('Opening report.docx…')).toBeNull();
    expect(screen.queryByTestId('docs-page-status')).toBeNull();
  });
});
