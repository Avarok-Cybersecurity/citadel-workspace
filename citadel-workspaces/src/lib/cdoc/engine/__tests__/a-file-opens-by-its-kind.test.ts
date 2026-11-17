/**
 * A file opens in Citadel Docs by its kind, as a replica (EditorHandle.fromDocument): the bytes
 * go to the worker host, the editor imports them by format, and the import report comes back
 * with the pages. What came through is read back by exporting the replica as text. The
 * production host, engine and wasm throughout; no mocks.
 */
import { describe, expect, it } from 'vitest';
import { transferablesOf } from '../../worker/protocol';
import { inProcessRuntime, type TestRuntime } from '../../__tests__/wasm-rig';
import { refusedMacros } from '../../conversion-report';
import { bytesOf, fixture, freshClient, text } from '../../__tests__/files-rig';
import type { DocsImportFormat } from '../../../citadel-apps/docs-file-kinds';
import { replicaOrigin } from '../../document-source';
import { createEditorOpener } from '../../editor/editor-opener';
import type { EditorSession } from '../../editor/editor-session';
import type { ImportReport } from '../../editor/file-formats';

function openFile(format: DocsImportFormat, bytes: Uint8Array): Promise<EditorSession> {
  const runtime: TestRuntime = inProcessRuntime('worker');
  let next: number = 1;
  const open: ReturnType<typeof createEditorOpener> = createEditorOpener({ client: runtime.client, renderer: runtime.renderer }, (b: Uint8Array): Uint8Array => b.map((): number => next++ & 0xff));
  return open(replicaOrigin({ kind: 'file', format, bytes }));
}

async function openAndRead(format: DocsImportFormat, bytes: Uint8Array): Promise<{ pages: number; report: ImportReport; asText: string }> {
  const editor: EditorSession = await openFile(format, bytes);
  if (editor.importReport === null) throw new Error('a replica opened from a file has an import report');
  return { pages: editor.state.pageCount, report: editor.importReport, asText: text((await editor.exportAs({ format: 'txt' })).bytes) };
}

describe('opening a file by its kind', () => {
  it('opens a .docx, with its text and the report of what Word formatting it could not carry', async () => {
    const { pages, report, asText } = await openAndRead('docx', fixture('textutil.docx'));
    expect(pages).toBe(1);
    expect(asText).toContain('Heading One');
    expect(asText).toContain('apple');
    expect(report.losses.length).toBeGreaterThan(0);
    expect(report.losses.every((l: ImportReport['losses'][number]): boolean => l.kind === 'counted')).toBe(true);
    expect(report.losses.some((l: ImportReport['losses'][number]): boolean => l.part === 'word/document.xml')).toBe(true);
  });

  it('opens a .dotx template through the package reader, which says it was a template', async () => {
    const { pages, report, asText } = await openAndRead('dotx', fixture('poi-test.dotx'));
    expect(pages).toBeGreaterThanOrEqual(1);
    expect(asText).toContain('Test');
    expect(report).toMatchObject({ format: 'docx', kind: 'template' });
  });

  it('opens Markdown, losslessly', async () => {
    const { report, asText } = await openAndRead('md', bytesOf('# Plan\n\nShip the *file manager* open.\n'));
    expect(asText).toContain('Ship the file manager open.');
    expect(report).toMatchObject({ losses: [], problems: [] });
  });

  it('opens plain text, keeping each line', async () => {
    const { asText } = await openAndRead('txt', bytesOf('first line\nsecond line\n'));
    expect(asText).toMatch(/first line\n+second line/);
  });

  it('opens an .odt', async () => {
    const { pages, asText } = await openAndRead('odt', fixture('bullet_list.odt'));
    expect(pages).toBeGreaterThanOrEqual(1);
    expect(asText).toContain('listItem1');
  });

  it('names each macro part of a Word file with macros, which is how Docs refuses it', async () => {
    const { report } = await openAndRead('docx', fixture('poi-simple-macro.docm'));
    expect(refusedMacros(report)).toEqual([
      { kind: 'macros', part: 'word/vbaData.xml', bytes: 809n, severity: 'info', label: 'Macros removed' },
      { kind: 'macros', part: 'word/vbaProject.bin', bytes: 12800n, severity: 'info', label: 'Macros removed' },
    ]);
  });

  it('refuses text that is not UTF-8 rather than guessing an encoding', async () => {
    await expect(openFile('txt', Uint8Array.from([0x66, 0xff, 0xfe]))).rejects.toThrow(/UTF-8/);
  });

  it('refuses bytes that are not the format named', async () => {
    await expect(openFile('docx', bytesOf('# not a zip'))).rejects.toThrow();
  });

  it('moves a copy of the file to the worker: its buffer is in the transfer list, and the caller keeps the original', () => {
    const bytes: Uint8Array = fixture('textutil.docx');
    const from: ReturnType<typeof replicaOrigin> = replicaOrigin({ kind: 'file', format: 'docx', bytes });
    if (from.kind !== 'bytes') throw new Error('a file opens from its bytes');
    expect(transferablesOf({ kind: 'editorOpen', client: 1n, from })).toEqual([from.bytes.buffer]);
    expect(from.bytes.buffer).not.toBe(bytes.buffer);
  });

  it('is never laid out as a static document: the worker refuses a file sent to open', async () => {
    const sneaked: { kind: 'open'; source: never } = { kind: 'open', source: { kind: 'file', format: 'docx', bytes: fixture('textutil.docx') } as never };
    await expect(freshClient().request(sneaked)).rejects.toThrow(/opens as a replica/);
  });
});
