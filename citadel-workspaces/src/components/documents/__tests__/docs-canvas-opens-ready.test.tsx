/**
 * DocsCanvas over the real runtime (InProcessCdocClient: production host, engine and wasm): a
 * blank document opens in the editor with the keyboard already on it, so the first keystroke
 * types rather than needing a click; and the ReplicaKeeper owns replica lifetimes (a re-open is
 * drawn, the canvas never disposes a shown replica, the keeper is torn down before the client).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, render, screen, waitFor, type RenderResult } from '@testing-library/react';
import type { EditorSession } from '@/lib/cdoc/editor/editor-session';
import type { EditorOrigin } from '@/lib/cdoc/editor/controller';
import { inProcessRuntime, type TestRuntime } from '@/lib/cdoc/__tests__/wasm-rig';
import type { CdocRuntime } from '@/lib/cdoc/runtime';
import DocsCanvas from '../DocsCanvas';
import type { DocumentEditing, ReplicaKeeper } from '../use-docs-document';
import { keepBlankReplica } from '../blank-replica';
import { recordingDocumentFiles, type RecordingDocumentFiles } from '@/test-utils/recording-document-files';

// Any fixed instant: these tests download nothing.
const FILES: RecordingDocumentFiles = recordingDocumentFiles('2026-10-18T00:00:00Z');
const EDIT_BLANK: DocumentEditing = { kind: 'replica', keep: keepBlankReplica, save: null, pictures: null };

const VIEWPORT_PX: number = 800;
let restore: (() => void) | null = null;
beforeEach(() => {
  const original: PropertyDescriptor | undefined = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => VIEWPORT_PX });
  restore = (): void => {
    if (original) Object.defineProperty(HTMLElement.prototype, 'clientHeight', original);
  };
});
afterEach(() => restore?.());

describe('DocsCanvas', () => {
  it('opens a blank document with the keyboard on the editor', async () => {
    const runtime: TestRuntime = inProcessRuntime('main-thread');
    render(<DocsCanvas documentSource={{ kind: 'blank' }} loadRuntime={async (): Promise<CdocRuntime> => runtime} editing={EDIT_BLANK} statusBar={null} edit={{ enabled: true, reason: null }} commentAuthor="Ada" title="Untitled" files={FILES} original={null} />);
    const input: HTMLElement = await screen.findByTestId('editor-input');
    await waitFor(() => expect(document.activeElement).toBe(input));
  });

  it('draws each replica the keeper shows and leaves disposing them to the keeper', async () => {
    const runtime: TestRuntime = inProcessRuntime('main-thread');
    const events: string[] = [];
    const disposeClient: () => void = runtime.client.dispose.bind(runtime.client);
    runtime.client.dispose = (): void => {
      events.push('client disposed');
      disposeClient();
    };
    const opened: EditorSession[] = [];
    let reopen: (() => Promise<void>) | null = null;
    const keeper: ReplicaKeeper = (open: (from: EditorOrigin) => Promise<EditorSession>, show: (e: EditorSession) => void): (() => Promise<void>) => {
      const next: () => Promise<void> = async (): Promise<void> => {
        const editor: EditorSession = await open({ kind: 'blank' });
        const dispose: () => void = editor.dispose.bind(editor);
        editor.dispose = (): void => {
          events.push(`replica ${opened.indexOf(editor)} disposed`);
          dispose();
        };
        const attach: (target: (() => void) | null) => void = editor.attachFocus.bind(editor);
        editor.attachFocus = (target: (() => void) | null): void => {
          if (target !== null) events.push(`replica ${opened.indexOf(editor)} drawn`);
          attach(target);
        };
        opened.push(editor);
        show(editor);
      };
      reopen = next;
      void next();
      return async (): Promise<void> => {
        events.push('keeper torn down');
      };
    };
    const editing: DocumentEditing = { kind: 'replica', keep: keeper, save: null, pictures: null };
    const view: RenderResult = render(<DocsCanvas documentSource={{ kind: 'blank' }} loadRuntime={async (): Promise<CdocRuntime> => runtime} editing={editing} statusBar={null} edit={{ enabled: true, reason: null }} commentAuthor="Ada" title="Untitled" files={FILES} original={null} />);
    await screen.findByTestId('editor-input');
    await act(async (): Promise<void> => { await reopen?.(); });
    expect(opened).toHaveLength(2);
    await waitFor(() => expect(events).toEqual(['replica 0 drawn', 'replica 1 drawn']));
    events.length = 0;
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('editor-input')));
    view.unmount();
    // The runtime goes once the keeper's teardown has settled (a keeper may still be writing), never before.
    expect(events).toEqual(['keeper torn down']);
    await waitFor(() => expect(events).toEqual(['keeper torn down', 'client disposed']));
    for (const e of opened) e.dispose();
  });
});
