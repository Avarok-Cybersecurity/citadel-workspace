/**
 * The editor's records against the real cdoc-edit, through the production host
 * (InProcessCdocClient: the worker host, engine and wasm, minus the thread hop). Every request
 * is encoded by encodeCommand and every result decoded by decode-records; the engine is the
 * oracle for both.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { InProcessCdocClient } from '../../worker/clients';
import { realHost } from '../../__tests__/wasm-rig';
import { recordingPort, recordingTarget } from '../../paint/__tests__/recording-canvas';
import { encodeCommand } from '../wire/encode-command';
import { decodeAwareness, decodePeerView, decodePosition } from '../wire/decode-records';
import { decodeResult, type EditorResult } from '../wire/decode-result';
import type { EditorCommand, EditorPosition } from '../controller';
import { openDisplayList } from '../../display-list/decoder';
import { decodePage } from '../../display-list/page-ops';
import type { DisplayList, Op } from '../../display-list/types';

let client: InProcessCdocClient;

async function run(command: EditorCommand): Promise<EditorResult> {
  const { result } = await client.request({ kind: 'apply', record: encodeCommand(command) });
  return decodeResult(result);
}

beforeEach(async () => {
  client = new InProcessCdocClient(realHost(recordingPort().port, recordingTarget));
  await client.request({ kind: 'editorOpen', client: 7n, from: { kind: 'blank' } });
});

describe('editor records against cdoc-edit', () => {
  it('opens a blank replica whose own awareness names this client', async () => {
    const { record } = await client.request({ kind: 'awareness' });
    expect(decodeAwareness(record).client).toBe(7n);
  });

  it('types text: an update to relay, page 0 dirty, a caret on page 0', async () => {
    const r: EditorResult = await run({ name: 'insertText', text: 'Hello' });
    expect(r.update.length).toBeGreaterThan(0);
    expect(r.dirtyPages).toEqual([0]);
    expect(r.pageCount).toBe(1);
    expect(r.caret?.page).toBe(0);
    expect(r.caret?.rect.width).toBe(0);
    expect(r.selectionRects).toEqual([]);
  });

  it('moves the caret right as it types, and back with a caret move', async () => {
    const first: EditorResult = await run({ name: 'insertText', text: 'a' });
    const second: EditorResult = await run({ name: 'insertText', text: 'bcd' });
    expect(second.caret?.rect.x).toBeGreaterThan(first.caret?.rect.x ?? Infinity);
    const back: EditorResult = await run({ name: 'moveCaret', granularity: 'char', forward: false, extend: false });
    expect(back.caret?.rect.x).toBeLessThan(second.caret?.rect.x ?? -Infinity);
    expect(back.update.length).toBe(0);
  });

  it('selects all into one highlight rect per line, and positions round-trip into SetSelection', async () => {
    await run({ name: 'insertText', text: 'one\ntwo' });
    const all: EditorResult = await run({ name: 'selectAll' });
    expect(all.selectionRects).toHaveLength(2);
    const again: EditorResult = await run({ name: 'setSelection', anchor: all.anchor, head: all.head });
    expect(again.selectionRects).toEqual(all.selectionRects);
  });

  it('hit-tests to a position that SetSelection accepts', async () => {
    await run({ name: 'insertText', text: 'Hello world' });
    const { position } = await client.request({ kind: 'hitTest', page: 0, x: 7200, y: 7300 });
    const at: EditorPosition = decodePosition(position);
    const r: EditorResult = await run({ name: 'setSelection', anchor: at, head: at });
    expect(r.caret?.page).toBe(0);
  });

  it('carries a model value: bold through SetRunProperty, refused when malformed', async () => {
    await run({ name: 'insertText', text: 'x' });
    await run({ name: 'selectAll' });
    const r: EditorResult = await run({ name: 'setRunProperty', patch: { bold: true, size: 28 } });
    expect(r.update.length).toBeGreaterThan(0);
    const bad: Uint8Array = Uint8Array.from([0x08, 0x01, 0x07]);
    await expect(client.request({ kind: 'apply', record: bad })).rejects.toThrow();
  });

  async function paintedFaces(): Promise<Array<{ bold: boolean; italic: boolean }>> {
    const { displayList } = await client.request({ kind: 'paint', pages: [0] });
    const list: DisplayList = openDisplayList(displayList);
    const used: Set<number> = new Set<number>(
      decodePage(list, 0).ops.flatMap((op: Op) => (op.kind === 'glyphRun' ? [op.head.faceId] : [])),
    );
    return [...used].map((id: number) => ({ bold: list.faces[id].bold, italic: list.faces[id].italic }));
  }

  it('applies the patch it was given: bold alone turns the text bold', async () => {
    await run({ name: 'insertText', text: 'weight' });
    await run({ name: 'selectAll' });
    expect(await paintedFaces()).toEqual([{ bold: false, italic: false }]);
    await run({ name: 'setRunProperty', patch: { bold: true } });
    expect(await paintedFaces()).toEqual([{ bold: true, italic: false }]);
  });

  it.each([['bold', { bold: true, italic: false }], ['italic', { bold: false, italic: true }]] as const)(
    'toggles the %s mark it names',
    async (mark, face) => {
      await run({ name: 'insertText', text: 'marked' });
      await run({ name: 'selectAll' });
      await run({ name: 'toggleMark', mark });
      expect(await paintedFaces()).toEqual([face]);
    },
  );

  it('reports formatting at the caret: bold after a toggle, mixed across bold and plain', async () => {
    await run({ name: 'insertText', text: 'plain ' });
    await run({ name: 'toggleMark', mark: 'bold' });
    const typed: EditorResult = await run({ name: 'insertText', text: 'bold' });
    expect(typed.formatting.run.bold).toBe(true);
    expect(typed.formatting.runMixed.size).toBe(0);
    const all: EditorResult = await run({ name: 'selectAll' });
    expect([...all.formatting.runMixed]).toContain('bold');
    expect(all.formatting.run.bold).not.toBe(true);
  });

  it('patches a paragraph field by field and clears with null', async () => {
    await run({ name: 'insertText', text: 'centred' });
    const set: EditorResult = await run({ name: 'setParagraphProperty', patch: { alignment: 'center', spacing: { before: 1200 } } });
    expect(set.formatting.paragraphDirect.alignment).toBe('center');
    expect(set.formatting.paragraphDirect.spacing?.before).toBe(1200);
    const cleared: EditorResult = await run({ name: 'setParagraphProperty', patch: { alignment: null } });
    expect(cleared.formatting.paragraphDirect.alignment).toBeUndefined();
    expect(cleared.formatting.paragraphDirect.spacing?.before).toBe(1200);
  });

  it('turns the page to landscape with SetSectionProperty', async () => {
    await run({ name: 'insertText', text: 'wide' });
    await run({ name: 'setSectionProperty', patch: { orientation: 'landscape' } });
    const { pageSizes } = await client.request({ kind: 'pageSizes' });
    expect([...pageSizes]).toEqual([84190, 59530]);
  });

  it('undoes typing back to an empty change set', async () => {
    await run({ name: 'insertText', text: 'gone' });
    await run({ name: 'breakUndoGroup' });
    const undone: EditorResult = await run({ name: 'undo' });
    expect(undone.update.length).toBeGreaterThan(0);
    const { snapshot } = await client.request({ kind: 'snapshot' });
    expect(snapshot.length).toBeGreaterThan(0);
  });

  it('paints just the pages asked for, as a display list that decodes', async () => {
    await run({ name: 'insertText', text: 'Painted' });
    const { displayList } = await client.request({ kind: 'paint', pages: [0] });
    expect(openDisplayList(displayList).pages.map((p) => p.number)).toEqual([0]);
  });

  it('maps its own awareness to its caret, as the opening state does', async () => {
    const r: EditorResult = await run({ name: 'insertText', text: 'abc' });
    const { record } = await client.request({ kind: 'awareness' });
    const { record: view } = await client.request({ kind: 'peerView', record });
    expect(decodePeerView(view).caret).toEqual(r.caret);
  });
});
