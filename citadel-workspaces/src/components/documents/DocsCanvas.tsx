/**
 * Citadel Docs inside DocumentHost: loads the cdoc runtime (worker + renderer) when it mounts,
 * shows the page view, and fills the host's status bar. A blank document or a file opens as a
 * replica (use-docs-document): edited in EditorPageView when a ReplicaKeeper keeps it, else shown
 * read-only; Docs' own JSON (pm, model) is laid out static. "Download as…" writes the replica.
 * DocumentHost imports this lazily, and this reaches cdoc only through `loadRuntime`, so neither
 * is in the shell's bundle.
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { isStaticSource, type DocumentSource } from '@/lib/cdoc/document-source';
import type { CdocRuntimeFactory } from '@/lib/cdoc/runtime-loader';
import type { ConversionReport, ExportedFile, ExportTarget } from '@/lib/cdoc/editor/file-formats';
import type { DocumentFiles } from '@/lib/document-files';
import { DocsDocumentBar, PENDING, type Pending } from './page-view/DocsDocumentBar';
import type { DocsExporter } from './page-view/useDocsExport';
import { OpenFailed, PageView, ReplicaReadView, type PageStatus } from './PageView';
import { NotOpened, type OriginalFile } from './NotOpened';
import { useDocsDocument, type DocsDocument, type DocumentEditing } from './use-docs-document';
import { EditorPageView } from './EditorPageView';
import type { EditorSession } from '@/lib/cdoc/editor/editor-session';
import { CARET_BLINK_MS, HYPHENATION_CHECK_IDLE_MS, UNDO_PAUSE_MS, platformOf } from '@/lib/cdoc/editor/editor-config';
import { useMotionTier } from '@/hooks/use-motion-tier';
import type { Repeat } from '@/lib/cdoc/editor/caret-blink';
import type { EditorController } from '@/lib/cdoc/editor/controller';
import type { EditorSurfaceOptions } from './page-view/use-editor-surface';
import type { Ctx2D } from '@/lib/cdoc/paint/canvas-port';
import { DocsStatusBar } from './page-view/DocsStatusBar';
import { pageStatusStore, type PageStatusStore } from './page-view/page-status';
import type { PaintAhead } from './page-view/warm-pages';
import { PAINT_AHEAD_MOUNTS_PER_TICK, PAINT_AHEAD_PAGES } from '@/lib/cdoc/paint/paint-config';
import { useHyphenationNotice, type Delay } from './page-view/use-hyphenation-notice';
import { useDevicePixelRatio } from './page-view/use-device-pixel-ratio';
import { INITIAL_ZOOM } from './page-view/zoom';
import type { ActionGate } from '@/hooks/use-permission-result';
import { DocsRibbon } from './ribbon/DocsRibbon';
import { EditorControllerContext } from './ribbon/editor-context';
import { browserRibbonEnvironment, type RibbonEnvironment } from './ribbon/ribbon-environment';
import { AppLoadingPane } from '@/components/app-loading/AppLoadingPane';
import type { EngineLoad } from '@/lib/cdoc/worker/engine-load';
import type { ValueStore } from '@/lib/value-store';
import { docsLoadStage } from './docs-load-stage';
import { citadelApp } from '@/lib/citadel-apps/registry';

export interface DocsCanvasProps {
  readonly documentSource: DocumentSource;
  readonly loadRuntime: CdocRuntimeFactory;
  /** A kept replica to edit, or a read-only view and why (DocumentHost decides); must keep its identity across renders. */
  readonly editing: DocumentEditing;
  /** The host's status bar; null until it has mounted. */
  readonly statusBar: HTMLElement | null;
  /** Whether the person may change the document; the ribbon says why not when they may not. */
  readonly edit: ActionGate;
  readonly commentAuthor: string | null;
  /** The document's name, which downloads are named after. */
  readonly title: string;
  readonly files: DocumentFiles;
  /** The file this document was opened from (DocumentHost's), offered if the engine refuses it. */
  readonly original: OriginalFile | null;
}

