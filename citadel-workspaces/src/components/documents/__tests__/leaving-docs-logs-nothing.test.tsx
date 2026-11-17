/**
 * Leaving the Docs app is silent: DocsCanvas disposes its runtime's client in its own effect
 * cleanup, which React runs before the cleanups of the page canvases below it, so every canvas
 * unmounts against a client that is already gone. That must log nothing (the terminated worker
 * released every canvas it held), while a detach that fails on a live client is still reported.
 * The product's WorkerCdocClient and WorkerPageRenderer over the real host; only the thread hop
 * and the OffscreenCanvas transfer are stood in for (host-worker.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { act, render, screen, type RenderResult } from '@testing-library/react';
import { hostWorker, type HostWorker } from '@/lib/cdoc/__tests__/host-worker';
import { realHost } from '@/lib/cdoc/__tests__/wasm-rig';
import { recordingContext, recordingPort, recordingTarget } from '@/lib/cdoc/paint/__tests__/recording-canvas';
import { WorkerPageRenderer, type PageRenderer } from '@/lib/cdoc/paint/page-renderer';
import type { CdocRuntime } from '@/lib/cdoc/runtime';
import { createValueStore, type ValueStore } from '@/lib/value-store';
import type { EngineLoad } from '@/lib/cdoc/worker/engine-load';
import type { CdocResponse } from '@/lib/cdoc/worker/protocol';
import type { Ctx2D } from '@/lib/cdoc/paint/canvas-port';
import DocsCanvas from '../DocsCanvas';
import type { DocumentEditing } from '../use-docs-document';
import { keepBlankReplica } from '../blank-replica';
import { recordingDocumentFiles, type RecordingDocumentFiles } from '@/test-utils/recording-document-files';

// Any fixed instant: these tests download nothing.
const FILES: RecordingDocumentFiles = recordingDocumentFiles('2026-10-18T00:00:00Z');
const EDIT_BLANK: DocumentEditing = { kind: 'replica', keep: keepBlankReplica, save: null, pictures: null };
const VIEWPORT_PX: number = 800;
const DETACH_FAILURE: string = 'the worker refused to detach';

type Answer = (kind: string, id: number) => CdocResponse | null;
const hostAnswers: Answer = (): null => null;
const failDetach: Answer = (kind: string, id: number): CdocResponse | null => (kind === 'detachCanvas' ? { id, ok: false, error: DETACH_FAILURE } : null);

function workerRuntime(answer: Answer): { runtime: CdocRuntime; worker: HostWorker } {
  const worker: HostWorker = hostWorker(realHost(recordingPort().port, recordingTarget), answer);
  const renderer: PageRenderer = new WorkerPageRenderer(worker.client, (): OffscreenCanvas => ({}) as OffscreenCanvas);
  const overlayContext = (canvas: HTMLCanvasElement): Ctx2D => recordingContext(canvas.dataset.layer ?? 'overlay').ctx;
  const engineLoad: ValueStore<EngineLoad> = createValueStore<EngineLoad>('test-engine-load', { kind: 'ready' });
  return { runtime: { client: worker.client, renderer, overlayContext, engineLoad }, worker };
}

const settle = (): Promise<void> => act(async (): Promise<void> => { await new Promise<void>((done: () => void): void => { setTimeout(done, 20); }); });

let consoleError: MockInstance<(...data: unknown[]) => void>;
let restore: (() => void) | null = null;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error');
  const original: PropertyDescriptor | undefined = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => VIEWPORT_PX });
  restore = (): void => {
    if (original) Object.defineProperty(HTMLElement.prototype, 'clientHeight', original);
  };
});
afterEach(() => {
  restore?.();
  consoleError.mockRestore();
});

async function openBlank(runtime: CdocRuntime): Promise<() => void> {
  const view: RenderResult = render(<DocsCanvas documentSource={{ kind: 'blank' }} loadRuntime={async (): Promise<CdocRuntime> => runtime} editing={EDIT_BLANK} statusBar={null} edit={{ enabled: true, reason: null }} commentAuthor="Ada" title="Untitled" files={FILES} original={null} />);
  expect(await screen.findAllByTestId('document-page', {}, { timeout: 10_000 })).not.toHaveLength(0);
  await settle();
  return view.unmount;
}

describe('leaving the Docs app', () => {
  it('logs nothing and terminates the worker', async () => {
    const { runtime, worker } = workerRuntime(hostAnswers);
    const unmount: () => void = await openBlank(runtime);
    unmount();
    await settle();
    expect(worker.terminated()).toBe(true);
    expect(consoleError.mock.calls).toEqual([]);
  });

  it('logs nothing for a detach still in flight when the client is disposed', async () => {
    const { runtime, worker } = workerRuntime(hostAnswers);
    await runtime.renderer.mount(0, document.createElement('canvas'));
    runtime.renderer.unmount(0);
    runtime.client.dispose();
    await settle();
    expect(worker.terminated()).toBe(true);
    expect(consoleError.mock.calls).toEqual([]);
  });

  it('still reports a detach that fails while the client is live', async () => {
    const { runtime } = workerRuntime(failDetach);
    const renderer: PageRenderer = runtime.renderer;
    await renderer.mount(0, document.createElement('canvas'));
    renderer.unmount(0);
    await settle();
    expect(consoleError).toHaveBeenCalledWith('cdoc: detaching a page canvas failed', expect.objectContaining({ message: `cdoc detachCanvas: ${DETACH_FAILURE}` }));
    runtime.client.dispose();
  });
});
