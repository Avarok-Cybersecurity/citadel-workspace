/**
 * Select All on a long document, keystroke to state, through the production path minus the
 * thread hop and React (as keystroke-perf.ts): EditorSession.execute on the real cdoc-edit, the
 * result decoded. Measured twice, with the viewport set (the page view's way: rects for the
 * pages on screen) and, as the control, with none set (rects for every line of the document).
 */
import { performance } from 'node:perf_hooks';
import { InProcessCdocClient } from '../../worker/clients';
import { WorkerPageRenderer } from '../../paint/page-renderer';
import { EditorSession } from '../../editor/editor-session';
import type { EditorState } from '../../editor/controller';
import { realHost } from '../wasm-rig';
import { nullPort, nullTarget } from './null-canvas';

export interface SelectAllRun {
  readonly p50Ms: number;
  readonly p95Ms: number;
  /** Selection rects a result carried. */
  readonly rects: number;
}

export interface SelectAllPerf {
  readonly pages: number;
  readonly runs: number;
  readonly withViewport: SelectAllRun;
  /** The control: no viewport sent, so every line's rect comes back. */
  readonly withoutViewport: SelectAllRun;
}

const PARAGRAPH: string = 'Select All covers every line of this paragraph, which exists to fill the pages. '.repeat(3);
const percentile = (xs: number[], p: number): number => [...xs].sort((a: number, b: number) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))];

async function document(pages: number): Promise<EditorSession> {
  const client: InProcessCdocClient = new InProcessCdocClient(realHost(nullPort, (): typeof nullTarget => nullTarget));
  const renderer: WorkerPageRenderer = new WorkerPageRenderer(client, (): OffscreenCanvas => ({}) as OffscreenCanvas);
  const editor: EditorSession = await EditorSession.open({ client, renderer }, 1n, { kind: 'blank' });
  while (editor.state.pageCount < pages) await editor.execute({ name: 'insertText', text: `${PARAGRAPH}\n`.repeat(200) });
  return editor;
}

async function selectAllTimes(editor: EditorSession, runs: number): Promise<SelectAllRun> {
  const times: number[] = [];
  let rects: number = 0;
  for (let i: number = 0; i < runs; i++) {
    await editor.execute({ name: 'moveCaret', granularity: 'document', forward: false, extend: false });
    const t: number = performance.now();
    const state: EditorState = await editor.execute({ name: 'selectAll' });
    times.push(performance.now() - t);
    rects = state.selectionRects.length;
  }
  return { p50Ms: percentile(times, 0.5), p95Ms: percentile(times, 0.95), rects };
}

export async function measureSelectAll(pages: number, runs: number): Promise<SelectAllPerf> {
  const editor: EditorSession = await document(pages);
  const withoutViewport: SelectAllRun = await selectAllTimes(editor, runs);
  const middle: number = Math.floor(editor.state.pageCount / 2);
  await editor.setViewport([middle - 1, middle, middle + 1]);
  const withViewport: SelectAllRun = await selectAllTimes(editor, runs);
  return { pages: editor.state.pageCount, runs, withViewport, withoutViewport };
}
