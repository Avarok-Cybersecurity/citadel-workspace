/**
 * The Home tab: Undo and Redo, Clipboard (with Select All), Font, Paragraph and Styles.
 */
import { Redo2, Undo2 } from 'lucide-react';
import { ClipboardGroup } from './ClipboardGroup';
import { FontGroup } from './FontGroup';
import { ParagraphGroup } from './ParagraphGroup';
import { RibbonButton } from './RibbonButton';
import { RibbonGroup, RibbonToolbar } from './RibbonToolbar';
import { StylesGroup } from './StylesGallery';
import { useRibbon, type Ribbon } from './ribbon-context';

function UndoGroup(): JSX.Element {
  const { run }: Ribbon = useRibbon();
  return (
    <RibbonGroup label="Undo" testId="ribbon-undo-group" collapses={false} icon={Undo2}>
      <RibbonButton testId="ribbon-undo" label="Undo" icon={Undo2} shortcut={{ key: 'Z' }} onPress={(): void => { void run({ name: 'undo' }, 'undo'); }} />
      <RibbonButton testId="ribbon-redo" label="Redo" icon={Redo2} shortcut={{ key: 'Y' }} onPress={(): void => { void run({ name: 'redo' }, 'redo'); }} />
    </RibbonGroup>
  );
}

export function HomeRibbon(): JSX.Element {
  return (
    <RibbonToolbar label="Home" testId="ribbon-home-toolbar">
      <UndoGroup />
      <ClipboardGroup />
      <FontGroup />
      <ParagraphGroup />
      <StylesGroup />
    </RibbonToolbar>
  );
}
