/**
 * The banner over a chat document that moved to Citadel Docs: its loss report (the shared
 * ConversionReportPanel, every entry), a conflict said in words, and "Show original" laid out
 * for real by the engine from the static `pm` source (in-process runtime, real wasm), or shown
 * as text with a .txt download when the mapper could not make Docs JSON.
 */
import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as Y from 'yjs';
import { inProcessRuntime, pmWithText } from '@/lib/cdoc/__tests__/wasm-rig';
import type { CdocRuntime } from '@/lib/cdoc/runtime';
import type { ConversionReport } from '@/lib/cdoc/editor/file-formats';
import { recordingDocumentFiles, type RecordingDocumentFiles } from '@/test-utils/recording-document-files';
import { migrationReport, originalDocument, type OriginalDocument } from '@/lib/live-doc-migration/migration-report';
import { CONFLICT_VERSION, type ConflictRecord } from '@/lib/live-doc-migration/conflict-record';
import { MARKER_VERSION, type MigrationMarker } from '@/lib/live-doc-migration/marker';
import { walkYjsState } from '@/lib/live-doc-migration/yjs-walker';
import type { MigrationMapper } from '@/lib/live-doc-migration/mapper-port';
import { chatYDoc, echoMapper } from '@/lib/live-doc-migration/__tests__/fixtures';
import { LossReportBanner } from '../migration/LossReportBanner';

// Any fixed instant: the .txt records none.
const FILES = (): RecordingDocumentFiles => recordingDocumentFiles('2026-10-22T00:00:00Z');
const runtime = (): Promise<CdocRuntime> => Promise.resolve(inProcessRuntime('main-thread'));
const HEX: string = 'c'.repeat(64);

const LOSSY: string = JSON.stringify({
  report: { losses: [{ part: 'doc', what: 'strike', count: 2, severity: 'minor', label: 'Formatting simplified' }] },
  problems: [],
});
const marker = (reportJson: string): MigrationMarker => ({ v: MARKER_VERSION, originYjsSvHash: HEX, client: 5n, snapshotSha256: HEX, reportJson });
const ADOPTED: ConflictRecord = { v: CONFLICT_VERSION, resolution: 'adopt-creator', localOrigin: HEX, peerOrigin: 'd'.repeat(64), lostEdits: [{ client: 9, missing: 6 }, { client: 4, missing: 1 }] };

const walked = (): ReturnType<typeof walkYjsState> => walkYjsState(Y.encodeStateAsUpdate(chatYDoc('tripNotes', 'Trip notes')));

function banner(report: ConversionReport, loadOriginal: () => Promise<OriginalDocument | null>, files: RecordingDocumentFiles = FILES(), conflict: ConflictRecord['resolution'] | null = null): RecordingDocumentFiles {
  render(<LossReportBanner docId="d1" report={report} conflict={conflict} loadOriginal={loadOriginal} files={files} loadCdocRuntime={runtime} />);
  return files;
}

describe('the moved document’s loss report', () => {
  it('lists the mapper’s losses and the edits a conflict left out, each with its label', () => {
    banner(migrationReport(marker(LOSSY), ADOPTED), () => Promise.resolve(null), FILES(), 'adopt-creator');
    expect(screen.getByRole('region', { name: 'Moved to the new document editor' })).toHaveTextContent('2 things could not be carried over (1 changes what you see).');
    fireEvent.click(screen.getByRole('button', { name: 'Show details' }));
    expect(screen.getAllByRole('listitem').map((li: HTMLElement) => li.textContent)).toEqual([
      'Formatting simplified: strike — doc (2 times)',
      'Not in the shared copy: edits made here before the document’s creator moved it; they are kept in a conflicted copy — this device (7 times)',
    ]);
    expect(screen.getByTestId('migration-conflict')).toHaveTextContent('yours is kept as a read-only conflicted copy');
  });

  it('refuses a report it cannot read rather than showing an empty one', () => {
    expect(() => migrationReport(marker('{"report":{"losses":[{"part":"x"}]},"problems":[]}'), null)).toThrow(/unreadable conversion report/);
  });
});

describe('Show original', () => {
  it('lays the original out read-only through the static pm source', async () => {
    const docsPm: string = pmWithText('The document as it was');
    banner({ losses: [], problems: [] }, () => Promise.resolve({ title: 'Trip notes', docsPm, text: 'unused' }));
    fireEvent.click(screen.getByRole('button', { name: 'Show original' }));
    expect(await screen.findByTestId('migration-original-pages')).toBeInTheDocument();
    expect(await screen.findByTestId('page-view')).toBeInTheDocument();
    await waitFor((): void => expect(screen.getByTestId('docs-page-status')).toHaveTextContent('Page 1 of 1'));
    expect(screen.getByTestId('document-read-only')).toHaveTextContent('kept read-only on this device');
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByRole('button', { name: 'Hide original' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('falls back to the text, right-to-left kept, with a .txt of every word, when the mapper cannot make Docs JSON', async () => {
    const failing: MigrationMapper = { ...echoMapper, toDocsPm: (): never => { throw new Error('no StarterKit importer'); } };
    const files: RecordingDocumentFiles = banner({ losses: [], problems: [] }, () => Promise.resolve(originalDocument(walked(), 'fallback', failing)));
    fireEvent.click(screen.getByRole('button', { name: 'Show original' }));
    const text: HTMLElement = await screen.findByTestId('migration-original-text');
    expect(text).toHaveTextContent('Notes שלום — مرحبا');
    expect(text).toHaveAttribute('dir', 'auto');
    expect(screen.getByTestId('migration-original')).toHaveTextContent('could not show the original’s formatting');
    expect(screen.queryByTestId('migration-original-pages')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Download as .txt' }));
    expect(files.saved).toHaveLength(1);
    expect(files.saved[0].name).toBe('Trip notes (original).txt');
    expect(new TextDecoder().decode(files.saved[0].bytes)).toBe('Notes\nשלום — مرحبا');
  });

  it('with no mapper at all (this build), still shows the text', () => {
    expect(originalDocument(walked(), 'fallback', null)).toEqual({ title: 'Trip notes', docsPm: null, text: 'Notes\nשלום — مرحبا' });
  });

  it('says why when the original cannot be read, and that it is gone when it is', async () => {
    banner({ losses: [], problems: [] }, () => Promise.reject(new Error('LocalDB request timed out after 5000ms')));
    fireEvent.click(screen.getByRole('button', { name: 'Show original' }));
    expect(await screen.findByTestId('migration-original-error')).toHaveTextContent('The original could not be opened. LocalDB request timed out after 5000ms');
  });

  it('shows nothing late: a load answered after "Hide original" is dropped', async () => {
    let answer: (value: OriginalDocument | null) => void = (): void => undefined;
    banner({ losses: [], problems: [] }, () => new Promise<OriginalDocument | null>((resolve: (value: OriginalDocument | null) => void): void => { answer = resolve; }));
    fireEvent.click(screen.getByRole('button', { name: 'Show original' }));
    fireEvent.click(screen.getByRole('button', { name: 'Hide original' }));
    // Flushed for real (a macrotask inside act), so the late answer has been delivered and rendered.
    await act(async (): Promise<void> => {
      answer({ title: 't', docsPm: null, text: 'late' });
      await new Promise<void>((resolve: () => void): void => { setTimeout(resolve, 0); });
    });
    expect(screen.queryByTestId('migration-original')).toBeNull();
    expect(screen.getByRole('button', { name: 'Show original' })).toHaveAttribute('aria-expanded', 'false');
  });
});
