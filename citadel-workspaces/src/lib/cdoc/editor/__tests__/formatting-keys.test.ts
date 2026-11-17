/**
 * The mixed sets name every key cdoc-edit reports (docs/edit-commands.md: run bits 0..=14,
 * paragraph bits 0..=11). A key the UI did not list made the result record undecodable the
 * moment a selection spanned two values of it: text in two languages, say, as most imported
 * documents have. Over the real cdoc-edit, through the production host.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { InProcessCdocClient } from '../../worker/clients';
import { realHost } from '../../__tests__/wasm-rig';
import { recordingPort, recordingTarget } from '../../paint/__tests__/recording-canvas';
import { encodeCommand } from '../wire/encode-command';
import { decodeResult, type EditorResult } from '../wire/decode-result';
import type { EditorCommand } from '../controller';
import { CLEAR_FORMATTING } from '../caret-formatting';

let client: InProcessCdocClient;

async function run(command: EditorCommand): Promise<EditorResult> {
  const { result } = await client.request({ kind: 'apply', record: encodeCommand(command) });
  return decodeResult(result);
}

beforeEach(async () => {
  client = new InProcessCdocClient(realHost(recordingPort().port, recordingTarget));
  await client.request({ kind: 'editorOpen', client: 7n, from: { kind: 'blank' } });
});

function known(r: EditorResult): Extract<EditorResult['formatting'], { known: true }> {
  if (!r.formatting.known) throw new Error('formatting is unknown');
  return r.formatting;
}

describe('mixed formatting keys', () => {
  it.each([
    ['lang', { lang: 'de-DE' }],
    ['ligatures', { ligatures: 'all' }],
    ['kern', { kern: 16 }],
  ] as const)('reports %s as mixed across a selection that holds two values of it', async (key, patch) => {
    await run({ name: 'insertText', text: 'one' });
    await run({ name: 'selectAll' });
    await run({ name: 'setRunProperty', patch });
    await run({ name: 'moveCaret', granularity: 'document', forward: true, extend: false });
    await run({ name: 'setRunProperty', patch: CLEAR_FORMATTING });
    await run({ name: 'insertText', text: ' two' });
    const all: EditorResult = await run({ name: 'selectAll' });
    expect([...known(all).runMixed]).toContain(key);
  });

  it('reports suppressAutoHyphens as mixed across two paragraphs', async () => {
    await run({ name: 'insertText', text: 'one' });
    await run({ name: 'setParagraphProperty', patch: { suppressAutoHyphens: true } });
    await run({ name: 'insertText', text: '\n' });
    await run({ name: 'setParagraphProperty', patch: { suppressAutoHyphens: false } });
    await run({ name: 'insertText', text: 'two' });
    const all: EditorResult = await run({ name: 'selectAll' });
    expect([...known(all).paragraphMixed]).toContain('suppressAutoHyphens');
  });

  it('clears every run key, the language included, as Clear Formatting does in cdoc-edit', async () => {
    await run({ name: 'insertText', text: 'one' });
    await run({ name: 'selectAll' });
    await run({ name: 'setRunProperty', patch: { lang: 'fr-FR', kern: 16 } });
    const cleared: EditorResult = await run({ name: 'setRunProperty', patch: CLEAR_FORMATTING });
    expect(known(cleared).runDirect).toEqual({});
  });
});
