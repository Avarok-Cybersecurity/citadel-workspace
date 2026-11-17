/**
 * Paragraph spacing and indent fields, in points (Pt100 on the wire), shared by Home and
 * Layout. ParagraphPatch is field-wise, so each field sends only its own member and its
 * siblings are kept by the engine; a field shows the caret's value, or nothing while that
 * value is not known or differs across the selected paragraphs.
 */
import type { CaretFormatting } from '@/lib/cdoc/editor/controller';
import type { Indent, ParagraphPatch, Pt100, Spacing } from '@/lib/cdoc/editor/model-values';
import { PARAGRAPH_MEASURE_MAX_PT } from '@/lib/cdoc/ui-input-limits';
import { caretParagraph, pointsToPt100, pt100ToPoints } from './formatting';
import { RibbonNumberField } from './RibbonFields';
import { useRibbon, type Ribbon } from './ribbon-context';

type SpacingKey = 'before' | 'after';
type IndentKey = 'left' | 'right';


export function spacingPatch(key: SpacingKey, value: Pt100): ParagraphPatch {
  return { spacing: { [key]: value } };
}

export function indentPatch(key: IndentKey, value: Pt100): ParagraphPatch {
  return { indent: { [key]: value } };
}

function spacingPoints(caret: CaretFormatting, key: SpacingKey): number | null {
  const spacing: Spacing | null = caretParagraph(caret, 'spacing');
  return spacing?.[key] === undefined ? null : pt100ToPoints(spacing[key]);
}

function indentPoints(caret: CaretFormatting, key: IndentKey): number | null {
  const indent: Indent | null = caretParagraph(caret, 'indent');
  return indent?.[key] === undefined ? null : pt100ToPoints(indent[key]);
}

const SPACING_LABELS: Readonly<Record<SpacingKey, string>> = { before: 'Before', after: 'After' };
const INDENT_LABELS: Readonly<Record<IndentKey, string>> = { left: 'Left', right: 'Right' };

export function SpacingFields({ idPrefix }: { idPrefix: string }): JSX.Element {
  const { caret, run }: Ribbon = useRibbon();
  return (
    <>
      {(['before', 'after'] as const).map((key: SpacingKey): JSX.Element => (
        <RibbonNumberField key={key} testId={`${idPrefix}-spacing-${key}`} label={`Spacing ${SPACING_LABELS[key].toLowerCase()}`} shortLabel={SPACING_LABELS[key]} unit="pt" min={0} max={PARAGRAPH_MEASURE_MAX_PT} unavailable={null}
          value={spacingPoints(caret, key)}
          onCommit={(points: number): void => { void run({ name: 'setParagraphProperty', patch: spacingPatch(key, pointsToPt100(points)) }, `change the spacing ${key}`); }} />
      ))}
    </>
  );
}

export function IndentFields({ idPrefix }: { idPrefix: string }): JSX.Element {
  const { caret, run }: Ribbon = useRibbon();
  return (
    <>
      {(['left', 'right'] as const).map((key: IndentKey): JSX.Element => (
        <RibbonNumberField key={key} testId={`${idPrefix}-indent-${key}`} label={`Indent ${INDENT_LABELS[key].toLowerCase()}`} shortLabel={INDENT_LABELS[key]} unit="pt" min={-PARAGRAPH_MEASURE_MAX_PT} max={PARAGRAPH_MEASURE_MAX_PT} unavailable={null}
          value={indentPoints(caret, key)}
          onCommit={(points: number): void => { void run({ name: 'setParagraphProperty', patch: indentPatch(key, pointsToPt100(points)) }, `change the ${key} indent`); }} />
      ))}
    </>
  );
}
