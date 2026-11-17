/**
 * The Layout tab: Page Setup (margins, orientation, size, columns: SetSectionProperty),
 * Breaks, and the paragraph's indent and spacing.
 */
import { Pilcrow, SeparatorHorizontal } from 'lucide-react';
import { BreakButtons } from './BreaksAndSymbols';
import { IndentFields, SpacingFields } from './ParagraphFields';
import { PageSetupGroup } from './PageSetupGroup';
import { RibbonGroup, RibbonToolbar } from './RibbonToolbar';

export function LayoutRibbon(): JSX.Element {
  return (
    <RibbonToolbar label="Layout" testId="ribbon-layout-toolbar">
      <PageSetupGroup />
      <RibbonGroup label="Breaks" testId="ribbon-layout-breaks" collapses={true} icon={SeparatorHorizontal}><BreakButtons idPrefix="ribbon-layout" /></RibbonGroup>
      <RibbonGroup label="Indent" testId="ribbon-layout-indent" collapses={false} icon={Pilcrow}><IndentFields idPrefix="ribbon-layout" /></RibbonGroup>
      <RibbonGroup label="Spacing" testId="ribbon-layout-spacing" collapses={false} icon={Pilcrow}><SpacingFields idPrefix="ribbon-layout" /></RibbonGroup>
    </RibbonToolbar>
  );
}
