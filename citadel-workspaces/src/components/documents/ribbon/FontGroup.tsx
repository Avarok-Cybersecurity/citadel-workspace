/**
 * Home › Font: family (the faces the engine is served), size (Word's list, half-points),
 * grow and shrink, the six marks, text colour (or automatic), highlight (or none) and Clear
 * Formatting, which returns every run property to what the styles give.
 */
import { AArrowDown, AArrowUp, Ban, Baseline, Bold, CircleSlash, Highlighter, Italic, RemoveFormatting, Strikethrough, Subscript, Superscript, Type, Underline, type LucideIcon } from 'lucide-react';
import type { Mark } from '@/lib/cdoc/editor/controller';
import { CLEAR_FORMATTING } from '@/lib/cdoc/editor/caret-formatting';
import type { HexColor } from '@/lib/cdoc/editor/model-values';
import { FONT_MANIFEST } from '@/lib/cdoc/generated/font-manifest';
import { WORD_FONT_SIZES, caretRun, fontFamilies, grownSize, halfPointsLabel, markState, shrunkSize } from './formatting';
import { ColorControl } from './ColorControl';
import { RibbonButton, type Shortcut } from './RibbonButton';
import { RibbonPicker, type PickerOption } from './RibbonFields';
import { RibbonGroup } from './RibbonToolbar';
import { useRibbon, type Ribbon } from './ribbon-context';

interface MarkControl {
  readonly mark: Mark;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly shortcut: Shortcut;
}

const MARKS: readonly MarkControl[] = [
  { mark: 'bold', label: 'Bold', icon: Bold, shortcut: { key: 'B' } },
  { mark: 'italic', label: 'Italic', icon: Italic, shortcut: { key: 'I' } },
  { mark: 'underline', label: 'Underline', icon: Underline, shortcut: { key: 'U' } },
  { mark: 'strike', label: 'Strikethrough', icon: Strikethrough, shortcut: { key: 'X', shift: true } },
  { mark: 'subscript', label: 'Subscript', icon: Subscript, shortcut: { key: '=' } },
  { mark: 'superscript', label: 'Superscript', icon: Superscript, shortcut: { key: '=', shift: true } },
];

const FAMILY_OPTIONS: readonly PickerOption[] = fontFamilies(FONT_MANIFEST).map((f: string): PickerOption => ({ value: f, label: f }));
const SIZE_OPTIONS: readonly PickerOption[] = WORD_FONT_SIZES.map((s: number): PickerOption => ({ value: String(s), label: halfPointsLabel(s) }));
const SIZE_UNKNOWN: string = 'The size at the caret is not known yet, so there is nothing to grow from.';

export function FontGroup(): JSX.Element {
  const ribbon: Ribbon = useRibbon();
  const { caret, run } = ribbon;
  const font: string | null = caretRun(caret, 'font');
  const size: number | null = caretRun(caret, 'size');
  const grown: number | null = size === null ? null : grownSize(size);
  const shrunk: number | null = size === null ? null : shrunkSize(size);
  const setSize: (halfPoints: number) => Promise<void> = (halfPoints: number): Promise<void> => run({ name: 'setRunProperty', patch: { size: halfPoints } }, 'change the font size');
  return (
    <RibbonGroup label="Font" testId="ribbon-font" collapses={true} icon={Type}>
      <RibbonPicker testId="ribbon-font-family" label="Font" options={FAMILY_OPTIONS} value={font} widthPx={148} unavailable={null}
        onPick={(f: string): void => { void run({ name: 'setRunProperty', patch: { font: f } }, 'change the font'); }} />
      <RibbonPicker testId="ribbon-font-size" label="Font size" options={SIZE_OPTIONS} value={size === null ? null : String(size)} widthPx={72} unavailable={null}
        onPick={(s: string): void => { void setSize(Number(s)); }} />
      <RibbonButton testId="ribbon-grow-font" label="Increase font size" icon={AArrowUp} shortcut={{ key: '>', shift: true }}
        unavailable={size === null ? SIZE_UNKNOWN : grown === null ? 'This is the largest size in the list.' : null}
        onPress={(): void => { if (grown !== null) void setSize(grown); }} />
      <RibbonButton testId="ribbon-shrink-font" label="Decrease font size" icon={AArrowDown} shortcut={{ key: '<', shift: true }}
        unavailable={size === null ? SIZE_UNKNOWN : shrunk === null ? 'This is the smallest size in the list.' : null}
        onPress={(): void => { if (shrunk !== null) void setSize(shrunk); }} />
      {MARKS.map((m: MarkControl): JSX.Element => (
        <RibbonButton key={m.mark} testId={`ribbon-mark-${m.mark}`} label={m.label} icon={m.icon} shortcut={m.shortcut} pressed={markState(caret, m.mark)}
          onPress={(): void => { void run({ name: 'toggleMark', mark: m.mark }, `apply ${m.label.toLowerCase()}`); }} />
      ))}
      <ColorControl testId="ribbon-text-color" label="Font colour" icon={Baseline} value={caretRun(caret, 'color')}
        onPick={(color: HexColor): void => { void run({ name: 'setRunProperty', patch: { color } }, 'change the font colour'); }} />
      <RibbonButton testId="ribbon-text-color-auto" label="Automatic font colour" icon={CircleSlash} text="Automatic"
        onPress={(): void => { void run({ name: 'setRunProperty', patch: { color: null } }, 'set the font colour to automatic'); }} />
      <ColorControl testId="ribbon-highlight" label="Text highlight colour" icon={Highlighter} value={caretRun(caret, 'highlight')}
        onPick={(highlight: HexColor): void => { void run({ name: 'setRunProperty', patch: { highlight } }, 'highlight the text'); }} />
      <RibbonButton testId="ribbon-highlight-none" label="No highlight" icon={Ban} text="No highlight"
        onPress={(): void => { void run({ name: 'setRunProperty', patch: { highlight: null } }, 'remove the highlight'); }} />
      <RibbonButton testId="ribbon-clear-formatting" label="Clear formatting" icon={RemoveFormatting} shortcut={{ key: 'Space' }}
        onPress={(): void => { void run({ name: 'setRunProperty', patch: CLEAR_FORMATTING }, 'clear the formatting'); }} />
    </RibbonGroup>
  );
}
