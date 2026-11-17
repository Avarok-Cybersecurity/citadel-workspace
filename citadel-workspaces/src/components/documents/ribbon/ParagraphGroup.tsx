/**
 * Home › Paragraph: bullets and numbering (ListControls), indent and outdent (list level for a list item, a tab stop otherwise, as
 * the engine does), alignment, line spacing (Multiple, Word's list) and spacing before/after.
 */
import { AlignCenter, AlignJustify, AlignLeft, AlignRight, IndentDecrease, IndentIncrease, Pilcrow, type LucideIcon } from 'lucide-react';
import type { Alignment, LineSpacing } from '@/lib/cdoc/editor/model-values';
import { WORD_LINE_SPACINGS, alignmentState, caretParagraph, lineSpacingLabel } from './formatting';
import { RibbonButton, type Shortcut } from './RibbonButton';
import { RibbonPicker, type PickerOption } from './RibbonFields';
import { RibbonGroup } from './RibbonToolbar';
import { MAX_LIST_LEVEL } from '@/lib/cdoc/engine/engine-limits';
import { ListControls, caretList, type CaretList } from './ListControls';

const DEEPEST_LEVEL: string = 'This list item is at the deepest of a list’s nine levels.';
import { SpacingFields } from './ParagraphFields';
import { useRibbon, type Ribbon } from './ribbon-context';

interface AlignControl {
  readonly alignment: Alignment;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly shortcut: Shortcut;
}

const ALIGNMENTS: readonly AlignControl[] = [
  { alignment: 'left', label: 'Align left', icon: AlignLeft, shortcut: { key: 'L' } },
  { alignment: 'center', label: 'Centre', icon: AlignCenter, shortcut: { key: 'E' } },
  { alignment: 'right', label: 'Align right', icon: AlignRight, shortcut: { key: 'R' } },
  { alignment: 'justify', label: 'Justify', icon: AlignJustify, shortcut: { key: 'J' } },
];

const LINE_OPTIONS: readonly PickerOption[] = WORD_LINE_SPACINGS.map((l: number): PickerOption => ({ value: String(l), label: lineSpacingLabel(l) }));

function caretLines(line: LineSpacing | undefined): string | null {
  return line !== undefined && line.rule === 'multiple' ? String(line.lines) : null;
}

export function ParagraphGroup(): JSX.Element {
  const { caret, run }: Ribbon = useRibbon();
  const list: CaretList = caretList(caret);
  const deepest: string | null = list !== 'unknown' && list !== null && list.level >= MAX_LIST_LEVEL ? DEEPEST_LEVEL : null;
  return (
    <RibbonGroup label="Paragraph" testId="ribbon-paragraph" collapses={true} icon={Pilcrow}>
      <ListControls />
      <RibbonButton testId="ribbon-outdent" label="Decrease indent" icon={IndentDecrease} shortcut={{ key: 'M', shift: true }}
        onPress={(): void => { void run({ name: 'outdent' }, 'decrease the indent'); }} />
      <RibbonButton testId="ribbon-indent" label="Increase indent" icon={IndentIncrease} shortcut={{ key: 'M' }} unavailable={deepest}
        onPress={(): void => { void run({ name: 'indent' }, 'increase the indent'); }} />
      {ALIGNMENTS.map((a: AlignControl): JSX.Element => (
        <RibbonButton key={a.alignment} testId={`ribbon-align-${a.alignment}`} label={a.label} icon={a.icon} shortcut={a.shortcut} pressed={alignmentState(caret, a.alignment)}
          onPress={(): void => { void run({ name: 'setParagraphProperty', patch: { alignment: a.alignment } }, a.label.toLowerCase()); }} />
      ))}
      <RibbonPicker testId="ribbon-line-spacing" label="Line spacing" options={LINE_OPTIONS} widthPx={72} unavailable={null}
        value={caretLines(caretParagraph(caret, 'spacing')?.line)}
        onPick={(lines: string): void => {
          void run({ name: 'setParagraphProperty', patch: { spacing: { line: { rule: 'multiple', lines: Number(lines) } } } }, 'change the line spacing');
        }} />
      <SpacingFields idPrefix="ribbon-home" />
    </RibbonGroup>
  );
}
