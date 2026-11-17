/**
 * Layout › Page Setup: Margins, Orientation, Size and Columns, each a menu of choices that
 * sends one SetSectionProperty for the sections the selection spans. The caret section's
 * current setup is the pressed choice; before the editor reports it no choice says pressed
 * or not (the status line says why), and Size waits for it, since a size keeps the section's
 * orientation.
 */
import { Columns2, FileText, RectangleHorizontal, Ruler, type LucideIcon } from 'lucide-react';
import type { PageSetup, PageSetupPatch } from '@/lib/cdoc/editor/model-values';
import { COLUMN_CHOICES, MARGIN_CHOICES, ORIENTATION_CHOICES, SIZE_CHOICES, type PageSetupChoice } from './page-setup';
import { MenuOption, RibbonMenu } from './RibbonMenu';
import { RibbonGroup } from './RibbonToolbar';
import { useRibbon, type Ribbon } from './ribbon-context';

interface SetupMenu {
  readonly id: string;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly choices: readonly PageSetupChoice[];
}

const MENUS: readonly SetupMenu[] = [
  { id: 'margins', label: 'Margins', icon: Ruler, choices: MARGIN_CHOICES },
  { id: 'orientation', label: 'Orientation', icon: RectangleHorizontal, choices: ORIENTATION_CHOICES },
  { id: 'size', label: 'Size', icon: FileText, choices: SIZE_CHOICES },
  { id: 'columns', label: 'Columns', icon: Columns2, choices: COLUMN_CHOICES },
];

export const SECTION_UNKNOWN: string = 'The page’s setup shows once you click or type in the document.';

function SetupMenuButton({ menu, section }: { menu: SetupMenu; section: PageSetup | null }): JSX.Element {
  const { run }: Ribbon = useRibbon();
  const blocked: boolean = menu.choices.some((c: PageSetupChoice): boolean => c.patch(section) === null);
  return (
    <RibbonMenu testId={`ribbon-page-${menu.id}`} label={menu.label} icon={menu.icon} text={menu.label} widthPx={240} unavailable={blocked ? SECTION_UNKNOWN : null}>
      {(close: () => void): JSX.Element[] => menu.choices.map((choice: PageSetupChoice): JSX.Element => (
        <MenuOption key={choice.id} testId={`ribbon-page-${menu.id}-${choice.id}`} label={choice.label} detail={choice.detail}
          pressed={section === null ? undefined : choice.current(section)}
          onChoose={(): void => {
            const patch: PageSetupPatch | null = choice.patch(section);
            close();
            if (patch !== null) void run({ name: 'setSectionProperty', patch }, `set the ${menu.label.toLowerCase()} to ${choice.label}`);
          }} />
      ))}
    </RibbonMenu>
  );
}

export function PageSetupGroup(): JSX.Element {
  const { caret }: Ribbon = useRibbon();
  const section: PageSetup | null = caret.known ? caret.section : null;
  return (
    <RibbonGroup label="Page Setup" testId="ribbon-page-setup" collapses={true} icon={FileText}>
      {MENUS.map((menu: SetupMenu): JSX.Element => <SetupMenuButton key={menu.id} menu={menu} section={section} />)}
    </RibbonGroup>
  );
}
