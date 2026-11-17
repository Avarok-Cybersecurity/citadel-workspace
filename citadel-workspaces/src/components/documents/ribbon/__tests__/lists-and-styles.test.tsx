/**
 * Home › Paragraph's lists (SetNumberingKind at the caret's list level, the current one shown) and Home › Styles,
 * which offers the document's own paragraph styles, read from the editor each time it opens.
 */
import { act, screen, waitFor } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { CaretFormatting } from '@/lib/cdoc/editor/controller';
import { editorState, FakeEditor, knownCaret } from './fake-editor';
import { MAY_EDIT, renderRibbon } from './render-ribbon';

function setUp(caret: CaretFormatting): { editor: FakeEditor; user: UserEvent } {
  const editor: FakeEditor = new FakeEditor(caret);
  renderRibbon({ editor, edit: MAY_EDIT, commentAuthor: 'Ada' });
  return { editor, user: userEvent.setup() };
}

async function number(user: UserEvent, kind: string): Promise<void> {
  await user.click(screen.getByTestId('ribbon-numbering-open'));
  await user.click(await screen.findByTestId(`ribbon-numbering-${kind}`));
}

describe('lists', () => {
  it('keeps the list level the editor reports for the list, and starts at the first level otherwise', async () => {
    const { editor, user } = setUp(knownCaret({}, { numbering: { numId: 3, level: 2 } }, {}, undefined, { kind: 'custom', level: 2 }));
    await user.click(screen.getByTestId('ribbon-bullets'));
    await number(user, 'upperRoman');
    await waitFor((): void => expect(editor.sent).toEqual([
      { name: 'setNumberingKind', kind: 'bullet', level: 2 },
      { name: 'setNumberingKind', kind: 'upperRoman', level: 2 },
    ]));
  });

  it('shows the current list: Bullets in a bulleted one, Numbering and its choice in a numbered one, mixed across lists', async () => {
    const { editor, user } = setUp(knownCaret({}, { numbering: { numId: 3, level: 1 } }, {}, undefined, { kind: 'bullet', level: 1 }));
    expect(screen.getByTestId('ribbon-bullets')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('ribbon-numbering-open')).toHaveAttribute('aria-pressed', 'false');
    act((): void => editor.report(editorState(knownCaret({}, { numbering: { numId: 4, level: 0 } }, {}, undefined, { kind: 'lowerRoman', level: 0 }))));
    expect(screen.getByTestId('ribbon-bullets')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('ribbon-numbering-open')).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByTestId('ribbon-numbering-open'));
    expect(await screen.findByTestId('ribbon-numbering-lowerRoman')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('ribbon-numbering-decimal')).toHaveAttribute('aria-pressed', 'false');
    await user.keyboard('{Escape}');
    act((): void => editor.report(editorState(knownCaret({}, {}, { list: true }, undefined, { kind: 'decimal', level: 0 }))));
    expect(screen.getByTestId('ribbon-bullets')).toHaveAttribute('aria-pressed', 'mixed');
    expect(screen.getByTestId('ribbon-numbering-open')).toHaveAttribute('aria-pressed', 'mixed');
    // Before the editor reports anything, neither says pressed or not: mixed, as the other toggles.
    act((): void => editor.report(editorState({ known: false })));
    expect(screen.getByTestId('ribbon-bullets')).toHaveAttribute('aria-pressed', 'mixed');
    // A list the templates do not describe (an imported one) presses neither.
    act((): void => editor.report(editorState(knownCaret({}, { numbering: { numId: 9, level: 0 } }, {}, undefined, { kind: 'custom', level: 0 }))));
    expect(screen.getByTestId('ribbon-bullets')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('ribbon-numbering-open')).toHaveAttribute('aria-pressed', 'false');
  });

  it('ends a list with No list, whatever its kind', async () => {
    const { editor, user } = setUp(knownCaret({}, { numbering: { numId: 3, level: 0 } }, {}, undefined, { kind: 'custom', level: 0 }));
    await user.click(screen.getByTestId('ribbon-list-none'));
    await waitFor((): void => expect(editor.sent).toEqual([{ name: 'clearNumbering' }]));
  });

  it('refuses Increase indent at the ninth level, and allows it above', async () => {
    const { editor, user } = setUp(knownCaret({}, {}, {}, undefined, { kind: 'bullet', level: 8 }));
    const indent: HTMLElement = screen.getByTestId('ribbon-indent');
    expect(indent).toHaveAttribute('aria-disabled', 'true');
    await user.click(indent);
    await waitFor((): void => expect(screen.getByTestId('docs-ribbon-status')).toHaveTextContent('This list item is at the deepest of a list’s nine levels.'));
    act((): void => editor.report(editorState(knownCaret({}, {}, {}, undefined, { kind: 'bullet', level: 7 }))));
    await user.click(screen.getByTestId('ribbon-indent'));
    await waitFor((): void => expect(editor.sent).toEqual([{ name: 'indent' }]));
  });

  it('refuses No list outside a list', async () => {
    const { editor, user } = setUp(knownCaret({}, {}));
    const none: HTMLElement = screen.getByTestId('ribbon-list-none');
    expect(none).toHaveAttribute('aria-disabled', 'true');
    await user.click(none);
    await waitFor((): void => expect(screen.getByTestId('docs-ribbon-status')).toHaveTextContent('This paragraph is not in a list.'));
    expect(editor.sent).toEqual([]);
  });

  it('offers Word’s five numbering formats and None, which ends the list', async () => {
    const { editor, user } = setUp(knownCaret({}, {}));
    for (const kind of ['decimal', 'lowerLetter', 'upperLetter', 'lowerRoman', 'upperRoman', 'none']) await number(user, kind);
    await waitFor((): void => expect(editor.sent).toEqual([
      { name: 'setNumberingKind', kind: 'decimal', level: 0 },
      { name: 'setNumberingKind', kind: 'lowerLetter', level: 0 },
      { name: 'setNumberingKind', kind: 'upperLetter', level: 0 },
      { name: 'setNumberingKind', kind: 'lowerRoman', level: 0 },
      { name: 'setNumberingKind', kind: 'upperRoman', level: 0 },
      { name: 'clearNumbering' },
    ]));
  });
});

