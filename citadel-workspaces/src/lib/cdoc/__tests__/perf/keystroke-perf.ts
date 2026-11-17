/**
 * Keystroke to paint on a 100-page document, through the production path minus the thread hop
 * and React: EditorSession.execute (encode, the worker host's apply on the real cdoc-edit,
 * decode), the dirty-page invalidation, and the worker renderer's repaint of the page the
 * caret is on (decode, outlines, atlas, painter calls into a no-op context, as paint-perf.ts).
 * Shared by paint-perf-cli.ts (prints) and keystroke-perf.test.ts (asserts it ran, never a time).
 */
import { performance } from 'node:perf_hooks';
import { InProcessCdocClient } from '../../worker/clients';
import { WorkerPageRenderer } from '../../paint/page-renderer';
import { EditorSession } from '../../editor/editor-session';
import type { EditorPosition, EditorState } from '../../editor/controller';
import { realHost } from '../wasm-rig';
import { nullPort, nullTarget } from './null-canvas';

export interface KeystrokePerf {
  readonly pages: number;
  readonly keystrokes: number;
  /** Command sent to result decoded, invalidation and repaint of the caret's page done. */
  readonly p50Ms: number;
  readonly p95Ms: number;
  /** The same keystroke's request record through the host alone (no decode, no repaint), median. */
  readonly applyP50Ms: number;
  readonly dirtyPagesPerKeystroke: number;
}

/** A paragraph of ordinary prose, repeated until the document has `pages` pages. */
const PARAGRAPH: string = 'Every keystroke repaints only the pages it changed, and this paragraph exists to fill them. '.repeat(3);

const percentile = (xs: number[], p: number): number => [...xs].sort((a: number, b: number) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))];

export async function measureKeystrokes(pages: number, keystrokes: number): Promise<KeystrokePerf> {
  const client: InProcessCdocClient = new InProcessCdocClient(realHost(nullPort, (): typeof nullTarget => nullTarget));
  const renderer: WorkerPageRenderer = new WorkerPageRenderer(client, (): OffscreenCanvas => ({}) as OffscreenCanvas);
  const editor: EditorSession = await EditorSession.open({ client, renderer }, 1n, { kind: 'blank' });
  while (editor.state.pageCount < pages) await editor.execute({ name: 'insertText', text: `${PARAGRAPH}\n`.repeat(40) });
  // Into the middle of the document, as a writer editing an existing draft would be.
  const middle: EditorPosition = await editor.hitTest(Math.floor(pages / 2), 7200, 20_000);
  await editor.execute({ name: 'setSelection', anchor: middle, head: middle });
  await renderer.mount(0, {} as HTMLCanvasElement);
  const paintCaretPage = async (state: EditorState): Promise<void> => {
    if (state.caretPage !== null) await renderer.paint(0, state.caretPage, 1, 2, 'visible');
  };
  await paintCaretPage(editor.state);

  const total: number[] = [];
  let dirty: number = 0;
  for (let i: number = 0; i < keystrokes; i++) {
    const t: number = performance.now();
    const state: EditorState = await editor.execute({ name: 'insertText', text: i % 6 === 5 ? ' ' : 'e' });
    await paintCaretPage(state);
    total.push(performance.now() - t);
  }
  const off: () => void = editor.on('pages', (e) => { dirty += e.dirtyPages.length; });
  for (let i: number = 0; i < 20; i++) await editor.execute({ name: 'insertText', text: 'x' });
  off();

  const engine: number[] = [];
  const record: Uint8Array = Uint8Array.from([0x01, 0x01, 0x61]);
  for (let i: number = 0; i < keystrokes; i++) {
    const t: number = performance.now();
    await client.request({ kind: 'apply', record: record.slice() });
    engine.push(performance.now() - t);
  }
  return {
    pages: editor.state.pageCount, keystrokes, p50Ms: percentile(total, 0.5), p95Ms: percentile(total, 0.95),
    applyP50Ms: percentile(engine, 0.5), dirtyPagesPerKeystroke: dirty / 20,
  };
}