const DOCS_APP_NAME: string = citadelApp('docs').name;
const MACROS_REFUSED: string = 'This file contains macros, which Citadel Docs never runs or keeps, so it is not opened here. The file itself is unchanged.';

const browserRepeat: Repeat = (ms: number, tick: () => void): (() => void) => {
  const id: number = window.setInterval(tick, ms);
  return (): void => window.clearInterval(id);
};

const browserDelay: Delay = (ms: number, task: () => void): (() => void) => {
  const id: number = window.setTimeout(task, ms);
  return (): void => window.clearTimeout(id);
};

/**
 * Idle time where the browser reports it; Safari has no requestIdleCallback, and there the task
 * waits a frame and a half instead, behind whatever input and paint that frame had.
 */
const SAFARI_IDLE_DELAY_MS: number = 25;
const browserIdle = (task: () => void): (() => void) => {
  if (typeof window.requestIdleCallback === 'function') {
    const id: number = window.requestIdleCallback(task);
    return (): void => window.cancelIdleCallback(id);
  }
  const id: number = window.setTimeout(task, SAFARI_IDLE_DELAY_MS);
  return (): void => window.clearTimeout(id);
};
const PAINT_AHEAD: PaintAhead = { warmPages: PAINT_AHEAD_PAGES, mountsPerTick: PAINT_AHEAD_MOUNTS_PER_TICK, idle: browserIdle };

const browserFrame = (task: () => void): (() => void) => {
  const id: number = window.requestAnimationFrame(task);
  return (): void => window.cancelAnimationFrame(id);
};

const NO_ENGINE_YET = (): (() => void) => (): void => undefined;
const NO_ENGINE = (): null => null;

/** The engine's download while the document opens; null before the runtime exists. */
function useEngineLoad(store: ValueStore<EngineLoad> | null): EngineLoad | null {
  return useSyncExternalStore<EngineLoad | null>(store?.subscribe ?? NO_ENGINE_YET, store?.get ?? NO_ENGINE);
}