describe('the styles gallery', () => {
  it('offers the document’s own paragraph styles, re-read each time it opens', async () => {
    const editor: FakeEditor = new FakeEditor(knownCaret({}, { style: 'Quote' }));
    editor.styleSheet = [
      { id: 'Quote', name: 'Quote', kind: 'paragraph', basedOn: null, run: { italic: true }, paragraph: {} },
      { id: 'Strong', name: 'Strong', kind: 'character', basedOn: null, run: { bold: true }, paragraph: {} },
    ];
    renderRibbon({ editor, edit: MAY_EDIT, commentAuthor: 'Ada' });
    const user: UserEvent = userEvent.setup();
    await waitFor((): void => expect(screen.getByTestId('ribbon-styles-open')).toHaveTextContent('Quote'));
    const reads: number = editor.styleReads;
    await user.click(screen.getByTestId('ribbon-styles-open'));
    const quote: HTMLElement = await screen.findByTestId('ribbon-style-Quote');
    expect(quote).toHaveAttribute('aria-pressed', 'true');
    expect(quote.firstElementChild).toHaveStyle({ fontStyle: 'italic' });
    expect(screen.queryByTestId('ribbon-style-Strong')).toBeNull();
    expect(screen.queryByTestId('ribbon-style-Normal')).toBeNull();
    expect(editor.styleReads).toBe(reads + 1);
  });

  it('says so when the styles cannot be read', async () => {
    const editor: FakeEditor = new FakeEditor(knownCaret({}, {}));
    editor.styles = (): Promise<never> => Promise.reject(new Error('the sheet is unreadable'));
    renderRibbon({ editor, edit: MAY_EDIT, commentAuthor: 'Ada' });
    const user: UserEvent = userEvent.setup();
    await user.click(screen.getByTestId('ribbon-styles-open'));
    expect(await screen.findByTestId('ribbon-styles-status')).toHaveTextContent('The document’s styles could not be read. the sheet is unreadable');
  });
});
