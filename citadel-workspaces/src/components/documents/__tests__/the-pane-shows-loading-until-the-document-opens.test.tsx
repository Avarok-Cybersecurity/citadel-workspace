/**
 * DocsCanvas never leaves its pane empty while Citadel Docs loads: the loading pane stands in from
 * the first render, through the runtime's code, the engine's measured download and the document
 * opening, and gives way to the editor once the keeper shows a replica. The real runtime
 * (InProcessCdocClient over the production host and wasm); the engine's download is reported
 * through the runtime's own store, as the worker's messages set it in the app.
 */
import { describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import type { EditorSession } from '@/lib/cdoc/editor/editor-session';
import type { EditorOrigin } from '@/lib/cdoc/editor/controller';
import { inProcessRuntime, type TestRuntime } from '@/lib/cdoc/__tests__/wasm-rig';
import type { CdocRuntime } from '@/lib/cdoc/runtime';
import DocsCanvas from '../DocsCanvas';
import type { DocumentEditing, ReplicaKeeper } from '../use-docs-document';
import { recordingDocumentFiles, type RecordingDocumentFiles } from '@/test-utils/recording-document-files';

// Any fixed instant: this test downloads nothing.
const FILES: RecordingDocumentFiles = recordingDocumentFiles('2026-10-18T00:00:00Z');
const MB: number = 1024 * 1024;

const stage = (): string | null => screen.getByTestId('app-loading-progress').getAttribute('data-stage');

describe('the Docs pane while it loads', () => {
  it('shows the loading pane from the first render until the document opens', async () => {
    const runtime: TestRuntime = inProcessRuntime('main-thread');
    runtime.engineLoad.set({ kind: 'waiting' });
    let deliver: ((r: CdocRuntime) => void) | null = null;
    const loadRuntime = (): Promise<CdocRuntime> => new Promise<CdocRuntime>((resolve: (r: CdocRuntime) => void): void => { deliver = resolve; });
    let showOpened: (() => Promise<void>) | null = null;
    const keeper: ReplicaKeeper = (open: (from: EditorOrigin) => Promise<EditorSession>, show: (e: EditorSession) => void): (() => Promise<void>) => {
      showOpened = async (): Promise<void> => show(await open({ kind: 'blank' }));
      return (): Promise<void> => Promise.resolve();
    };
    const editing: DocumentEditing = { kind: 'replica', keep: keeper, save: null, pictures: null };
    render(<DocsCanvas documentSource={{ kind: 'blank' }} loadRuntime={loadRuntime} editing={editing} statusBar={null} edit={{ enabled: true, reason: null }} commentAuthor="Ada" title="Untitled" files={FILES} original={null} />);

    expect(screen.getByTestId('app-loading-pane')).toBeInTheDocument();
    expect(stage()).toBe('app');

    await act(async (): Promise<void> => { deliver?.(runtime); });
    expect(stage()).toBe('engine');
    expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');

    act((): void => runtime.engineLoad.set({ kind: 'downloading', bytes: { loaded: 1 * MB, total: 4 * MB } }));
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25');
    act((): void => runtime.engineLoad.set({ kind: 'downloading', bytes: { loaded: 3 * MB, total: 4 * MB } }));
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '75');

    act((): void => runtime.engineLoad.set({ kind: 'ready' }));
    expect(stage()).toBe('document');

    await act(async (): Promise<void> => { await showOpened?.(); });
    expect(await screen.findByTestId('editor-input')).toBeInTheDocument();
    expect(screen.queryByTestId('app-loading-pane')).toBeNull();
  });
});
