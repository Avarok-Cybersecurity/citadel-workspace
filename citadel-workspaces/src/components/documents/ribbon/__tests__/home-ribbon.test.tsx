/**
 * Home: every control sends exactly its command, toggles read the caret (indeterminate when the
 * engine has not reported it), and focus goes back to the document after each command.
 */
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { CaretFormatting, EditorCommand } from '@/lib/cdoc/editor/controller';
import { FakeEditor, editorState, knownCaret } from './fake-editor';
import { MAY_EDIT, renderRibbon } from './render-ribbon';

const UNKNOWN: CaretFormatting = { known: false };
const BOLD_12PT_CENTRED: CaretFormatting = knownCaret(
  { bold: true, size: 24, font: 'Calibri', color: '#C00000' },
  { alignment: 'center', style: 'Heading1', spacing: { before: 600, line: { rule: 'multiple', lines: 360 } } },
);

function setUp(caret: CaretFormatting): { editor: FakeEditor; user: UserEvent } {
  const editor: FakeEditor = new FakeEditor(caret);
  renderRibbon({ editor, edit: MAY_EDIT, commentAuthor: 'Ada' });
  return { editor, user: userEvent.setup() };
}

async function pressed(user: UserEvent, editor: FakeEditor, testId: string): Promise<EditorCommand> {
  const before: number = editor.focused;
  await user.click(screen.getByTestId(testId));
  await waitFor((): void => expect(editor.focused).toBe(before + 1));
  return editor.sent[editor.sent.length - 1];
}

