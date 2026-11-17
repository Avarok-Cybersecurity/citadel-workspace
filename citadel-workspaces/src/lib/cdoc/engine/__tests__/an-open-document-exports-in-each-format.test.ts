/**
 * "Download as…" in the engine: a replica opened from a file, written as DOCX, DOTX, ODT, MD,
 * TXT and PDF by its own export (EditorController.exportAs, the one export path), each read back
 * to prove it is the document. The file manager's ten-page fixture writes the same bytes the
 * pre-contract static export wrote, so moving files onto the replica changed no download. And
 * the worker no longer answers the static path's 'export' at all. Production host, engine, wasm.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ExportedFile, ExportTarget } from '../../editor/file-formats';
import { inProcessRuntime, type TestRuntime } from '../../__tests__/wasm-rig';
import { bytesOf, freshClient, text, zipEntryText } from '../../__tests__/files-rig';
import type { DocsImportFormat } from '../../../citadel-apps/docs-file-kinds';
import { replicaOrigin } from '../../document-source';
import { createEditorOpener } from '../../editor/editor-opener';
import type { EditorSession } from '../../editor/editor-session';

const MD: string = '# Quarterly plan\n\nShip **open** and *export*.\n';
const NOW: string = '2031-02-03T04:05:06Z';

function openFile(format: DocsImportFormat, bytes: Uint8Array): Promise<EditorSession> {
  const runtime: TestRuntime = inProcessRuntime('worker');
  let next: number = 1;
  return createEditorOpener({ client: runtime.client, renderer: runtime.renderer }, (b: Uint8Array): Uint8Array => b.map((): number => next++ & 0xff))(replicaOrigin({ kind: 'file', format, bytes }));
}

const openedMarkdown = (): Promise<EditorSession> => openFile('md', bytesOf(MD));
const asText = async (format: DocsImportFormat, bytes: Uint8Array): Promise<string> => text((await (await openFile(format, bytes)).exportAs({ format: 'txt' })).bytes);

/**
 * sha256 of each download of integration-tests/assets/docs/10p.docx, written by the static
 * export (CdocEngine.export over docx_to_pm) at UI 190093cf, before files moved onto the replica.
 */
const STATIC_EXPORT_SHA256: Readonly<Record<ExportTarget['format'], string>> = {
  docx: 'cb89e586a05c8d932ef0016e94ec56bd4212419d5dfc1c97f475f5880fb0be4a',
  dotx: '9fabf390f3e4df78f390bd493472a138a875b2d3c29e9748a6d7178ef2f1fb20',
  odt: '975fde768faca8913e80b4f610ce10e91e9ecdcb72421559c2149a8c62fdc0ff',
  md: '77aca76fe2493b38d4b57fe25f102e8182d11ac4a3fcf5a88eb0d5ebbb0d47b5',
  txt: 'd7a9540a9dba60b0ab77ed42d3623dd1cf7806f9bb28033b66fb97c3522d44cc',
  pdf: '17cd973f422d824cd769ee6b71f2a8cad4abd01825b9907b2e99513880b3a112',
};
const TARGETS: readonly ExportTarget[] = [{ format: 'docx' }, { format: 'dotx' }, { format: 'odt' }, { format: 'md' }, { format: 'txt' }, { format: 'pdf', nowRfc3339: NOW }];

describe('exporting a document opened from a file', () => {
  it('writes the e2e fixture byte for byte as the static export did, in every format', async () => {
    const editor: EditorSession = await openFile('docx', new Uint8Array(readFileSync(join(process.cwd(), 'integration-tests/assets/docs/10p.docx'))));
    for (const target of TARGETS) {
      const out: ExportedFile = await editor.exportAs(target);
      expect([target.format, createHash('sha256').update(out.bytes).digest('hex')]).toEqual([target.format, STATIC_EXPORT_SHA256[target.format]]);
    }
  });

  it('writes a .docx that opens again with the same text', async () => {
    const out: ExportedFile = await (await openedMarkdown()).exportAs({ format: 'docx' });
    expect(text(out.bytes.slice(0, 2))).toBe('PK');
    expect(await asText('docx', out.bytes)).toContain('Ship open and export.');
  });

  it('writes Markdown that keeps the heading and emphasis', async () => {
    const out: ExportedFile = await (await openedMarkdown()).exportAs({ format: 'md' });
    expect(text(out.bytes)).toContain('# Quarterly plan');
    expect(text(out.bytes)).toContain('**open**');
  });

  it('writes plain text and reports the formatting it dropped', async () => {
    const out: ExportedFile = await (await openedMarkdown()).exportAs({ format: 'txt' });
    expect(text(out.bytes)).toContain('Ship open and export.');
    expect(out.report?.losses).toContainEqual(expect.objectContaining({ kind: 'counted', what: 'character formatting' }));
  });

  it('writes a PDF stamped with the time it was given', async () => {
    const out: ExportedFile = await (await openedMarkdown()).exportAs({ format: 'pdf', nowRfc3339: NOW });
    expect(text(out.bytes.slice(0, 5))).toBe('%PDF-');
    expect(text(out.bytes)).toContain('20310203');
    // Through the PDF artefact, which reports no losses.
    expect(out.report).toBeNull();
  });

  it.each(['dotx', 'odt'] as const)('writes a .%s that opens again with the same text', async (format: 'dotx' | 'odt') => {
    const out: ExportedFile = await (await openedMarkdown()).exportAs({ format });
    expect(text(out.bytes.slice(0, 2))).toBe('PK');
    expect(await asText(format, out.bytes)).toContain('Ship open and export.');
  });

  it('writes a .dotx as a template and a .docx as a document', async () => {
    const editor: EditorSession = await openedMarkdown();
    const dotx: ExportedFile = await editor.exportAs({ format: 'dotx' });
    const docx: ExportedFile = await editor.exportAs({ format: 'docx' });
    expect(zipEntryText(dotx.bytes, '[Content_Types].xml')).toContain('wordprocessingml.template.main+xml');
    expect(zipEntryText(docx.bytes, '[Content_Types].xml')).toContain('wordprocessingml.document.main+xml');
  });

  it('refuses the static export by name: the worker has no such request', async () => {
    const retired: { kind: 'paint'; pages: number[] } = { kind: 'export', target: { format: 'md' } } as unknown as { kind: 'paint'; pages: number[] };
    await expect(freshClient().request(retired)).rejects.toThrow(/no route for request export/);
  });
});
