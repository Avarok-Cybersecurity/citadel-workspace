/**
 * Files in and out of a live replica, and replicas that converge, over the real cdoc-edit
 * (InProcessCdocClient: production host, engine and wasm). Text is read back by exporting
 * the replica as plain text, so every check is the engine's own view of the document.
 */
import { describe, expect, it } from 'vitest';
import { inProcessRuntime, type TestRuntime } from '../../__tests__/wasm-rig';
import { createEditorOpener } from '../editor-opener';
import type { EditorSession } from '../editor-session';
import type { EditorOrigin } from '../controller';
import type { ConversionLoss, ExportedFile } from '../file-formats';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function opener(): (from: EditorOrigin) => Promise<EditorSession> {
  let next: number = 1;
  const runtime: TestRuntime = inProcessRuntime('worker');
  return createEditorOpener({ client: runtime.client, renderer: runtime.renderer }, (b: Uint8Array): Uint8Array => b.map((): number => next++ & 0xff));
}

const utf8: TextDecoder = new TextDecoder();
async function text(editor: EditorSession): Promise<string> {
  return utf8.decode((await editor.exportAs({ format: 'txt' })).bytes);
}

describe('files in and out of the editor', () => {
  it('exports what was typed, and opens the exported DOCX again as the same text', async () => {
    const open: (from: EditorOrigin) => Promise<EditorSession> = opener();
    const a: EditorSession = await open({ kind: 'blank' });
    await a.execute({ name: 'insertText', text: 'Round\ntrip' });
    expect(await text(a)).toBe('Round\n\ntrip\n');
    const docx: ExportedFile = await a.exportAs({ format: 'docx' });
    expect(utf8.decode(docx.bytes.subarray(0, 2))).toBe('PK');
    const b: EditorSession = await open({ kind: 'bytes', bytes: docx.bytes, format: 'docx' });
    expect(await text(b)).toBe(await text(a));
    expect(b.importReport).toMatchObject({ format: 'docx', kind: 'document', problems: [] });
    expect(a.importReport).toBeNull();
  });

  it('opens Markdown and plain text with the import options', async () => {
    const open: (from: EditorOrigin) => Promise<EditorSession> = opener();
    const md: EditorSession = await open({ kind: 'bytes', bytes: new TextEncoder().encode('# Title\n\nBody'), format: 'md' });
    expect(await text(md)).toBe('Title\n\nBody\n');
    const txt: EditorSession = await open({ kind: 'bytes', bytes: new TextEncoder().encode('one\ntwo'), format: 'txt' });
    expect(txt.importReport).toMatchObject({ format: 'txt', losses: [], problems: [] });
    // A single newline is a line break inside one paragraph, not a space.
    expect(await text(txt)).not.toContain('one two');
  });

  it('writes a PDF stamped with the time it is given, and a template as DOTX', async () => {
    const a: EditorSession = await opener()({ kind: 'blank' });
    const pdf: ExportedFile = await a.exportAs({ format: 'pdf', nowRfc3339: '2026-10-18T00:00:00Z' });
    expect(utf8.decode(pdf.bytes.subarray(0, 5))).toBe('%PDF-');
    // The PDF writer reports no losses (pm_to_pdf returns only bytes), so there is no report to show.
    expect(pdf.report).toBeNull();
    expect(new TextDecoder('latin1').decode(pdf.bytes)).toContain('D:20261018000000');
    const dotx: ExportedFile = await a.exportAs({ format: 'dotx' });
    const reopened: EditorSession = await opener()({ kind: 'bytes', bytes: dotx.bytes, format: 'docx' });
    expect(reopened.importReport?.kind).toBe('template');
  });

  it('reports each loss with its severity and plain-language label: a GIF it cannot draw is minor', async () => {
    const bytes: Uint8Array = new Uint8Array(readFileSync(join(__dirname, '..', '..', '__tests__', 'fixtures', 'png-jpeg-gif.docx')));
    const opened: EditorSession = await opener()({ kind: 'bytes', bytes, format: 'docx' });
    const gif: ConversionLoss | undefined = opened.importReport?.losses.find((l: ConversionLoss): boolean => l.kind === 'counted' && /GIF/.test(l.what));
    expect(gif).toMatchObject({ kind: 'counted', severity: 'minor', label: expect.stringMatching(/\S/) as unknown as string });
  });

  it('refuses a file that is not what its format says, by name', async () => {
    await expect(opener()({ kind: 'bytes', bytes: Uint8Array.from([1, 2, 3]), format: 'docx' })).rejects.toThrow(/docx|zip|archive/i);
  });
});

describe('replicas that converge', () => {
  it('two blanks opened apart are one document: an update from one applies to the other', async () => {
    const open: (from: EditorOrigin) => Promise<EditorSession> = opener();
    const a: EditorSession = await open({ kind: 'blank' });
    const b: EditorSession = await open({ kind: 'blank' });
    const updates: Uint8Array[] = [];
    a.on('change', ({ update }) => updates.push(update));
    await a.execute({ name: 'insertText', text: 'shared' });
    for (const u of updates) await b.applyRemote(u);
    expect(await text(b)).toBe('shared\n');
  });

  it('publishes a whole replica as chunks no larger than the limit, which rebuild it in order', async () => {
    const open: (from: EditorOrigin) => Promise<EditorSession> = opener();
    const a: EditorSession = await open({ kind: 'blank' });
    await a.execute({ name: 'insertText', text: 'chunk '.repeat(1000) });
    const chunks: Uint8Array[] = await a.encodeDiffChunked(null, 1024);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c: Uint8Array): boolean => c.length <= 1024)).toBe(true);
    const b: EditorSession = await open({ kind: 'blank' });
    for (const c of chunks) await b.applyRemote(c);
    expect(await text(b)).toBe(await text(a));
    await expect(a.encodeDiffChunked(await a.stateVector(), 0)).rejects.toThrow(/maxBytes 0 is not a positive u32/);
  });
});
