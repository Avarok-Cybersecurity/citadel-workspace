/**
 * Home › Clipboard: Cut, Copy and Paste (plain text), the operations in clipboard.ts. Cut and
 * Copy wait for a selection; Copy only reads, so a document the person may not edit still copies.
 * Select All selects the story the caret is in (the body, or the header, footer or footnote being
 * edited), and only reads too.
 */
import { ClipboardPaste, Copy, Scissors, TextSelect } from 'lucide-react';
import { CLIPBOARD_KEYS, copySelection, cutSelection, hasSelection, pasteClipboard } from './clipboard';
import type { RibbonEditor } from './editor-context';
import { RibbonButton } from './RibbonButton';
import { RibbonGroup } from './RibbonToolbar';
import { useRibbon, type Ribbon } from './ribbon-context';

const NOTHING_SELECTED: string = 'Select some text first.';

export function ClipboardGroup(): JSX.Element {
  const { attempt, environment, selection }: Ribbon = useRibbon();
  const nothing: string | null = selection === null || hasSelection(selection) ? null : NOTHING_SELECTED;
  return (
    <RibbonGroup label="Clipboard" testId="ribbon-clipboard" collapses={true} icon={ClipboardPaste}>
      <RibbonButton testId="ribbon-paste" label="Paste" icon={ClipboardPaste} shortcut={{ key: CLIPBOARD_KEYS.paste }}
        onPress={(): void => { void attempt('paste', (editor: RibbonEditor): Promise<void> => pasteClipboard(editor, environment)); }} />
      <RibbonButton testId="ribbon-cut" label="Cut" icon={Scissors} shortcut={{ key: CLIPBOARD_KEYS.cut }} unavailable={nothing}
        onPress={(): void => { void attempt('cut the selection', (editor: RibbonEditor): Promise<unknown> => cutSelection(editor, environment)); }} />
      <RibbonButton testId="ribbon-copy" label="Copy" icon={Copy} shortcut={{ key: CLIPBOARD_KEYS.copy }} unavailable={nothing} reads
        onPress={(): void => { void attempt('copy the selection', (editor: RibbonEditor): Promise<void> => copySelection(editor, environment), { done: 'Copied.', reads: true }); }} />
      <RibbonButton testId="ribbon-select-all" label="Select all" icon={TextSelect} shortcut={{ key: 'A' }} reads
        onPress={(): void => { void attempt('select everything', (editor: RibbonEditor): Promise<unknown> => editor.execute({ name: 'selectAll' }), { reads: true }); }} />
    </RibbonGroup>
  );
}
