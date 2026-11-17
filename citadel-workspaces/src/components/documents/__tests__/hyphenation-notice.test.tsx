/**
 * When an edit brings in a language the replica has no hyphenation patterns for, the status line
 * says so once, after the document has been idle: over a real EditorSession (in-process runtime,
 * real cdoc-wasm). The idle delay is stepped by hand (ManualDelay), as the blink's clock is.
 */
import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { hyphenated, inProcessRuntime, type TestRuntime } from '@/lib/cdoc/__tests__/wasm-rig';
import { createEditorOpener } from '@/lib/cdoc/editor/editor-opener';
import type { EditorSession } from '@/lib/cdoc/editor/editor-session';
import { hyphenationNotice, languageName, useHyphenationNotice, type Delay } from '../page-view/use-hyphenation-notice';

class ManualDelay {
  private tasks: Map<number, () => void> = new Map<number, () => void>();
  private next: number = 0;
  readonly delays: number[] = [];

  readonly delay: Delay = (ms: number, task: () => void): (() => void) => {
    const id: number = this.next++;
    this.delays.push(ms);
    this.tasks.set(id, task);
    return (): void => { this.tasks.delete(id); };
  };

  get pending(): number {
    return this.tasks.size;
  }

  async elapse(): Promise<void> {
    const due: (() => void)[] = [...this.tasks.values()];
    this.tasks.clear();
    await act(async () => { due.forEach((t) => t()); await new Promise((r) => setTimeout(r, 0)); });
  }
}

async function session(): Promise<EditorSession> {
  const runtime: TestRuntime = inProcessRuntime('main-thread');
  let n: number = 1;
  return createEditorOpener({ client: runtime.client, renderer: runtime.renderer }, (b: Uint8Array): Uint8Array => b.map((): number => n++))(hyphenated(null, 'bonjour le monde '.repeat(8)));
}

describe('the hyphenation notice', () => {
  it('names a language an edit brought in, once, after the document is idle', async () => {
    const editor: EditorSession = await session();
    const clock: ManualDelay = new ManualDelay();
    const { result } = renderHook(() => useHyphenationNotice(editor, 2000, clock.delay));
    await act(async () => { await editor.execute({ name: 'selectAll' }); await editor.execute({ name: 'setRunProperty', patch: { lang: 'fr-FR' } }); });
    expect(result.current).toBeNull();
    expect(clock.delays.at(-1)).toBe(2000);
    await clock.elapse();
    expect(result.current).toBe('Hyphenation for French applies after reopening');

    await act(async () => { await editor.execute({ name: 'moveCaret', granularity: 'document', forward: true, extend: false }); await editor.execute({ name: 'insertText', text: ' encore' }); });
    await clock.elapse();
    expect(result.current, 'French is not named again').toBe('Hyphenation for French applies after reopening');
    await act(async () => {
      await editor.execute({ name: 'setRunProperty', patch: { lang: 'de-DE' } });
      await editor.execute({ name: 'insertText', text: ' und Silbentrennung' });
    });
    await clock.elapse();
    expect(result.current, 'only the language not named yet').toBe('Hyphenation for German applies after reopening');
  });

  it('says nothing while no edit needs patterns it lacks', async () => {
    const editor: EditorSession = await session();
    const clock: ManualDelay = new ManualDelay();
    const { result } = renderHook(() => useHyphenationNotice(editor, 2000, clock.delay));
    await act(async () => { await editor.execute({ name: 'insertText', text: 'plain' }); });
    await clock.elapse();
    expect(result.current).toBeNull();
  });

  it('stops waiting when the editor goes', async () => {
    const editor: EditorSession = await session();
    const clock: ManualDelay = new ManualDelay();
    const { unmount } = renderHook(() => useHyphenationNotice(editor, 2000, clock.delay));
    await act(async () => { await editor.execute({ name: 'insertText', text: 'x' }); });
    expect(clock.pending).toBe(1);
    unmount();
    expect(clock.pending).toBe(0);
  });
});

describe('language names', () => {
  it.each([['de-1996', 'German'], ['en-us', 'American English'], ['en-gb', 'British English'], ['fr', 'French'], ['es', 'Spanish']])('%s is %s', (tag: string, name: string) => {
    expect(languageName(tag)).toBe(name);
  });

  it('lists several', () => {
    expect(hyphenationNotice(['fr', 'es', 'de-1996'])).toBe('Hyphenation for French, Spanish and German applies after reopening');
  });
});
