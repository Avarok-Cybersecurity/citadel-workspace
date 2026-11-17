/**
 * The read-only page views: Docs' own JSON opened in cdoc (PageView), and a replica shown
 * without input (ReplicaReadView), both in the page column. The editable view (EditorPageView)
 * shares the column and adds the editor's input and overlays.
 */
import { useEffect, useRef, useState, type RefObject } from 'react';
import type { StaticSource } from '@/lib/cdoc/document-source';
import type { OpenedDocument } from '@/lib/cdoc/engine/cdoc-engine';
import type { CdocClient } from '@/lib/cdoc/worker/cdoc-client';
import type { PageRenderer } from '@/lib/cdoc/paint/page-renderer';
import type { EditorSession } from '@/lib/cdoc/editor/editor-session';
import { messageOf, PageColumn, type PageStatus } from './page-view/PageColumn';
import type { PaintAhead } from './page-view/warm-pages';

export { PAGE_GAP_PX, type PageStatus } from './page-view/PageColumn';

interface ColumnProps {
  readonly renderer: PageRenderer;
  readonly zoom: number;
  readonly dpr: number;
  readonly onZoomChange: (zoom: number) => void;
  readonly onPageStatus: (status: PageStatus) => void;
  readonly paintAhead: PaintAhead;
}

export interface PageViewProps extends ColumnProps {
  readonly client: CdocClient;
  readonly source: StaticSource;
}

type Opened =
  | { readonly kind: 'opening' }
  | { readonly kind: 'open'; readonly sizes: Int32Array }
  | { readonly kind: 'failed'; readonly message: string };

/** Said when a document could not be opened, whichever view tried. */
export function OpenFailed({ message }: { readonly message: string }): JSX.Element {
  return <p role="alert" data-testid="page-view-error" className="p-6 text-sm text-destructive">This document could not be opened. {message}</p>;
}

export function PageView({ client, renderer, source, zoom, dpr, onZoomChange, onPageStatus, paintAhead }: PageViewProps): JSX.Element {
  const scroller: RefObject<HTMLDivElement> = useRef<HTMLDivElement>(null);
  const [opened, setOpened] = useState<Opened>({ kind: 'opening' });

  useEffect((): (() => void) => {
    let live: boolean = true;
    setOpened({ kind: 'opening' });
    renderer.reset();
    client.request({ kind: 'open', source }).then(
      (doc: OpenedDocument): void => {
        if (live) setOpened({ kind: 'open', sizes: doc.pageSizes });
      },
      (error: unknown): void => {
        if (live) setOpened({ kind: 'failed', message: messageOf(error) });
      },
    );
    return (): void => { live = false; };
  }, [client, renderer, source]);

  if (opened.kind === 'failed') return <OpenFailed message={opened.message} />;
  return (
    <PageColumn
      renderer={renderer} sizes={opened.kind === 'open' ? opened.sizes : null} zoom={zoom} dpr={dpr}
      onZoomChange={onZoomChange} onPageStatus={onPageStatus} scroller={scroller} editing={null} paintAhead={paintAhead}
    >
      {null}
    </PageColumn>
  );
}

/** A replica shown read-only: its pages and nothing that takes input (no textarea, no caret). */
export function ReplicaReadView({ editor, renderer, zoom, dpr, onZoomChange, onPageStatus, paintAhead }: ColumnProps & { readonly editor: EditorSession }): JSX.Element {
  const scroller: RefObject<HTMLDivElement> = useRef<HTMLDivElement>(null);
  return (
    <PageColumn
      renderer={renderer} sizes={editor.pageSizes} zoom={zoom} dpr={dpr}
      onZoomChange={onZoomChange} onPageStatus={onPageStatus} scroller={scroller} editing={null} paintAhead={paintAhead}
    >
      {null}
    </PageColumn>
  );
}
