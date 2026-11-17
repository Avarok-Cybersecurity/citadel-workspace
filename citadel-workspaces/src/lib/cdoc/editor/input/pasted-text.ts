/**
 * How pasted plain text enters the document, wherever the paste came from (the keyboard's
 * paste event, a drop, or the ribbon's Paste button): its own undo step, with the line endings
 * the document uses. Nothing is sent for empty text.
 */
import type { EditorCommand } from '../controller';

export function pastedTextCommands(text: string): readonly EditorCommand[] {
  if (text === '') return [];
  return [
    { name: 'breakUndoGroup' },
    { name: 'insertText', text: text.replace(/\r\n?/g, '\n') },
    { name: 'breakUndoGroup' },
  ];
}
