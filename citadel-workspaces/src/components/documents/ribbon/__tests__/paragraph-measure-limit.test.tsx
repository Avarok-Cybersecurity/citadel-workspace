/**
 * The paragraph spacing and indent fields hold a value to PARAGRAPH_MEASURE_MAX_PT (a UI bound,
 * Word's field maximum) on either side: the bound itself is sent, one point past it is kept in
 * the field with the range and nothing is sent.
 */
import { screen, waitFor } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { EditorCommand } from '@/lib/cdoc/editor/controller';
import { FakeEditor, knownCaret } from './fake-editor';
import { MAY_EDIT, renderRibbon } from './render-ribbon';

function setUp(): { editor: FakeEditor; user: UserEvent } {
  const editor: FakeEditor = new FakeEditor(knownCaret({}, {}));
  renderRibbon({ editor, edit: MAY_EDIT, commentAuthor: 'Ada' });
  return { editor, user: userEvent.setup() };
}

async function enter(user: UserEvent, id: string, points: string): Promise<HTMLElement> {
  await user.click(screen.getByTestId('docs-ribbon-tab-layout'));
  const field: HTMLElement = screen.getByTestId(id);
  await user.clear(field);
  await user.type(field, `${points}{Enter}`);
  return field;
}

const CASES: readonly (readonly [string, string, string, EditorCommand, string])[] = [
  ['ribbon-layout-spacing-before', '1584', '1585', { name: 'setParagraphProperty', patch: { spacing: { before: 158400 } } }, 'Enter 0 to 1584 pt.'],
  ['ribbon-layout-indent-left', '1584', '1585', { name: 'setParagraphProperty', patch: { indent: { left: 158400 } } }, 'Enter -1584 to 1584 pt.'],
  ['ribbon-layout-indent-right', '-1584', '-1585', { name: 'setParagraphProperty', patch: { indent: { right: -158400 } } }, 'Enter -1584 to 1584 pt.'],
];

describe('the paragraph measure bound', () => {
  it.each(CASES)('%s takes %s pt', async (id: string, inside: string, _past: string, sent: EditorCommand) => {
    const { editor, user } = setUp();
    const field: HTMLElement = await enter(user, id, inside);
    expect(field).not.toHaveAttribute('aria-invalid', 'true');
    await waitFor((): void => expect(editor.sent).toEqual([sent]));
  });

  it.each(CASES)('%s refuses one point past it', async (id: string, _inside: string, past: string, _sent: EditorCommand, range: string) => {
    const { editor, user } = setUp();
    const field: HTMLElement = await enter(user, id, past);
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByTestId(`${id}-error`)).toHaveTextContent(range);
    expect(editor.sent).toEqual([]);
  });
});
