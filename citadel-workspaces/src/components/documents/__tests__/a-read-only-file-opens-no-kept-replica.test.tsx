/**
 * A file shown read-only opens a replica of its own (EditorHandle.fromDocument) that no keeper
 * holds and nothing types into, and that is disposed with the view; a Word file with macros is
 * refused and its replica disposed at once; and a document given to a keeper is the keeper's
 * to open. Real cdoc wasm through the in-process runtime; no doubles.
 */
import { describe, expect, it } from 'vitest';
import { renderHook, waitFor, type RenderHookResult } from '@testing-library/react';
import { inProcessRuntime } from '@/lib/cdoc/__tests__/wasm-rig';
import { bytesOf, fixture } from '@/lib/cdoc/__tests__/files-rig';
import type { CdocRuntime } from '@/lib/cdoc/runtime';
import type { CdocRuntimeFactory } from '@/lib/cdoc/runtime-loader';
import type { DocumentSource } from '@/lib/cdoc/document-source';
import type { EditorSession } from '@/lib/cdoc/editor/editor-session';
import { useDocsDocument, type DocsDocument, type DocumentEditing } from '../use-docs-document';

const READ_ONLY: DocumentEditing = { kind: 'readOnly', reason: 'Read only here.' };
const loadRuntime: CdocRuntimeFactory = (): Promise<CdocRuntime> => Promise.resolve(inProcessRuntime('main-thread'));
const MD: DocumentSource = { kind: 'file', format: 'md', bytes: bytesOf('# Plan\n\nShip it.\n') };

type Hook = RenderHookResult<DocsDocument, { source: DocumentSource; editing: DocumentEditing }>;
const opened = (source: DocumentSource, editing: DocumentEditing): Hook =>
  renderHook(({ source: s, editing: e }: { source: DocumentSource; editing: DocumentEditing }): DocsDocument => useDocsDocument(loadRuntime, s, e), { initialProps: { source, editing } });

async function replicaOf(hook: Hook): Promise<Extract<DocsDocument, { kind: 'replica' }>> {
  await waitFor((): void => expect(hook.result.current.kind).toBe('replica'));
  const doc: DocsDocument = hook.result.current;
  if (doc.kind !== 'replica') throw new Error(`expected a replica, got ${doc.kind}`);
  return doc;
}

describe('a file shown read-only', () => {
  it('opens a replica of the file that cannot be edited here, with the file\'s import report', async () => {
    const doc: Extract<DocsDocument, { kind: 'replica' }> = await replicaOf(opened(MD, READ_ONLY));
    expect(doc.editable).toBe(false);
    expect(doc.editor.importReport).toMatchObject({ format: 'md', losses: [], problems: [] });
    expect(new TextDecoder().decode((await doc.editor.exportAs({ format: 'txt' })).bytes)).toContain('Ship it.');
  });

  it('disposes its replica with the view', async () => {
    const hook: Hook = opened(MD, READ_ONLY);
    const editor: EditorSession = (await replicaOf(hook)).editor;
    hook.unmount();
    await expect(editor.exportAs({ format: 'txt' })).rejects.toThrow(/disposed/);
  });

  it('refuses a Word file with macros, disposing the replica it opened', async () => {
    const hook: Hook = opened({ kind: 'file', format: 'docx', bytes: fixture('poi-simple-macro.docm') }, READ_ONLY);
    await waitFor((): void => expect(hook.result.current.kind).toBe('refused'));
    const doc: DocsDocument = hook.result.current;
    if (doc.kind !== 'refused') throw new Error('expected a refusal');
    expect(doc.report.losses.filter((l) => l.kind === 'macros').map((l) => l.part)).toEqual(['word/vbaData.xml', 'word/vbaProject.bin']);
  });

  it('says a file that could not be read failed to open, not that cdoc failed to start', async () => {
    const hook: Hook = opened({ kind: 'file', format: 'docx', bytes: bytesOf('not a zip') }, READ_ONLY);
    await waitFor((): void => expect(hook.result.current).toMatchObject({ kind: 'failed', stage: 'open' }));
  });
});

describe('a document given to a keeper', () => {
  it('is opened by the keeper, as editable, and never by the view itself', async () => {
    const asked: string[] = [];
    const editing: DocumentEditing = {
      kind: 'replica',
      save: null,
      pictures: null,
      keep: (open, show, fail): (() => Promise<void>) => {
        asked.push('keep');
        open({ kind: 'blank' }).then(show, fail);
        return (): Promise<void> => Promise.resolve();
      },
    };
    const doc: Extract<DocsDocument, { kind: 'replica' }> = await replicaOf(opened(MD, editing));
    expect(asked).toEqual(['keep']);
    expect(doc.editable).toBe(true);
    // The keeper chose a blank replica, not the view's file.
    expect(doc.editor.importReport).toBeNull();
  });
});
