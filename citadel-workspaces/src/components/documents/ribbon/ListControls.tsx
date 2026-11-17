/**
 * Home › Paragraph › Bullets and Numbering: Word's built-in list templates (SetNumberingKind)
 * at the caret paragraph's list level, or the first level outside a list; None ends the list.
 * The editor names the list where the selection starts (a built-in kind, or custom for any
 * other definition), so Bullets is pressed in a bulleted list, Numbering and its matching
 * choice in a numbered one, and both show mixed when the selected paragraphs' lists differ.
 * The level a choice applies at is the reported list's. Moving between levels is Increase and
 * Decrease indent, and Increase refuses past the ninth level.
 */
import { List, ListOrdered, ListX } from 'lucide-react';
import type { CaretFormatting, ListKind } from '@/lib/cdoc/editor/controller';
import type { ListState } from '@/lib/cdoc/editor/caret-formatting';
import type { PressedState } from './formatting';
import { RibbonButton } from './RibbonButton';
import { MenuOption, RibbonMenu } from './RibbonMenu';
import { useRibbon, type Ribbon } from './ribbon-context';

interface NumberingChoice {
  readonly kind: ListKind;
  readonly label: string;
  readonly sample: string;
}

const NUMBERING: readonly NumberingChoice[] = [
  { kind: 'decimal', label: 'Numbers', sample: '1. 2. 3.' },
  { kind: 'lowerLetter', label: 'Lower-case letters', sample: 'a. b. c.' },
  { kind: 'upperLetter', label: 'Capital letters', sample: 'A. B. C.' },
  { kind: 'lowerRoman', label: 'Lower-case Roman', sample: 'i. ii. iii.' },
  { kind: 'upperRoman', label: 'Capital Roman', sample: 'I. II. III.' },
];

/** The first of a list's nine levels. */
const FIRST_LEVEL: number = 0;

/**
 * The list where the selection starts, as the editor reports it (record v6): null outside a list,
 * `unknown` before the first result or when the selected paragraphs' lists differ.
 */
export type CaretList = ListState | null | 'unknown';

export function caretList(caret: CaretFormatting): CaretList {
  return !caret.known || caret.listMixed ? 'unknown' : caret.list;
}

/** Pressed when the list is one of `kinds`; mixed while it is not known or differs. */
function pressedFor(list: CaretList, kinds: readonly ListState['kind'][]): PressedState {
  if (list === 'unknown') return 'mixed';
  return list !== null && kinds.includes(list.kind);
}

export function ListControls(): JSX.Element {
  const { caret, run }: Ribbon = useRibbon();
  const current: CaretList = caretList(caret);
  const level: number = current !== 'unknown' && current !== null ? current.level : FIRST_LEVEL;
  // Only a paragraph the editor reports as outside a list has none to end.
  const noList: string | null = current === null ? 'This paragraph is not in a list.' : null;
  const endList = (): void => { void run({ name: 'clearNumbering' }, 'end the list'); };
  const list = (kind: ListKind, what: string): void => { void run({ name: 'setNumberingKind', kind, level }, what); };
  return (
    <>
      <RibbonButton testId="ribbon-bullets" label="Bullets" icon={List} pressed={pressedFor(current, ['bullet'])} onPress={(): void => list('bullet', 'make a bulleted list')} />
      <RibbonButton testId="ribbon-list-none" label="No list" icon={ListX} unavailable={noList} onPress={endList} />
      <RibbonMenu testId="ribbon-numbering" label="Numbering" icon={ListOrdered} text="Numbering" widthPx={220}
        pressed={pressedFor(current, NUMBERING.map((n: NumberingChoice): ListKind => n.kind))}>
        {(close: () => void): JSX.Element[] => [
          ...NUMBERING.map((n: NumberingChoice): JSX.Element => (
            <MenuOption key={n.kind} testId={`ribbon-numbering-${n.kind}`} label={n.label} detail={n.sample} pressed={current === 'unknown' ? undefined : current?.kind === n.kind}
              onChoose={(): void => { close(); list(n.kind, `number the list with ${n.label.toLowerCase()}`); }} />
          )),
          <MenuOption key="none" testId="ribbon-numbering-none" label="None" detail="End the list here"
            onChoose={(): void => { close(); endList(); }} />,
        ]}
      </RibbonMenu>
    </>
  );
}
