/**
 * The editable page view: the page column over an EditorSession, with the hidden textarea
 * that takes the keyboard, pointer selection, dirty-page repaints and the selection, caret and
 * peer overlays. The textarea is visually hidden, not display:none, so it can hold focus and
 * receive IME composition; it is the element screen readers and IMEs talk to.
 */
import { useRef, type RefObject } from 'react';
import type { EditorSession } from '@/lib/cdoc/editor/editor-session';
import type { PageRenderer } from '@/lib/cdoc/paint/page-renderer';
import { deviceScale } from '@/lib/cdoc/paint/units';
import { PageColumn, type PageStatus } from './page-view/PageColumn';
import { useEditorSurface, type EditorSurface, type EditorSurfaceOptions } from './page-view/use-editor-surface';
import type { PaintAhead } from './page-view/warm-pages';

export interface EditorPageViewProps {
  readonly editor: EditorSession;
  readonly renderer: PageRenderer;
  readonly zoom: number;
  readonly dpr: number;
  readonly onZoomChange: (zoom: number) => void;
  readonly onPageStatus: (status: PageStatus) => void;
  readonly input: EditorSurfaceOptions;
  readonly paintAhead: PaintAhead;
}

export function EditorPageView({ editor, renderer, zoom, dpr, onZoomChange, onPageStatus, input, paintAhead }: EditorPageViewProps): JSX.Element {
  const scroller: RefObject<HTMLDivElement> = useRef<HTMLDivElement>(null);
  const surface: EditorSurface = useEditorSurface(editor, scroller, deviceScale(zoom, dpr), input);
  return (
    <PageColumn
      renderer={renderer} sizes={surface.pageSizes} zoom={zoom} dpr={dpr} onZoomChange={onZoomChange}
      onPageStatus={onPageStatus} scroller={scroller} editing={surface} paintAhead={paintAhead}
    >
      <textarea
        ref={surface.textarea}
        aria-label="Document text"
        aria-multiline="true"
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        // Writing assistants (Grammarly and the like) attach to editable fields and inject
        // overlays and console noise; this field is a keyboard bridge, not the text.
        data-gramm="false"
        data-gramm_editor="false"
        data-enable-grammarly="false"
        data-testid="editor-input"
        className="sr-only"
      />
    </PageColumn>
  );
}
