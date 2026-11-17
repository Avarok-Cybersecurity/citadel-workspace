/**
 * Insert › Header & Footer, and the bar shown while the selection is in a story other than the
 * body (EditHeaderFooter, GoToFootnote, ReturnToBody: docs/edit-commands.md § Stories).
 *
 * Header and Footer are menus of the three a section can have (every page, the first page, even
 * pages); a choice puts the caret there, adding an empty one when the section has none. The
 * editor refuses one the section never shows (a first-page header without a distinct first
 * page), and the refusal says so like any other. The section is the one being edited when the caret is in a header or footer;
 * from the body it is the first, since the editor reports the caret's page setup but not which
 * section that is. Clicking a header or footer line on the page enters it too.
 *
 * A header or footer shown on many pages is one story, and the editor draws its caret and
 * selection on the first of those pages only. The bar says so, so a cursor that seems to stay
 * on page one while the header repeats below is explained, not mistaken for a fault.
 */
import { PanelBottom, PanelTop, type LucideIcon } from 'lucide-react';
import type { Furniture, HeaderFooterKind, Story } from '@/lib/cdoc/editor/controller';
import { RIBBON_CONTROL } from './RibbonButton';
import { MenuOption, RibbonMenu } from './RibbonMenu';
import { useRibbon, type Ribbon } from './ribbon-context';

/** The section the Header and Footer buttons edit: the current header's or footer's, else the first. */
function sectionFor(story: Story | null): number {
  return story !== null && (story.kind === 'header' || story.kind === 'footer') ? story.section : 0;
}

interface KindChoice {
  readonly which: HeaderFooterKind;
  readonly label: string;
  readonly detail: string;
}

const KINDS: readonly KindChoice[] = [
  { which: 'default', label: 'Every page', detail: 'The one most pages show' },
  { which: 'firstPage', label: 'First page', detail: 'Where the section’s first page differs' },
  { which: 'evenPages', label: 'Even pages', detail: 'Where odd and even pages differ' },
];

const FURNITURE: Readonly<Record<Furniture, { readonly label: string; readonly icon: LucideIcon }>> = {
  header: { label: 'Header', icon: PanelTop },
  footer: { label: 'Footer', icon: PanelBottom },
};

function FurnitureMenu({ furniture }: { furniture: Furniture }): JSX.Element {
  const { run, story }: Ribbon = useRibbon();
  const here: HeaderFooterKind | null = story !== null && story.kind === furniture ? story.which : null;
  const { label, icon } = FURNITURE[furniture];
  return (
    <RibbonMenu testId={`ribbon-edit-${furniture}`} label={`Edit the ${furniture}`} icon={icon} text={label} widthPx={260} pressed={here !== null}>
      {(close: () => void): JSX.Element[] => KINDS.map((k: KindChoice): JSX.Element => (
        <MenuOption key={k.which} testId={`ribbon-edit-${furniture}-${k.which}`} label={k.label} detail={k.detail} pressed={here === k.which}
          onChoose={(): void => {
            close();
            void run({ name: 'editHeaderFooter', furniture, section: sectionFor(story), which: k.which }, `edit the ${k.label.toLowerCase()} ${furniture}`);
          }} />
      ))}
    </RibbonMenu>
  );
}

export function HeaderFooterButtons(): JSX.Element {
  return (
    <>
      <FurnitureMenu furniture="header" />
      <FurnitureMenu furniture="footer" />
    </>
  );
}

const WHICH: Readonly<Record<Extract<Story, { kind: Furniture }>['which'], string>> = {
  default: '',
  firstPage: ' (first page)',
  evenPages: ' (even pages)',
};

/** What the bar says about `story`; null in the body, where there is no bar. */
export function storyNotice(story: Story | null): string | null {
  if (story === null || story.kind === 'body') return null;
  if (story.kind === 'footnote') return 'Editing a footnote.';
  return `Editing the ${story.kind}${WHICH[story.which]} of section ${story.section + 1}. It shows on every page of the section; its cursor and selection are drawn on the first of them.`;
}

export function StoryBar(): JSX.Element | null {
  const { run, story }: Ribbon = useRibbon();
  const notice: string | null = storyNotice(story);
  if (notice === null) return null;
  return (
    <div data-testid="docs-story-bar" className="mt-1 flex flex-wrap items-center justify-between gap-x-3 rounded-md bg-muted px-3 text-[14px] text-foreground">
      <p className="min-w-0 py-2">{notice}</p>
      <button type="button" data-testid="docs-story-back" className={RIBBON_CONTROL}
        onClick={(): void => { void run({ name: 'returnToBody' }, 'return to the document'); }}>
        Back to the document
      </button>
    </div>
  );
}
