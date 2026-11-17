/**
 * The ribbon's Cut, Copy and Paste. The keyboard's own copy, cut and paste events are the
 * editor's (ime-bridge.ts); these are the same operations started from a button, which runs
 * outside any clipboard event, so the text goes through the Clipboard API. Cut deletes only
 * once the text is on the clipboard, so a refused write loses nothing.
 */
import type { EditorState, SelectionText } from '@/lib/cdoc/editor/controller';
import { pastedTextCommands } from '@/lib/cdoc/editor/input/pasted-text';
import type { RibbonEditor } from './editor-context';
import { shortcutLabel } from './RibbonButton';
import type { RibbonEnvironment } from './ribbon-environment';

/** Whether there is a selection to copy: a caret's text is complete and empty. */
export function hasSelection(selected: SelectionText): boolean {
  return !selected.complete || selected.text !== '';
}

export type ClipboardOperation = 'cut' | 'copy' | 'paste';

/** Each operation's own shortcut: the keyboard does it through the editor's clipboard events. */
export const CLIPBOARD_KEYS: Readonly<Record<ClipboardOperation, string>> = { cut: 'X', copy: 'C', paste: 'V' };

/** What the browser's refusal means to the person, and the shortcut that does the same instead. */
function refusal(error: unknown, operation: ClipboardOperation, environment: RibbonEnvironment): unknown {
  if (!(error instanceof DOMException) || error.name !== 'NotAllowedError') return error;
  const access: string = operation === 'paste' ? 'reading' : 'writing';
  return new Error(`The browser did not allow ${access} the clipboard. Allow clipboard access for this site, or press ${shortcutLabel({ key: CLIPBOARD_KEYS[operation] }, environment)}.`);
}

async function selectedText(editor: RibbonEditor): Promise<string> {
  const selected: SelectionText = editor.state.selectionText;
  // Past the result record's cap the text is not carried in the state; the editor reads it out.
  return selected.complete ? selected.text : editor.selectionText();
}

async function writeSelection(editor: RibbonEditor, environment: RibbonEnvironment, operation: ClipboardOperation): Promise<void> {
  const text: string = await selectedText(editor);
  await environment.writeClipboard(text).catch((error: unknown): never => { throw refusal(error, operation, environment); });
}

export function copySelection(editor: RibbonEditor, environment: RibbonEnvironment): Promise<void> {
  return writeSelection(editor, environment, 'copy');
}

export async function cutSelection(editor: RibbonEditor, environment: RibbonEnvironment): Promise<EditorState> {
  await writeSelection(editor, environment, 'cut');
  return editor.execute({ name: 'cut' });
}

export async function pasteClipboard(editor: RibbonEditor, environment: RibbonEnvironment): Promise<void> {
  const text: string = await environment.readClipboard().catch((error: unknown): never => { throw refusal(error, 'paste', environment); });
  if (text === '') throw new Error('The clipboard has no text to paste.');
  for (const command of pastedTextCommands(text)) await editor.execute(command);
}
