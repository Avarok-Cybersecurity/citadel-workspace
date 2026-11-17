/**
 * The editor half of the worker host: answers the editor kinds from the open EditorEngine.
 * CdocHost owns the session's lifetime (opening one replaces any other document) and the
 * painter; this module only maps requests onto the engine, one call each.
 */
import type { CdocEngine } from '../engine/cdoc-engine';
import type { EditorEngine } from '../engine/editor-engine';
import { PENDING_LIMITS } from '../engine/engine-limits';
import type { EditorRequestBody, EditorResults } from './editor-protocol';

export type EditorSessionRequest = Exclude<EditorRequestBody, { kind: 'editorOpen' } | { kind: 'invalidatePages' }>;

export async function openEditor(engine: CdocEngine, req: Extract<EditorRequestBody, { kind: 'editorOpen' }>): Promise<{ readonly editor: EditorEngine; readonly result: EditorResults['editorOpen'] }> {
  const editor: EditorEngine = await engine.openEditor(req.client, req.from);
  const awareness: Uint8Array = editor.awareness();
  // The opening caret and selection: this replica's own awareness, mapped as a peer's would be.
  const view: Uint8Array = editor.peerView(awareness.slice());
  return { editor, result: { pageSizes: editor.pageSizes(), awareness, view, importReportJson: editor.importReportJson } };
}

export function serveEditor(engine: CdocEngine, editor: EditorEngine, req: EditorSessionRequest): EditorResults[EditorSessionRequest['kind']] | Promise<EditorResults['exportAs']> {
  switch (req.kind) {
    case 'apply': return { result: editor.request(req.record) };
    case 'applyRemote': return { result: editor.applyRemote(req.update, PENDING_LIMITS) };
    case 'hitTest': return { position: editor.hitTest(req.page, req.x, req.y) };
    case 'snapshot': return { snapshot: editor.snapshot() };
    case 'awareness': return { record: editor.awareness() };
    case 'peerView': return { record: editor.peerView(req.record) };
    case 'pageSizes': return { pageSizes: editor.pageSizes() };
    case 'stateVector': return { stateVector: editor.stateVector() };
    case 'encodeDiff': return { update: editor.encodeDiff(req.sv) };
    case 'encodeDiffChunked': return { record: editor.encodeDiffChunked(req.sv, req.maxBytes) };
    case 'gc': return { record: editor.collectGarbage(req.known) };
    case 'addImage': return { record: editor.addImage(req.bytes, req.maxBytes) };
    case 'selectionText': return { text: editor.selectionText() };
    case 'styles': return { record: editor.styles() };
    case 'image': return { record: editor.image(req.contentId) };
    case 'exportAs':
      if (req.target.format === 'pdf') return engine.writePdf(editor, req.target.nowRfc3339).then((bytes: Uint8Array) => ({ bytes, reportJson: null }));
      return editor.exportAs(req.target);
    case 'missingPatterns': {
      const registered: ReadonlySet<string> = new Set<string>(editor.patterns);
      return { tags: engine.patternsNeeded(editor.modelJson()).filter((tag: string): boolean => !registered.has(tag)) };
    }
  }
}
