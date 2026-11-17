/**
 * Insert and Layout: table grid, link, comment, footnote, breaks, symbol, and Layout's fields;
 * each sends exactly its command with the arguments the form produced.
 */
import { act, screen, waitFor } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { CaretFormatting } from '@/lib/cdoc/editor/controller';
import { editorState, FakeEditor, knownCaret } from './fake-editor';
import { FIXED_ENVIRONMENT, MAY_EDIT, renderRibbon } from './render-ribbon';
import { MAX_IMAGE_BYTES } from '@/lib/cdoc/engine/engine-limits';

/** A paragraph the engine reports with no direct spacing or indent, so Layout's fields can be set. */
const PLAIN: CaretFormatting = knownCaret({}, {});

function setUp(commentAuthor: string | null): { editor: FakeEditor; user: UserEvent } {
  const editor: FakeEditor = new FakeEditor(PLAIN);
  renderRibbon({ editor, edit: MAY_EDIT, commentAuthor });
  return { editor, user: userEvent.setup() };
}

async function openTab(user: UserEvent, tab: 'insert'): Promise<void> {
  await user.click(screen.getByTestId(`docs-ribbon-tab-${tab}`));
}

describe('the Insert ribbon', () => {
  it('inserts the table the grid sizes, by pointer and by keyboard', async () => {
    const { editor, user } = setUp('Ada');
    await openTab(user, 'insert');
    await user.click(screen.getByTestId('ribbon-insert-table'));
    await user.click(await screen.findByTestId('ribbon-table-cell-3-4'));
    await user.click(screen.getByTestId('ribbon-insert-table'));
    await screen.findByTestId('ribbon-table-cell-1-1');
    await user.keyboard('{ArrowRight}{ArrowRight}{ArrowDown}');
    expect(screen.getByTestId('ribbon-table-size')).toHaveTextContent('3 × 2 table');
    await user.keyboard('{Enter}');
    await waitFor((): void => expect(editor.sent).toEqual([
      { name: 'insertTable', rows: 3, cols: 4 },
      { name: 'insertTable', rows: 2, cols: 3 },
    ]));
  });

  it('links to a normalised web address, and refuses a script one', async () => {
    const { editor, user } = setUp('Ada');
    await openTab(user, 'insert');
    await user.click(screen.getByTestId('ribbon-insert-link'));
    await user.type(await screen.findByTestId('ribbon-link-address'), 'javascript:alert(1)');
    await user.click(screen.getByTestId('ribbon-insert-link-submit'));
    expect(screen.getByTestId('ribbon-insert-link-invalid')).toHaveTextContent('not javascript: ones');
    expect(editor.sent).toEqual([]);
    await user.clear(screen.getByTestId('ribbon-link-address'));
    await user.type(screen.getByTestId('ribbon-link-address'), 'example.com/plan');
    await user.click(screen.getByTestId('ribbon-insert-link-submit'));
    await waitFor((): void => expect(editor.sent).toEqual([{ name: 'insertLink', href: 'https://example.com/plan' }]));
    await waitFor((): void => expect(editor.focused).toBeGreaterThan(0));
  });

  it('removes a link', async () => {
    const { editor, user } = setUp('Ada');
    await openTab(user, 'insert');
    await user.click(screen.getByTestId('ribbon-remove-link'));
    await waitFor((): void => expect(editor.sent).toEqual([{ name: 'removeLink' }]));
  });

  it('keeps a written comment when the dialog is dismissed, and drops it only on Discard', async () => {
    const { editor, user } = setUp('Ada');
    await openTab(user, 'insert');
    await user.click(screen.getByTestId('ribbon-insert-comment'));
    await user.type(await screen.findByTestId('ribbon-comment-text'), 'Half a thought');
    await user.keyboard('{Escape}');
    await waitFor((): void => expect(screen.queryByTestId('ribbon-insert-comment-dialog')).toBeNull());
    await user.click(screen.getByTestId('ribbon-insert-comment'));
    expect(await screen.findByTestId('ribbon-comment-text')).toHaveValue('Half a thought');
    await user.click(screen.getByTestId('ribbon-insert-comment-cancel'));
    await user.click(screen.getByTestId('ribbon-insert-comment'));
    expect(await screen.findByTestId('ribbon-comment-text')).toHaveValue('');
    expect(editor.sent).toEqual([]);
  });

  it('ties a refused address’s message to its field', async () => {
    const { user } = setUp('Ada');
    await openTab(user, 'insert');
    await user.click(screen.getByTestId('ribbon-insert-link'));
    await user.type(await screen.findByTestId('ribbon-link-address'), 'data:x');
    await user.click(screen.getByTestId('ribbon-insert-link-submit'));
    expect(screen.getByTestId('ribbon-link-address')).toHaveAttribute('aria-describedby', 'ribbon-insert-link-invalid');
    expect(screen.getByTestId('ribbon-link-address')).toHaveAttribute('aria-invalid', 'true');
  });

  it('hands a picture’s bytes to the editor under the size cap, then has the editor fit its content id to the column', async () => {
    const { editor, user } = setUp('Ada');
    await openTab(user, 'insert');
    const png: File = new File([new Uint8Array([137, 80, 78, 71])], 'chart.png', { type: 'image/png' });
    await user.upload(screen.getByTestId('ribbon-picture-file'), png);
    await waitFor((): void => expect(editor.sent).toEqual([{ name: 'insertImageFitted', contentId: 'image-1' }]));
    expect(editor.images.map((i: { maxBytes: number; bytes: Uint8Array }): [number, number[]] => [i.maxBytes, [...i.bytes]])).toEqual([[MAX_IMAGE_BYTES, [137, 80, 78, 71]]]);
  });

  it('refuses a picture type the outputs cannot draw, and says so', async () => {
    const { editor } = setUp('Ada');
    // The picker's accept filter would hide the SVG; a drag-drop or an old browser need not.
    const user: UserEvent = userEvent.setup({ applyAccept: false });
    await openTab(user, 'insert');
    const svg: File = new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' });
    await user.upload(screen.getByTestId('ribbon-picture-file'), svg);
    await waitFor((): void => expect(screen.getByTestId('docs-ribbon-status')).toHaveTextContent('Could not insert the picture. logo.svg is not a PNG or JPEG picture.'));
    expect(editor.images).toEqual([]);
    expect(editor.sent).toEqual([]);
  });

  it('names the file when it cannot be decoded, rather than quoting the engine', async () => {
    const { editor, user } = setUp('Ada');
    editor.refuseNextImage('image: unrecognised signature');
    await openTab(user, 'insert');
    await user.upload(screen.getByTestId('ribbon-picture-file'), new File([new Uint8Array([0])], 'broken.png', { type: 'image/png' }));
    await waitFor((): void => expect(screen.getByTestId('docs-ribbon-status')).toHaveTextContent('Could not insert the picture. broken.png could not be read as a picture.'));
    expect(editor.sent).toEqual([]);
  });

  it('refuses a picture over the size cap before reading it', async () => {
    const { editor, user } = setUp('Ada');
    await openTab(user, 'insert');
    const huge: File = new File([new Uint8Array(MAX_IMAGE_BYTES + 1)], 'scan.png', { type: 'image/png' });
    await user.upload(screen.getByTestId('ribbon-picture-file'), huge);
    await waitFor((): void => expect(screen.getByTestId('docs-ribbon-status')).toHaveTextContent('scan.png is larger than 32 MB.'));
    expect(editor.images).toEqual([]);
  });

  it('blocks a second picture while one is being inserted', async () => {
    const { editor, user } = setUp('Ada');
    let finish: () => void = (): void => undefined;
    editor.holdImages(new Promise<void>((resolve: () => void): void => { finish = resolve; }));
    editor.imagePixels = { width: 10, height: 10 };
    await openTab(user, 'insert');
    await user.upload(screen.getByTestId('ribbon-picture-file'), new File([new Uint8Array([1])], 'a.png', { type: 'image/png' }));
    expect(screen.getByTestId('ribbon-insert-picture')).toHaveAttribute('aria-disabled', 'true');
    act((): void => finish());
    await waitFor((): void => expect(screen.getByTestId('ribbon-insert-picture')).toHaveAttribute('aria-disabled', 'false'));
    expect(editor.sent).toEqual([{ name: 'insertImageFitted', contentId: 'image-1' }]);
  });

  it('signs a comment with the signed-in name, a fresh id and the time', async () => {
    const { editor, user } = setUp('Ada Lovelace');
    await openTab(user, 'insert');
    await user.click(screen.getByTestId('ribbon-insert-comment'));
    await user.click(await screen.findByTestId('ribbon-insert-comment-submit'));
    expect(screen.getByTestId('ribbon-insert-comment-invalid')).toHaveTextContent('Write the comment first.');
    await user.type(screen.getByTestId('ribbon-comment-text'), '  Check this figure  ');
    await user.click(screen.getByTestId('ribbon-insert-comment-submit'));
    await waitFor((): void => expect(editor.sent).toEqual([{
      name: 'insertComment',
      comment: { id: 'comment-1', author: 'Ada Lovelace', date: FIXED_ENVIRONMENT.now(), text: 'Check this figure', resolved: false },
    }]));
  });

  it('cannot comment before the name has loaded', async () => {
    const { editor, user } = setUp(null);
    await openTab(user, 'insert');
    expect(screen.getByTestId('ribbon-insert-comment')).toHaveAttribute('aria-disabled', 'true');
    await user.click(screen.getByTestId('ribbon-insert-comment'));
    expect(screen.queryByTestId('ribbon-insert-comment-dialog')).toBeNull();
    expect(editor.sent).toEqual([]);
  });

  it('inserts a footnote under an id the editor picks and goes to it, each break kind, and a symbol', async () => {
    const { editor, user } = setUp('Ada');
    // What InsertNewFootnote answers: the id the editor picked (the fake answers every command with its state).
    editor.state = editorState(PLAIN, { created: [{ kind: 'footnote', id: 7 }] });
    await openTab(user, 'insert');
    await user.click(screen.getByTestId('ribbon-insert-footnote'));
    await waitFor((): void => expect(editor.sent).toEqual([{ name: 'insertNewFootnote' }, { name: 'goToFootnote', id: 7 }]));
    editor.state = editorState(PLAIN);
    for (const kind of ['page', 'column', 'line']) await user.click(screen.getByTestId(`ribbon-insert-break-${kind}`));
    await user.click(screen.getByTestId('ribbon-insert-symbol'));
    await user.click(await screen.findByTestId('ribbon-symbol-a9'));
    await waitFor((): void => expect(editor.sent).toEqual([
      { name: 'insertNewFootnote' },
      { name: 'goToFootnote', id: 7 },
      { name: 'insertBreak', kind: 'page' },
      { name: 'insertBreak', kind: 'column' },
      { name: 'insertBreak', kind: 'line' },
      { name: 'insertText', text: '©' },
    ]));
  });

  it('says so, and goes nowhere, when the editor reports no footnote id', async () => {
    const { editor, user } = setUp('Ada');
    await openTab(user, 'insert');
    await user.click(screen.getByTestId('ribbon-insert-footnote'));
    await waitFor((): void => expect(screen.getByTestId('docs-ribbon-status')).toHaveTextContent('Could not insert the footnote. the editor reported no footnote id'));
    expect(editor.sent).toEqual([{ name: 'insertNewFootnote' }]);
  });
});