describe('the Home ribbon', () => {
  const BUTTONS: ReadonlyArray<readonly [string, EditorCommand]> = [
    ['ribbon-undo', { name: 'undo' }],
    ['ribbon-redo', { name: 'redo' }],
    ['ribbon-mark-bold', { name: 'toggleMark', mark: 'bold' }],
    ['ribbon-mark-italic', { name: 'toggleMark', mark: 'italic' }],
    ['ribbon-mark-underline', { name: 'toggleMark', mark: 'underline' }],
    ['ribbon-mark-strike', { name: 'toggleMark', mark: 'strike' }],
    ['ribbon-mark-subscript', { name: 'toggleMark', mark: 'subscript' }],
    ['ribbon-mark-superscript', { name: 'toggleMark', mark: 'superscript' }],
    ['ribbon-clear-formatting', {
      name: 'setRunProperty',
      patch: { style: null, font: null, size: null, bold: null, italic: null, underline: null, strike: null, verticalAlign: null, color: null, highlight: null, smallCaps: null, allCaps: null, kern: null, ligatures: null, lang: null },
    }],
    ['ribbon-text-color-auto', { name: 'setRunProperty', patch: { color: null } }],
    ['ribbon-highlight-none', { name: 'setRunProperty', patch: { highlight: null } }],
    ['ribbon-bullets', { name: 'setNumberingKind', kind: 'bullet', level: 0 }],
    ['ribbon-indent', { name: 'indent' }],
    ['ribbon-outdent', { name: 'outdent' }],
    ['ribbon-align-left', { name: 'setParagraphProperty', patch: { alignment: 'left' } }],
    ['ribbon-align-center', { name: 'setParagraphProperty', patch: { alignment: 'center' } }],
    ['ribbon-align-right', { name: 'setParagraphProperty', patch: { alignment: 'right' } }],
    ['ribbon-align-justify', { name: 'setParagraphProperty', patch: { alignment: 'justify' } }],
  ];

  it.each(BUTTONS)('%s sends exactly its command and returns focus to the document', async (testId: string, command: EditorCommand) => {
    const { editor, user } = setUp(UNKNOWN);
    expect(await pressed(user, editor, testId)).toEqual(command);
    expect(editor.sent).toHaveLength(1);
  });

  it('renders every toggle indeterminate while the caret formatting is unknown, never a guess', () => {
    setUp(UNKNOWN);
    for (const id of ['ribbon-mark-bold', 'ribbon-mark-italic', 'ribbon-align-left', 'ribbon-align-center']) {
      expect(screen.getByTestId(id)).toHaveAttribute('aria-pressed', 'mixed');
    }
    expect(screen.getByTestId('ribbon-font-family')).toHaveValue('');
    expect(screen.getByTestId('ribbon-font-size')).toHaveValue('');
    expect(screen.getByTestId('ribbon-line-spacing')).toHaveValue('');
    expect(screen.getByTestId('ribbon-home-spacing-before')).toHaveValue('');
  });

  it('reads the caret once the engine reports it, and follows it as it moves', () => {
    const editor: FakeEditor = setUp(BOLD_12PT_CENTRED).editor;
    expect(screen.getByTestId('ribbon-mark-bold')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('ribbon-mark-italic')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('ribbon-align-center')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('ribbon-font-size')).toHaveValue('24');
    expect(screen.getByTestId('ribbon-font-family')).toHaveValue('Calibri');
    expect(screen.getByTestId('ribbon-line-spacing')).toHaveValue('360');
    expect(screen.getByTestId('ribbon-home-spacing-before')).toHaveValue('6');
    act((): void => editor.report(editorState(UNKNOWN)));
    expect(screen.getByTestId('ribbon-mark-bold')).toHaveAttribute('aria-pressed', 'mixed');
  });

  it('sets the font and size from the lists it offers', async () => {
    const { editor, user } = setUp(UNKNOWN);
    await user.selectOptions(screen.getByTestId('ribbon-font-family'), 'Carlito');
    await user.selectOptions(screen.getByTestId('ribbon-font-size'), '28');
    expect(editor.sent).toEqual([
      { name: 'setRunProperty', patch: { font: 'Carlito' } },
      { name: 'setRunProperty', patch: { size: 28 } },
    ]);
  });

  it('grows and shrinks along Word’s list from the caret’s size, and cannot when the size is unknown', async () => {
    const { editor, user } = setUp(BOLD_12PT_CENTRED);
    expect(await pressed(user, editor, 'ribbon-grow-font')).toEqual({ name: 'setRunProperty', patch: { size: 28 } });
    expect(await pressed(user, editor, 'ribbon-shrink-font')).toEqual({ name: 'setRunProperty', patch: { size: 22 } });
    act((): void => editor.report(editorState(UNKNOWN)));
    expect(screen.getByTestId('ribbon-grow-font')).toHaveAttribute('aria-disabled', 'true');
    await user.click(screen.getByTestId('ribbon-grow-font'));
    expect(editor.sent).toHaveLength(2);
  });

  it('sends only the spacing member it changes, which the engine patches field by field', async () => {
    const { editor, user } = setUp(BOLD_12PT_CENTRED);
    await user.selectOptions(screen.getByTestId('ribbon-line-spacing'), '480');
    const field: HTMLElement = screen.getByTestId('ribbon-home-spacing-after');
    await user.clear(field);
    await user.type(field, '12{Enter}');
    expect(editor.sent).toEqual([
      { name: 'setParagraphProperty', patch: { spacing: { line: { rule: 'multiple', lines: 480 } } } },
      { name: 'setParagraphProperty', patch: { spacing: { after: 1200 } } },
    ]);
  });

  it('shows what differs across the selection as indeterminate or empty, and grows from no size it cannot name', async () => {
    const mixed: CaretFormatting = knownCaret(
      { bold: true, size: 24, font: 'Calibri' },
      { alignment: 'center', style: 'Heading1', spacing: { before: 600, line: { rule: 'multiple', lines: 360 } } },
      { run: ['bold', 'size', 'font'], paragraph: ['alignment', 'style', 'spacing'] },
    );
    const { editor, user } = setUp(mixed);
    expect(screen.getByTestId('ribbon-mark-bold')).toHaveAttribute('aria-pressed', 'mixed');
    expect(screen.getByTestId('ribbon-mark-italic')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('ribbon-align-center')).toHaveAttribute('aria-pressed', 'mixed');
    for (const id of ['ribbon-font-size', 'ribbon-font-family', 'ribbon-line-spacing', 'ribbon-home-spacing-before']) expect(screen.getByTestId(id)).toHaveValue('');
    expect(screen.getByTestId('ribbon-styles-open')).toHaveTextContent(/^Styles$/);
    expect(screen.getByTestId('ribbon-grow-font')).toHaveAttribute('aria-disabled', 'true');
    await user.click(screen.getByTestId('ribbon-grow-font'));
    expect(editor.sent).toEqual([]);
    await user.click(screen.getByTestId('ribbon-styles-open'));
    expect(await screen.findByTestId('ribbon-style-Heading1')).toHaveAttribute('aria-pressed', 'mixed');
  });

  it('keeps a spacing out of range in the field, says the range, and sends nothing', async () => {
    const { editor, user } = setUp(BOLD_12PT_CENTRED);
    const field: HTMLElement = screen.getByTestId('ribbon-home-spacing-before');
    await user.clear(field);
    await user.type(field, '2000{Enter}');
    expect(field).toHaveValue('2000');
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByTestId('ribbon-home-spacing-before-error')).toHaveTextContent('Enter 0 to 1584 pt.');
    expect(field).toHaveAttribute('aria-describedby', 'ribbon-home-spacing-before-error');
    await user.keyboard('{Escape}');
    expect(field).toHaveValue('6');
    expect(editor.sent).toEqual([]);
  });

  it('clears the refusal once the value is corrected', async () => {
    const { editor, user } = setUp(BOLD_12PT_CENTRED);
    const field: HTMLElement = screen.getByTestId('ribbon-home-spacing-before');
    await user.clear(field);
    await user.type(field, '2000{Enter}');
    await user.clear(field);
    await user.type(field, '6{Enter}');
    expect(field).toHaveAttribute('aria-invalid', 'false');
    expect(screen.queryByTestId('ribbon-home-spacing-before-error')).toBeNull();
    expect(editor.sent).toEqual([]);
  });

  it('sends a spacing while the caret is unknown, since siblings are kept, not reset', async () => {
    const { editor, user } = setUp(UNKNOWN);
    await user.type(screen.getByTestId('ribbon-home-spacing-before'), '3{Enter}');
    await user.selectOptions(screen.getByTestId('ribbon-line-spacing'), '480');
    expect(editor.sent).toEqual([
      { name: 'setParagraphProperty', patch: { spacing: { before: 300 } } },
      { name: 'setParagraphProperty', patch: { spacing: { line: { rule: 'multiple', lines: 480 } } } },
    ]);
  });

  it('names the colour resets in words, not only by their look-alike icons', () => {
    setUp(UNKNOWN);
    expect(screen.getByTestId('ribbon-text-color-auto')).toHaveTextContent('Automatic');
    expect(screen.getByTestId('ribbon-highlight-none')).toHaveTextContent('No highlight');
  });

  it('applies a colour when the picker commits it', () => {
    const { editor } = setUp(UNKNOWN);
    const input: HTMLElement = screen.getByTestId('ribbon-highlight');
    fireEvent.input(input, { target: { value: '#ffff00' } });
    expect(editor.sent).toEqual([]);
    fireEvent.change(input, { target: { value: '#ffff00' } });
    expect(editor.sent).toEqual([{ name: 'setRunProperty', patch: { highlight: '#FFFF00' } }]);
  });

  it('applies a style from the gallery, previewed in the style’s own look', async () => {
    const { editor, user } = setUp(BOLD_12PT_CENTRED);
    // The button names the caret's style from the document's own sheet, once it has been read.
    await waitFor((): void => expect(screen.getByTestId('ribbon-styles-open')).toHaveTextContent('Heading 1'));
    await user.click(screen.getByTestId('ribbon-styles-open'));
    const title: HTMLElement = await screen.findByTestId('ribbon-style-Title');
    expect(title.firstElementChild).toHaveStyle({ fontFamily: '"cdoc Carlito", sans-serif' });
    expect(screen.getByTestId('ribbon-style-Heading1')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByTestId('ribbon-style-Hyperlink')).toBeNull();
    await user.click(title);
    await waitFor((): void => expect(editor.sent).toEqual([{ name: 'setParagraphStyle', style: 'Title' }]));
  });

  it('names each command’s shortcut in its tooltip', async () => {
    const { user } = setUp(UNKNOWN);
    await user.hover(screen.getByTestId('ribbon-mark-bold'));
    expect((await screen.findAllByText('Bold (Ctrl+B)')).length).toBeGreaterThan(0);
  });
});
