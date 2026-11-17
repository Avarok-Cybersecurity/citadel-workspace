/**
 * Mounts EditorPageView over the real cdoc-edit (InProcessCdocClient: production host, engine
 * and wasm) for the editor's component tests, and delivers input as the browser does. jsdom
 * has no layout, so the viewport height is stated (800px) and page boxes sit at 0,0.
 */
import { afterEach, beforeEach, expect } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { inProcessRuntime, type TestRuntime } from '@/lib/cdoc/__tests__/wasm-rig';
import { EditorSession } from '@/lib/cdoc/editor/editor-session';
import { EditorPageView } from '../EditorPageView';
import type { EditorOrigin } from '@/lib/cdoc/editor/controller';
import { ManualFrames, ManualRepeat } from './manual-clock';
import { PAINT_AHEAD_MOUNTS_PER_TICK, PAINT_AHEAD_PAGES } from '@/lib/cdoc/paint/paint-config';

const VIEWPORT_PX: number = 800;

/** States the viewport height for every test in the calling file. */
export function statedViewport(): void {
  let restore: (() => void) | null = null;
  beforeEach(() => {
    const original: PropertyDescriptor | undefined = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => VIEWPORT_PX });
    restore = (): void => {
      if (original) Object.defineProperty(HTMLElement.prototype, 'clientHeight', original);
    };
  });
  afterEach(() => restore?.());
}

export interface Mounted {
  /** What reached the system clipboard outside a copy event, in order. */
  readonly clipboard: string[];
  readonly runtime: TestRuntime;
  readonly editor: EditorSession;
  readonly errors: unknown[];
  readonly input: HTMLTextAreaElement;
  /** The caret's blink clock and the frames a drag scrolls on, stepped by the test. */
  readonly blink: ManualRepeat;
  readonly frames: ManualFrames;
  /** The idle ticks pages are painted ahead on, stepped by the test. */
  readonly idle: ManualFrames;
}

export interface MountOptions {
  /** 'refuses': the system clipboard rejects every write, as a browser without the permission does. */
  readonly clipboard: 'records' | 'refuses';
  readonly from: EditorOrigin;
  /** prefers-reduced-motion (or Animations off): the caret stays steady. */
  readonly reducedMotion: boolean;
}

/** The test's usual case, not the app's: a blank document and a clipboard that records writes. */
const USUAL: MountOptions = { clipboard: 'records', from: { kind: 'blank' }, reducedMotion: false };

export async function mount(mode: 'worker' | 'main-thread', options: Partial<MountOptions> = {}): Promise<Mounted> {
  const { clipboard: clipboardPolicy, from, reducedMotion }: MountOptions = { ...USUAL, ...options };
  const blink: ManualRepeat = new ManualRepeat();
  const frames: ManualFrames = new ManualFrames();
  const idle: ManualFrames = new ManualFrames();
  const runtime: TestRuntime = inProcessRuntime(mode);
  const editor: EditorSession = await EditorSession.open({ client: runtime.client, renderer: runtime.renderer }, 11n, from);
  const errors: unknown[] = [];
  const clipboard: string[] = [];
  render(
    <EditorPageView
      editor={editor} renderer={runtime.renderer} zoom={1} dpr={1} onZoomChange={() => undefined} onPageStatus={() => undefined}
      input={{
        platform: 'other', undoPauseMs: 60_000, onError: (e: unknown) => errors.push(e), overlayContext: runtime.overlayContext,
        writeClipboard: async (text: string): Promise<void> => {
          if (clipboardPolicy === 'refuses') throw new Error('NotAllowedError: Write permission denied.');
          clipboard.push(text);
        },
        caretBlink: { phaseMs: 530, repeat: blink.repeat, reducedMotion }, frame: frames.frame,
      }}
      paintAhead={{ warmPages: PAINT_AHEAD_PAGES, mountsPerTick: PAINT_AHEAD_MOUNTS_PER_TICK, idle: idle.frame }}
    />,
  );
  const input: HTMLTextAreaElement = await screen.findByTestId('editor-input') as HTMLTextAreaElement;
  await waitFor(() => expect(runtime.painted.some((t) => t.sizes.length > 0)).toBe(true));
  return { clipboard, runtime, editor, errors, input, blink, frames, idle };
}

export function type(input: HTMLElement, text: string): void {
  for (const ch of text) {
    act(() => { input.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', data: ch, bubbles: true, cancelable: true })); });
  }
}

export function key(input: HTMLElement, k: string, mods: KeyboardEventInit = {}): void {
  act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...mods })); });
}

/** Waits until every request sent so far has been answered (the session's queue is serial). */
export async function settled(editor: EditorSession): Promise<void> {
  await act(async () => { await editor.awareness(); });
}
