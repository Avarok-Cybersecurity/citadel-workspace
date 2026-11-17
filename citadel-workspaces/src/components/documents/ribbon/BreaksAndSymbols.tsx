/**
 * Breaks (page, column, line: InsertBreak), Footnote (InsertNewFootnote: the editor picks its id,
 * then GoToFootnote with that id, since the insert leaves the caret in the body and the note is
 * what the person types next, as in Word) and Symbol (a small picker that types the character
 * with InsertText).
 */
import { useState } from 'react';
import { Asterisk, Columns2, Omega, SeparatorHorizontal, WrapText, type LucideIcon } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { BreakKind, Created, EditorState } from '@/lib/cdoc/editor/controller';
import type { RibbonEditor } from './editor-context';
import { cn } from '@/lib/utils';
import { RIBBON_CONTROL, RibbonButton, type Shortcut } from './RibbonButton';
import { RibbonToolbar } from './RibbonToolbar';
import { useRibbon, type Ribbon } from './ribbon-context';

interface BreakControl {
  readonly kind: BreakKind;
  readonly label: string;
  readonly icon: LucideIcon;
  /** Line break is Shift+Enter, with no command key, which a Shortcut does not name. */
  readonly shortcut?: Shortcut;
}

const BREAKS: readonly BreakControl[] = [
  { kind: 'page', label: 'Page break', icon: SeparatorHorizontal, shortcut: { key: 'Enter' } },
  { kind: 'column', label: 'Column break', icon: Columns2, shortcut: { key: 'Enter', shift: true } },
  { kind: 'line', label: 'Line break', icon: WrapText },
];

export function BreakButtons({ idPrefix }: { idPrefix: string }): JSX.Element {
  const { run }: Ribbon = useRibbon();
  return (
    <>
      {BREAKS.map((b: BreakControl): JSX.Element => (
        <RibbonButton key={b.kind} testId={`${idPrefix}-break-${b.kind}`} label={b.label} icon={b.icon} text={b.label}
          shortcut={b.shortcut}
          onPress={(): void => { void run({ name: 'insertBreak', kind: b.kind }, `insert a ${b.label.toLowerCase()}`); }} />
      ))}
    </>
  );
}

export function FootnoteButton(): JSX.Element {
  const { attempt }: Ribbon = useRibbon();
  const insert = async (editor: RibbonEditor): Promise<void> => {
    const inserted: EditorState = await editor.execute({ name: 'insertNewFootnote' });
    const made: Created | undefined = inserted.created.find((c: Created): boolean => c.kind === 'footnote');
    if (made === undefined) throw new Error('the editor reported no footnote id');
    await editor.execute({ name: 'goToFootnote', id: made.id });
  };
  return (
    <RibbonButton testId="ribbon-insert-footnote" label="Insert footnote" icon={Asterisk} text="Footnote"
      onPress={(): void => { void attempt('insert the footnote', insert); }} />
  );
}

/** The characters Word offers first in its Symbol menu that a keyboard rarely has. */
export const SYMBOLS: readonly string[] = ['©', '®', '™', '§', '¶', '†', '‡', '•', '…', '–', '—', '€', '£', '¥', '°', '±', '×', '÷', '≠', '≤', '≥', '∞', 'µ', 'π', 'Ω', '←', '→', '↑', '↓', '✓'];

export function SymbolPicker(): JSX.Element {
  const { run, disabledReason }: Ribbon = useRibbon();
  const [open, setOpen] = useState<boolean>(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <RibbonButton testId="ribbon-insert-symbol" label="Symbol" icon={Omega} text="Symbol" />
      </PopoverTrigger>
      <PopoverContent align="end" collisionPadding={16} className="w-[min(328px,calc(100vw-32px))] p-2">
        <RibbonToolbar label="Symbols" testId="ribbon-symbols" className="gap-[2px]">
          {SYMBOLS.map((symbol: string): JSX.Element => (
            <button key={symbol} type="button" data-roving-item="" data-testid={`ribbon-symbol-${symbol.codePointAt(0)?.toString(16)}`}
              aria-label={`Insert ${symbol}`} aria-disabled={disabledReason !== null} className={cn(RIBBON_CONTROL, 'text-[18px]')}
              onClick={(): void => {
                if (disabledReason !== null) return;
                setOpen(false);
                void run({ name: 'insertText', text: symbol }, `insert ${symbol}`);
              }}>
              {symbol}
            </button>
          ))}
        </RibbonToolbar>
      </PopoverContent>
    </Popover>
  );
}
