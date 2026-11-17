/**
 * The Insert tab: Table, Pictures, Links, Comments, Header & Footer,
 * Footnotes, Breaks and Symbols.
 */
import { Asterisk, Image, Link, MessageSquarePlus, Omega, PanelTop, SeparatorHorizontal, Table } from 'lucide-react';
import { HeaderFooterButtons } from './HeaderFooter';
import { BreakButtons, FootnoteButton, SymbolPicker } from './BreaksAndSymbols';
import { CommentControl, LinkControls } from './LinkAndComment';
import { PictureControl } from './PictureControl';
import { RibbonGroup, RibbonToolbar } from './RibbonToolbar';
import { TablePicker } from './TablePicker';

/** `pictures`: why a picture cannot be inserted in this document, or null where it can. */
export function InsertRibbon({ commentAuthor, pictures }: { commentAuthor: string | null; pictures: string | null }): JSX.Element {
  return (
    <RibbonToolbar label="Insert" testId="ribbon-insert-toolbar">
      <RibbonGroup label="Tables" testId="ribbon-tables" collapses={false} icon={Table}><TablePicker /></RibbonGroup>
      <RibbonGroup label="Pictures" testId="ribbon-pictures" collapses={false} icon={Image}><PictureControl unavailable={pictures} /></RibbonGroup>
      <RibbonGroup label="Links" testId="ribbon-links" collapses={false} icon={Link}><LinkControls /></RibbonGroup>
      <RibbonGroup label="Comments" testId="ribbon-comments" collapses={false} icon={MessageSquarePlus}><CommentControl author={commentAuthor} /></RibbonGroup>
      <RibbonGroup label="Header & Footer" testId="ribbon-header-footer" collapses={false} icon={PanelTop}><HeaderFooterButtons /></RibbonGroup>
      <RibbonGroup label="Footnotes" testId="ribbon-footnotes" collapses={false} icon={Asterisk}><FootnoteButton /></RibbonGroup>
      <RibbonGroup label="Breaks" testId="ribbon-insert-breaks" collapses={true} icon={SeparatorHorizontal}><BreakButtons idPrefix="ribbon-insert" /></RibbonGroup>
      <RibbonGroup label="Symbols" testId="ribbon-symbols-group" collapses={false} icon={Omega}><SymbolPicker /></RibbonGroup>
    </RibbonToolbar>
  );
}
