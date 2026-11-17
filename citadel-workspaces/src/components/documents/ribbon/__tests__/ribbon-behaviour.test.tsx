/**
 * What every control shares: disabled with a reason (no editor yet, no right to edit, an IME
 * composition open), a refused command shown and the ribbon left usable, keyboard roving
 * within a tab, and groups collapsing at phone width.
 */
import { act, screen, waitFor } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { FakeEditor, editorState, knownCaret } from './fake-editor';
import { MAY_EDIT, renderRibbon } from './render-ribbon';

const DESKTOP_WIDTH: number = window.innerWidth;
afterEach((): void => { window.innerWidth = DESKTOP_WIDTH; });

describe('a ribbon that cannot run commands', () => {
  it('is not there at all before an editor exists, rather than a ribbon of dead controls', () => {
    renderRibbon({ editor: null, edit: MAY_EDIT, commentAuthor: 'Ada' });
    expect(screen.queryByTestId('docs-ribbon')).toBeNull();
  });

  it('is read only, with the permission’s reason, for someone who may not edit', async () => {
    const editor: FakeEditor = new FakeEditor({ known: false });
    renderRibbon({ editor, edit: { enabled: false, reason: 'You may only read this document.' }, commentAuthor: 'Ada' });
    expect(screen.getByTestId('docs-ribbon-status')).toHaveTextContent('You may only read this document.');
    const user: UserEvent = userEvent.setup();
    await user.click(screen.getByTestId('ribbon-undo'));
    expect(editor.sent).toEqual([]);
    await user.click(screen.getByTestId('docs-ribbon-tab-insert'));
    await user.click(screen.getByTestId('ribbon-insert-link'));
    await user.click(screen.getByTestId('ribbon-insert-table'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('waits while an IME composition is open', async () => {
    const editor: FakeEditor = new FakeEditor({ known: false });
    renderRibbon({ editor, edit: MAY_EDIT, commentAuthor: 'Ada' });
    act((): void => editor.report(editorState({ known: false }, { composing: true })));
    await userEvent.setup().click(screen.getByTestId('ribbon-mark-italic'));
    expect(editor.sent).toEqual([]);
    act((): void => editor.report(editorState({ known: false })));
    await userEvent.setup().click(screen.getByTestId('ribbon-mark-italic'));
    expect(editor.sent).toEqual([{ name: 'toggleMark', mark: 'italic' }]);
  });
});

describe('a refused command', () => {
  it('is shown in a toast and kept in the status line, focus still returns, and the next command clears it', async () => {
    const editor: FakeEditor = new FakeEditor({ known: false });
    renderRibbon({ editor, edit: MAY_EDIT, commentAuthor: 'Ada' });
    const user: UserEvent = userEvent.setup();
    editor.refuseNext('there is no link here');
    await user.click(screen.getByTestId('docs-ribbon-tab-insert'));
    await user.click(screen.getByTestId('ribbon-remove-link'));
    const refusal: string = 'Could not remove the link. there is no link here';
    await waitFor((): void => expect(screen.getAllByText(refusal)).toHaveLength(2));
    expect(screen.getByTestId('docs-ribbon-status')).toHaveTextContent(refusal);
    await waitFor((): void => expect(editor.focused).toBe(1));
    await user.click(screen.getByTestId('ribbon-insert-footnote'));
    await waitFor((): void => expect(editor.focused).toBe(2));
    await waitFor((): void => expect(screen.getByTestId('docs-ribbon-status')).not.toHaveTextContent(refusal));
    expect(editor.sent.map((c: { name: string }): string => c.name)).toEqual(['removeLink', 'insertNewFootnote']);
  });
});

describe('the status line', () => {
  it('says the caret’s formatting is not shown while the engine does not report it', () => {
    const editor: FakeEditor = new FakeEditor({ known: false });
    renderRibbon({ editor, edit: MAY_EDIT, commentAuthor: 'Ada' });
    expect(screen.getByTestId('docs-ribbon-status')).toHaveTextContent('Formatting at the cursor shows once you click or type in the document.');
    act((): void => editor.report(editorState(knownCaret({}, {}))));
    expect(screen.getByTestId('docs-ribbon-status')).toHaveTextContent(/^$/);
  });
});

describe('keyboard', () => {
  it('makes each tab’s toolbar one Tab stop that the arrows, Home and End move through', async () => {
    renderRibbon({ editor: new FakeEditor({ known: false }), edit: MAY_EDIT, commentAuthor: 'Ada' });
    const user: UserEvent = userEvent.setup();
    const toolbar: HTMLElement = screen.getByTestId('ribbon-home-toolbar');
    const stops: Element[] = [...toolbar.querySelectorAll('[data-roving-item]')].filter((el: Element): boolean => (el as HTMLElement).tabIndex === 0);
    expect(stops).toEqual([screen.getByTestId('ribbon-undo')]);
    act((): void => screen.getByTestId('ribbon-undo').focus());
    await user.keyboard('{ArrowRight}');
    expect(screen.getByTestId('ribbon-redo')).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByTestId('ribbon-paste')).toHaveFocus();
    await user.keyboard('{ArrowLeft}{ArrowLeft}{ArrowLeft}');
    expect(screen.getByTestId('ribbon-styles-open')).toHaveFocus();
    await user.keyboard('{Home}');
    expect(screen.getByTestId('ribbon-undo')).toHaveFocus();
    await user.keyboard('{End}');
    expect(screen.getByTestId('ribbon-styles-open')).toHaveFocus();
    expect(screen.getByTestId('ribbon-styles-open').tabIndex).toBe(0);
    expect(screen.getByTestId('ribbon-undo').tabIndex).toBe(-1);
  });

  it('lets a text field keep the arrows until its caret reaches an end', async () => {
    renderRibbon({ editor: new FakeEditor(knownCaret({}, {})), edit: MAY_EDIT, commentAuthor: 'Ada' });
    const user: UserEvent = userEvent.setup();
    const before: HTMLInputElement = screen.getByTestId('ribbon-home-spacing-before') as HTMLInputElement;
    act((): void => before.focus());
    await user.keyboard('12{ArrowLeft}');
    expect(before).toHaveFocus();
    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(screen.getByTestId('ribbon-line-spacing')).toHaveFocus();
  });

  it('goes from the tab straight to its toolbar on Tab, with no stop on the panel between', async () => {
    renderRibbon({ editor: new FakeEditor({ known: false }), edit: MAY_EDIT, commentAuthor: 'Ada' });
    act((): void => screen.getByTestId('docs-ribbon-tab-home').focus());
    await userEvent.setup().tab();
    expect(screen.getByTestId('ribbon-undo')).toHaveFocus();
  });

  it('switches tabs with the arrow keys', async () => {
    renderRibbon({ editor: new FakeEditor({ known: false }), edit: MAY_EDIT, commentAuthor: 'Ada' });
    const user: UserEvent = userEvent.setup();
    act((): void => screen.getByTestId('docs-ribbon-tab-home').focus());
    await user.keyboard('{ArrowRight}');
    expect(screen.getByTestId('docs-ribbon-tab-insert')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('ribbon-insert-toolbar')).toBeInTheDocument();
  });

  it('gives every control a type="button" or a form role, never a submit by accident', () => {
    renderRibbon({ editor: new FakeEditor({ known: false }), edit: MAY_EDIT, commentAuthor: 'Ada' });
    for (const button of screen.getByTestId('docs-ribbon').querySelectorAll('button')) expect(button).toHaveAttribute('type', 'button');
  });
});

describe('at phone width', () => {
  it('leaves a folded group’s popover on Tab, back to its button, instead of cycling inside it', async () => {
    window.innerWidth = 390;
    renderRibbon({ editor: new FakeEditor({ known: false }), edit: MAY_EDIT, commentAuthor: 'Ada' });
    const user: UserEvent = userEvent.setup();
    await user.click(screen.getByTestId('ribbon-font-open'));
    await screen.findByTestId('ribbon-mark-bold');
    await user.keyboard('{Tab}');
    await waitFor((): void => expect(screen.queryByTestId('ribbon-mark-bold')).toBeNull());
    expect(screen.getByTestId('ribbon-font-open')).toHaveFocus();
  });

  it('collapses each group into one button whose popover holds the same controls', async () => {
    window.innerWidth = 390;
    const editor: FakeEditor = new FakeEditor({ known: false });
    renderRibbon({ editor, edit: MAY_EDIT, commentAuthor: 'Ada' });
    expect(screen.queryByTestId('ribbon-mark-bold')).toBeNull();
    const user: UserEvent = userEvent.setup();
    await user.click(screen.getByTestId('ribbon-font-open'));
    await user.click(await screen.findByTestId('ribbon-mark-bold'));
    await waitFor((): void => expect(editor.sent).toEqual([{ name: 'toggleMark', mark: 'bold' }]));
  });
});
