/**
 * Renders the real DocsRibbon over a FakeEditor, with the app's real Toaster so a refused
 * command's message is read off the screen. Environment values are fixed so tests can name
 * the exact ids and dates a command carries.
 */
import { render, type RenderResult } from '@testing-library/react';
import { Toaster } from '@/components/ui/sonner';
import type { ActionGate } from '@/hooks/use-permission-result';
import { DocsRibbon } from '../DocsRibbon';
import { EditorControllerContext } from '../editor-context';
import type { RibbonEnvironment } from '../ribbon-environment';
import type { FakeEditor } from './fake-editor';

/** The system clipboard as a test sees it: what was written, what a read answers, and a refusal on demand. */
export class TestClipboard {
  text: string = '';
  readonly writes: string[] = [];
  refusal: DOMException | null = null;

  write(text: string): Promise<void> {
    if (this.refusal !== null) return Promise.reject(this.refusal);
    this.writes.push(text);
    this.text = text;
    return Promise.resolve();
  }

  read(): Promise<string> {
    return this.refusal === null ? Promise.resolve(this.text) : Promise.reject(this.refusal);
  }
}

export function fixedEnvironment(clipboard: TestClipboard): RibbonEnvironment {
  return { ...FIXED_ENVIRONMENT, writeClipboard: (t: string): Promise<void> => clipboard.write(t), readClipboard: (): Promise<string> => clipboard.read() };
}

const UNUSED_CLIPBOARD: TestClipboard = new TestClipboard();

export const FIXED_ENVIRONMENT: RibbonEnvironment = {
  newCommentId: (): string => 'comment-1',
  now: (): string => '2026-10-17T12:00:00.000Z',
  // jsdom has no Blob.arrayBuffer; FileReader reads the same bytes.
  readBytes: (file: Blob): Promise<Uint8Array> => new Promise((resolve: (bytes: Uint8Array) => void, reject: (error: unknown) => void): void => {
    const reader: FileReader = new FileReader();
    reader.onload = (): void => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = (): void => reject(reader.error);
    reader.readAsArrayBuffer(file);
  }),
  writeClipboard: (t: string): Promise<void> => UNUSED_CLIPBOARD.write(t),
  readClipboard: (): Promise<string> => UNUSED_CLIPBOARD.read(),
  modifier: 'Ctrl',
};

export const MAY_EDIT: ActionGate = { enabled: true, reason: null };

export interface RibbonSetup {
  readonly editor: FakeEditor | null;
  readonly edit: ActionGate;
  readonly commentAuthor: string | null;
  /** The fixed environment unless a test needs the world to answer differently. */
  readonly environment?: RibbonEnvironment;
  /** Why pictures cannot be inserted; absent means they can, as in every workspace document. */
  readonly pictures?: string | null;
}

export function renderRibbon({ editor, edit, commentAuthor, environment, pictures }: RibbonSetup): RenderResult {
  return render(
    <EditorControllerContext.Provider value={editor}>
      <DocsRibbon edit={edit} commentAuthor={commentAuthor} environment={environment ?? FIXED_ENVIRONMENT} pictures={pictures ?? null} />
      <Toaster />
    </EditorControllerContext.Provider>,
  );
}
