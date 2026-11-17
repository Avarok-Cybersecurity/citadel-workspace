/**
 * Stories: Insert › Header and Footer (EditHeaderFooter for each of a section's three), the bar
 * shown while the caret is in a header, footer or footnote (ReturnToBody), a refusal for one
 * the section never shows, and Select All, which selects the story the caret is in and nothing
 * else.
 */
import { act, screen, waitFor } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { KnownFormatting } from '@/lib/cdoc/editor/caret-formatting';
import { editorState, FakeEditor, knownCaret } from './fake-editor';
import { MAY_EDIT, renderRibbon } from './render-ribbon';

const PLAIN: KnownFormatting = knownCaret({}, {});

function setUp(): { editor: FakeEditor; user: UserEvent } {
  const editor: FakeEditor = new FakeEditor(PLAIN);
  renderRibbon({ editor, edit: MAY_EDIT, commentAuthor: 'Ada' });
  return { editor, user: userEvent.setup() };
}

async function choose(user: UserEvent, furniture: 'header' | 'footer', which: string): Promise<void> {
  await user.click(screen.getByTestId(`ribbon-edit-${furniture}-open`));
  await user.click(await screen.findByTestId(`ribbon-edit-${furniture}-${which}`));
}

describe('headers, footers and footnotes', () => {
  it('edits each of a section’s headers and footers, in the section being edited', async () => {
    const { editor, user } = setUp();
    await user.click(screen.getByTestId('docs-ribbon-tab-insert'));
    await choose(user, 'header', 'default');
    await choose(user, 'footer', 'firstPage');
    await choose(user, 'header', 'evenPages');
    act((): void => editor.report(editorState(PLAIN, { story: { kind: 'footer', section: 2, which: 'evenPages' } })));
    await choose(user, 'header', 'default');
    await waitFor((): void => expect(editor.sent).toEqual([
      { name: 'editHeaderFooter', furniture: 'header', section: 0, which: 'default' },
      { name: 'editHeaderFooter', furniture: 'footer', section: 0, which: 'firstPage' },
      { name: 'editHeaderFooter', furniture: 'header', section: 0, which: 'evenPages' },
      { name: 'editHeaderFooter', furniture: 'header', section: 2, which: 'default' },
    ]));
  });

  it('presses the header or footer being edited, and its kind', async () => {
    const { editor, user } = setUp();
    await user.click(screen.getByTestId('docs-ribbon-tab-insert'));
    act((): void => editor.report(editorState(PLAIN, { story: { kind: 'footer', section: 2, which: 'evenPages' } })));
    expect(screen.getByTestId('ribbon-edit-footer-open')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('ribbon-edit-header-open')).toHaveAttribute('aria-pressed', 'false');
    await user.click(screen.getByTestId('ribbon-edit-footer-open'));
    expect(await screen.findByTestId('ribbon-edit-footer-evenPages')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('ribbon-edit-footer-default')).toHaveAttribute('aria-pressed', 'false');
  });

  it('says why the editor refuses a header the section never shows, and stays in the body', async () => {
    const { editor, user } = setUp();
    await user.click(screen.getByTestId('docs-ribbon-tab-insert'));
    editor.refuseNext('the section has no distinct first page');
    await choose(user, 'footer', 'firstPage');
    await waitFor((): void => expect(screen.getByTestId('docs-ribbon-status')).toHaveTextContent('Could not edit the first page footer. the section has no distinct first page'));
    expect(screen.queryByTestId('docs-story-bar')).toBeNull();
  });

  it('shows the bar in a header, footer or footnote, which leads back to the document', async () => {
    const { editor, user } = setUp();
    expect(screen.queryByTestId('docs-story-bar')).toBeNull();
    act((): void => editor.report(editorState(PLAIN, { story: { kind: 'footer', section: 2, which: 'evenPages' } })));
    expect(screen.getByTestId('docs-story-bar')).toHaveTextContent('Editing the footer (even pages) of section 3. It shows on every page of the section; its cursor and selection are drawn on the first of them.');
    await user.click(screen.getByTestId('docs-story-back'));
    await waitFor((): void => expect(editor.sent).toEqual([{ name: 'returnToBody' }]));
    act((): void => editor.report(editorState(PLAIN, { story: { kind: 'footnote', id: 4 } })));
    expect(screen.getByTestId('docs-story-bar')).toHaveTextContent('Editing a footnote.');
    act((): void => editor.report(editorState(PLAIN)));
    expect(screen.queryByTestId('docs-story-bar')).toBeNull();
  });

  it('selects all of the story the caret is in with one SelectAll, and nothing else', async () => {
    const { editor, user } = setUp();
    act((): void => editor.report(editorState(PLAIN, { story: { kind: 'header', section: 0, which: 'default' } })));
    await user.click(screen.getByTestId('ribbon-select-all'));
    await waitFor((): void => expect(editor.sent).toEqual([{ name: 'selectAll' }]));
    expect(editor.focused).toBe(1);
  });

  it('selects all in a document the person may only read, so it can be copied', async () => {
    const editor: FakeEditor = new FakeEditor(PLAIN);
    renderRibbon({ editor, edit: { enabled: false, reason: 'You can only read this document.' }, commentAuthor: 'Ada' });
    await userEvent.setup().click(screen.getByTestId('ribbon-select-all'));
    await waitFor((): void => expect(editor.sent).toEqual([{ name: 'selectAll' }]));
  });
});
