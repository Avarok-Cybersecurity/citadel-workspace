/**
 * A peer's update that arrives before the one it depends on waits in the engine's pending
 * buffer (engine-limits.ts PENDING_LIMITS, passed by the worker host), and lands once its
 * dependency does; the result says what waits, and that nothing was dropped.
 */
import { describe, expect, it } from 'vitest';
import { inProcessRuntime, type TestRuntime } from '../../__tests__/wasm-rig';
import { createEditorOpener } from '../editor-opener';
import type { EditorSession } from '../editor-session';
import type { EditorOrigin, RemoteApplied } from '../controller';

/** The author's CRDT client: the opener's eight random bytes, all 0x11, read as a u64. */
const AUTHOR_CLIENT: bigint = 0x1111_1111_1111_1111n;

async function opened(seed: number, from: EditorOrigin): Promise<EditorSession> {
  const runtime: TestRuntime = inProcessRuntime('worker');
  return createEditorOpener({ client: runtime.client, renderer: runtime.renderer }, (bytes: Uint8Array): Uint8Array => bytes.fill(seed))(from);
}

async function text(editor: EditorSession): Promise<string> {
  await editor.execute({ name: 'selectAll' });
  return editor.selectionText();
}

describe('an update ahead of its dependency', () => {
  it('waits, and lands when the dependency arrives', async () => {
    const author: EditorSession = await opened(0x11, { kind: 'blank' });
    const late: EditorSession = await opened(0x22, { kind: 'snapshot', snapshot: await author.snapshot() });
    await author.execute({ name: 'insertText', text: 'x' });
    const first: Uint8Array = await author.encodeDiff(await late.stateVector());
    const caughtUp: EditorSession = await opened(0x33, { kind: 'snapshot', snapshot: await author.snapshot() });
    await author.execute({ name: 'insertText', text: 'y' });
    const second: Uint8Array = await author.encodeDiff(await caughtUp.stateVector());

    const waiting: RemoteApplied = await late.applyRemote(second);
    // The unit the buffered operation waits for is the author's, and the limits dropped nothing.
    expect(waiting.remote.missing?.client).toBe(AUTHOR_CLIENT);
    expect(waiting.remote.dropped).toBe(0n);
    expect(await text(late)).toBe('');
    const landed: RemoteApplied = await late.applyRemote(first);
    expect(landed.remote).toEqual({ missing: null, dropped: 0n });
    expect(await text(late)).toBe('xy');
  });
});
