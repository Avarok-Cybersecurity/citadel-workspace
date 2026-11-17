/**
 * Home › Styles: the document's own paragraph styles (use-document-styles.ts), each previewed in
 * its resolved look (face, size, weight, slant, colour) on the page's paper, applied with
 * SetParagraphStyle. The button names the caret's style once the engine reports it.
 */
import { Pilcrow } from 'lucide-react';
import { useState, type CSSProperties } from 'react';
import type { DocumentStyle } from '@/lib/cdoc/editor/controller';
import type { RunPropertiesPatch } from '@/lib/cdoc/editor/model-values';
import { FONT_MANIFEST } from '@/lib/cdoc/generated/font-manifest';
import { RASTERIZER_OPTIONS } from '@/lib/cdoc/paint/paint-config';
import { cn } from '@/lib/utils';
import { cssFontFamily } from './CdocFontFaces';
import { caretParagraph } from './formatting';
import { RIBBON_CONTROL } from './RibbonButton';
import { RibbonMenu } from './RibbonMenu';
import { RibbonGroup } from './RibbonToolbar';
import { useEditorController } from './editor-context';
import { useRibbon, type Ribbon } from './ribbon-context';
import { styleDisplayName, useDocumentStyles, type DocumentStyles } from './use-document-styles';

/** Previews are capped so Title does not dwarf the list; the relative sizes still read. */
const MAX_PREVIEW_PX: number = 22;
/** Word's automatic text colour on white paper. */
const AUTO_INK: string = '#000000';
/** Half-points to CSS px at 96 dpi: one point is 4/3 px. */
const PX_PER_HALF_POINT: number = 2 / 3;

export function previewStyle(run: RunPropertiesPatch): CSSProperties {
  return {
    fontFamily: run.font === undefined ? undefined : cssFontFamily(run.font, FONT_MANIFEST),
    fontSize: run.size === undefined ? undefined : `${Math.min(run.size * PX_PER_HALF_POINT, MAX_PREVIEW_PX)}px`,
    fontWeight: run.bold === true ? 700 : 400,
    fontStyle: run.italic === true ? 'italic' : 'normal',
    color: run.color ?? AUTO_INK,
  };
}

function StyleOption({ style, current, onChoose }: { style: DocumentStyle; current: boolean | 'mixed'; onChoose: () => void }): JSX.Element {
  const { disabledReason }: Ribbon = useRibbon();
  return (
    <button
      type="button"
      data-roving-item=""
      data-testid={`ribbon-style-${style.id}`}
      aria-pressed={current}
      aria-disabled={disabledReason !== null}
      onClick={(): void => { if (disabledReason === null) onChoose(); }}
      // Paper, not the theme: a style previews as it prints, in light and dark alike.
      className={cn(RIBBON_CONTROL, 'w-full justify-start border border-border px-3 text-left hover:ring-2 hover:ring-ring aria-[pressed=true]:ring-2 aria-[pressed=true]:ring-primary')}
      style={{ backgroundColor: RASTERIZER_OPTIONS.paper }}
    >
      <span className="truncate" style={previewStyle(style.run)}>{styleDisplayName(style)}</span>
    </button>
  );
}

export function StylesGallery(): JSX.Element {
  const { caret, run }: Ribbon = useRibbon();
  const [opened, setOpened] = useState<number>(0);
  const sheet: DocumentStyles = useDocumentStyles(useEditorController(), opened);
  const currentId: string | null = caretParagraph(caret, 'style');
  const current: DocumentStyle | undefined = sheet.kind === 'ready' ? sheet.styles.find((s: DocumentStyle): boolean => s.id === currentId) : undefined;
  return (
    <RibbonMenu testId="ribbon-styles" label="Styles" icon={Pilcrow} text={current === undefined ? 'Styles' : styleDisplayName(current)} widthPx={260}
      onOpen={(): void => setOpened((n: number): number => n + 1)}>
      {(close: () => void): JSX.Element | JSX.Element[] => {
        if (sheet.kind !== 'ready') {
          return <p role="status" data-testid="ribbon-styles-status" className="px-2 py-3 text-[14px] text-muted-foreground">{sheet.kind === 'loading' ? 'Reading the document’s styles…' : sheet.message}</p>;
        }
        return sheet.styles.map((style: DocumentStyle): JSX.Element => (
          <StyleOption key={style.id} style={style} current={currentId === null ? 'mixed' : style.id === currentId}
            onChoose={(): void => { close(); void run({ name: 'setParagraphStyle', style: style.id }, `apply the ${styleDisplayName(style)} style`); }} />
        ));
      }}
    </RibbonMenu>
  );
}

export function StylesGroup(): JSX.Element {
  return (
    <RibbonGroup label="Styles" testId="ribbon-styles-group" collapses={false} icon={Pilcrow}>
      <StylesGallery />
    </RibbonGroup>
  );
}