export default function DocsCanvas({ documentSource, loadRuntime, editing, statusBar, edit, commentAuthor, title, files, original }: DocsCanvasProps): JSX.Element {
  const doc: DocsDocument = useDocsDocument(loadRuntime, documentSource, editing);
  const engineLoad: EngineLoad | null = useEngineLoad(doc.kind === 'opening' ? doc.runtime.engineLoad : null);
  const [zoom, setZoom] = useState<number>(INITIAL_ZOOM);
  const status: PageStatusStore = useMemo(pageStatusStore, []);
  const dpr: number = useDevicePixelRatio();
  const ribbonEnvironment: RibbonEnvironment = useMemo(browserRibbonEnvironment, []);
  const onPageStatus: (next: PageStatus) => void = status.set;
  const [editError, setEditError] = useState<string | null>(null);
  const overlayContext: ((canvas: HTMLCanvasElement) => Ctx2D) | null = doc.kind === 'replica' ? doc.runtime.overlayContext : null;
  // The caret blinks unless motion is off (the OS asks for reduced motion, or the Animations setting).
  const steadyCaret: boolean = useMotionTier() === 'off';
  const input: EditorSurfaceOptions | null = useMemo(() => (overlayContext === null ? null : {
    overlayContext,
    platform: platformOf(navigator.userAgent),
    undoPauseMs: UNDO_PAUSE_MS,
    onError: (error: unknown): void => setEditError(error instanceof Error ? error.message : String(error)),
    writeClipboard: ribbonEnvironment.writeClipboard,
    caretBlink: { phaseMs: CARET_BLINK_MS, repeat: browserRepeat, reducedMotion: steadyCaret },
    frame: browserFrame,
  }), [overlayContext, steadyCaret, ribbonEnvironment]);

  /**
   * The live controller, one value, null while the editor opens (or for a read-only view): what
   * the ribbon's EditorControllerContext.Provider is given. A blank document opens ready to type:
   * the editor takes the keyboard once its surface has mounted (child effects run first).
   */
  const replica: EditorSession | null = doc.kind === 'replica' ? doc.editor : null;
  const controller: EditorController | null = doc.kind === 'replica' && doc.editable ? doc.editor : null;
  useEffect((): void => {
    controller?.focus();
  }, [controller]);
  const notice: string | null = useHyphenationNotice(controller, HYPHENATION_CHECK_IDLE_MS, browserDelay);

  // "Download as…" writes the replica, editable or read-only; Docs' own JSON shown static has no export.
  const exporter: DocsExporter | Pending | null = useMemo((): DocsExporter | Pending | null => {
    if (replica !== null) return (target: ExportTarget): Promise<ExportedFile> => replica.exportAs(target);
    return doc.kind === 'loading' || doc.kind === 'opening' ? PENDING : null;
  }, [replica, doc.kind]);
  const importReport: ConversionReport | Pending | null = documentSource.kind !== 'file' ? null
    : doc.kind === 'loading' || doc.kind === 'opening' ? PENDING : doc.kind === 'replica' ? doc.editor.importReport : doc.kind === 'refused' ? doc.report : null;
  // Page and zoom mean nothing for a document that was refused or failed to open.
  const showsPages: boolean = doc.kind === 'loading' || doc.kind === 'opening' || doc.kind === 'static' || doc.kind === 'replica';
  const shown: boolean = doc.kind !== 'loading' && !(doc.kind === 'failed' && doc.stage === 'start');

  return (
    <>
      {/* The ribbon drives the open editor; with none (loading, or a read-only conversion) there is no ribbon. */}
      <EditorControllerContext.Provider value={controller}>
        <DocsRibbon edit={edit} commentAuthor={commentAuthor} environment={ribbonEnvironment} pictures={editing.kind === 'replica' ? editing.pictures : null} />
      </EditorControllerContext.Provider>
      {shown && <DocsDocumentBar title={title} files={files} importReport={importReport} refused={doc.kind === 'refused'} exporter={exporter} />}
      {doc.kind === 'replica' && doc.editable && input !== null && (
        <EditorPageView editor={doc.editor} renderer={doc.runtime.renderer} zoom={zoom} dpr={dpr} onZoomChange={setZoom} onPageStatus={onPageStatus} input={input} paintAhead={PAINT_AHEAD} />
      )}
      {doc.kind === 'replica' && !doc.editable && (
        <ReplicaReadView editor={doc.editor} renderer={doc.runtime.renderer} zoom={zoom} dpr={dpr} onZoomChange={setZoom} onPageStatus={onPageStatus} paintAhead={PAINT_AHEAD} />
      )}
      {editError !== null && <p role="alert" className="border-t p-2 text-sm text-destructive">That edit was not made. {editError}</p>}
      {doc.kind === 'static' && isStaticSource(documentSource) && (
        <PageView client={doc.runtime.client} renderer={doc.runtime.renderer} source={documentSource} zoom={zoom} dpr={dpr} onZoomChange={setZoom} onPageStatus={onPageStatus} paintAhead={PAINT_AHEAD} />
      )}
      {doc.kind === 'refused' && (original !== null
        ? <NotOpened original={original} why={MACROS_REFUSED} testId="page-view-refused" />
        : <p role="alert" data-testid="page-view-refused" className="p-6 text-sm text-foreground">{MACROS_REFUSED}</p>)}
      {doc.kind === 'failed' && doc.stage === 'open' && <OpenFailed message={doc.message} />}
      {(doc.kind === 'loading' || doc.kind === 'opening') && <AppLoadingPane appName={DOCS_APP_NAME} stage={docsLoadStage(engineLoad)} />}
      {doc.kind === 'failed' && doc.stage === 'start' && <p role="alert" className="m-auto p-6 text-sm text-destructive">Citadel Docs could not start. {doc.message}</p>}
      {statusBar !== null && showsPages && createPortal(<DocsStatusBar status={status} notice={notice} zoom={zoom} onZoomChange={setZoom} />, statusBar)}
    </>
  );
}
