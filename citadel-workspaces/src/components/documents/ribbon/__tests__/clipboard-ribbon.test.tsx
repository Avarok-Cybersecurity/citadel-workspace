/**
 * Home › Clipboard: Copy and Cut put the selection's text on the system clipboard (and Cut
 * deletes it only once it is there); Paste enters the clipboard's text as one undo step. The
 * clipboard is the TestClipboard the ribbon's environment is given.
 */
import { act, screen, waitFor } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { SelectionText } from '@/lib/cdoc/editor/controller';
import { FakeEditor, editorState, knownCaret } from './fake-editor';
import { MAY_EDIT, TestClipboard, fixedEnvironment, renderRibbon } from './render-ribbon';

function setUp(selectionText: SelectionText): { editor: FakeEditor; clipboard: TestClipboard; user: UserEvent } {
  const editor: FakeEditor = new FakeEditor(knownCaret({}, {}));
  editor.state = editorState(knownCaret({}, {}), { selectionText });
  const clipboard: TestClipboard = new TestClipboard();
  renderRibbon({ editor, edit: MAY_EDIT, commentAuthor: 'Ada', environment: fixedEnvironment(clipboard) });
  return { editor, clipboard, user: userEvent.setup() };
}

const SELECTED: SelectionText = { complete: true, text: 'Quarterly plan' };
const CARET: SelectionText = { complete: true, text: '' };
const status = (): HTMLElement => screen.getByTestId('docs-ribbon-status');

describe('the Clipboard group', () => {
  it('copies the selection’s text and changes nothing in the document', async () => {
    const { editor, clipboard, user } = setUp(SELECTED);
    await user.click(screen.getByTestId('ribbon-copy'));
    await waitFor((): void => expect(clipboard.writes).toEqual(['Quarterly plan']));
    expect(editor.sent).toEqual([]);
    expect(editor.focused).toBe(1);
    // Nothing on the page changes, so the status line says it worked.
    await waitFor((): void => expect(status()).toHaveTextContent(/^Copied\.$/));
    // Copying again empties the line first, so a screen reader hears "Copied." again.
    const seen: string[] = [];
    const watcher: MutationObserver = new MutationObserver((): void => { seen.push(status().textContent ?? ''); });
    watcher.observe(status(), { childList: true, characterData: true, subtree: true });
    await user.click(screen.getByTestId('ribbon-copy'));
    await waitFor((): void => expect(seen).toEqual(['', 'Copied.']));
    watcher.disconnect();
    // …and only until the next command, so it never describes something later.
    await user.click(screen.getByTestId('ribbon-mark-bold'));
    await waitFor((): void => expect(status()).toHaveTextContent(/^$/));
  });

  it('reads a selection past the record’s cap out of the editor before copying it', async () => {
    const { editor, clipboard, user } = setUp({ complete: false });
    editor.fullSelectionText = 'a very long selection';
    await user.click(screen.getByTestId('ribbon-copy'));
    await waitFor((): void => expect(clipboard.writes).toEqual(['a very long selection']));
  });

  it('cuts by copying first, then deleting the selection', async () => {
    const { editor, clipboard, user } = setUp(SELECTED);
    await user.click(screen.getByTestId('ribbon-cut'));
    await waitFor((): void => expect(editor.sent).toEqual([{ name: 'cut' }]));
    expect(clipboard.writes).toEqual(['Quarterly plan']);
  });

  it('deletes nothing when the browser refuses the clipboard, and says what to do instead', async () => {
    const { editor, clipboard, user } = setUp(SELECTED);
    clipboard.refusal = new DOMException('Write permission denied.', 'NotAllowedError');
    await user.click(screen.getByTestId('ribbon-cut'));
    await waitFor((): void => expect(status()).toHaveTextContent('Could not cut the selection. The browser did not allow writing the clipboard. Allow clipboard access for this site, or press Ctrl+X.'));
    expect(editor.sent).toEqual([]);
  });

  it('cannot cut or copy a bare caret, and says why', async () => {
    const { editor, clipboard, user } = setUp(CARET);
    for (const id of ['ribbon-cut', 'ribbon-copy']) {
      expect(screen.getByTestId(id)).toHaveAttribute('aria-disabled', 'true');
      await user.click(screen.getByTestId(id));
    }
    // A tap shows no tooltip, so the press itself says why in the status line.
    await waitFor((): void => expect(status()).toHaveTextContent(/^Select some text first\.$/));
    // Selecting text makes that reason stale, so it goes.
    act((): void => editor.report(editorState(knownCaret({}, {}), { selectionText: SELECTED })));
    expect(status()).toHaveTextContent(/^$/);
    act((): void => editor.report(editorState(knownCaret({}, {}), { selectionText: CARET })));
    await user.hover(screen.getByTestId('ribbon-copy'));
    expect((await screen.findAllByText('Select some text first.')).length).toBeGreaterThan(0);
    expect(clipboard.writes).toEqual([]);
    expect(editor.sent).toEqual([]);
    expect(screen.getByTestId('ribbon-paste')).toHaveAttribute('aria-disabled', 'false');
  });

  it('pastes the clipboard’s text as one undo step, with the document’s line endings', async () => {
    const { editor, clipboard, user } = setUp(CARET);
    clipboard.text = 'one\r\ntwo';
    await user.click(screen.getByTestId('ribbon-paste'));
    await waitFor((): void => expect(editor.sent).toEqual([
      { name: 'breakUndoGroup' },
      { name: 'insertText', text: 'one\ntwo' },
      { name: 'breakUndoGroup' },
    ]));
  });

  it('shows a refused clipboard read, and an empty clipboard, instead of pasting nothing silently', async () => {
    const { editor, clipboard, user } = setUp(CARET);
    clipboard.refusal = new DOMException('Read permission denied.', 'NotAllowedError');
    await user.click(screen.getByTestId('ribbon-paste'));
    await waitFor((): void => expect(status()).toHaveTextContent('Could not paste. The browser did not allow reading the clipboard. Allow clipboard access for this site, or press Ctrl+V.'));
    clipboard.refusal = null;
    await user.click(screen.getByTestId('ribbon-paste'));
    await waitFor((): void => expect(status()).toHaveTextContent('Could not paste. The clipboard has no text to paste.'));
    expect(editor.sent).toEqual([]);
  });

  it('still copies from a document the person may only read, where Cut and Paste are refused', async () => {
    const editor: FakeEditor = new FakeEditor(knownCaret({}, {}));
    editor.state = editorState(knownCaret({}, {}), { selectionText: SELECTED });
    const clipboard: TestClipboard = new TestClipboard();
    renderRibbon({ editor, edit: { enabled: false, reason: 'You can only read this document.' }, commentAuthor: 'Ada', environment: fixedEnvironment(clipboard) });
    const user: UserEvent = userEvent.setup();
    expect(screen.getByTestId('ribbon-copy')).toHaveAttribute('aria-disabled', 'false');
    expect(screen.getByTestId('ribbon-cut')).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByTestId('ribbon-paste')).toHaveAttribute('aria-disabled', 'true');
    await user.click(screen.getByTestId('ribbon-copy'));
    await waitFor((): void => expect(clipboard.writes).toEqual(['Quarterly plan']));
    await waitFor((): void => expect(status()).toHaveTextContent(/^Copied\.$/));
    await user.click(screen.getByTestId('ribbon-paste'));
    expect(editor.sent).toEqual([]);
  });
});
