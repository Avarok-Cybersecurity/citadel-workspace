/**
 * The request record each ribbon control sends, against fixtures/ribbon-opcodes.json, which is
 * transcribed from the engine's spec rather than from the encoder: a control that sends the
 * wrong command, or a command the encoder writes under the wrong opcode or field order, fails.
 */
import { act, screen, waitFor } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { EditorCommand, EditorState } from '@/lib/cdoc/editor/controller';
import { encodeCommand } from '@/lib/cdoc/editor/wire/encode-command';
import type { KnownFormatting } from '@/lib/cdoc/editor/caret-formatting';
import { FakeEditor, editorState, knownCaret, A4_NORMAL } from './fake-editor';
import { MAY_EDIT, TestClipboard, fixedEnvironment, renderRibbon } from './render-ribbon';
import fixture from './fixtures/ribbon-opcodes.json';

interface Sent { readonly command: EditorCommand; readonly bytes: readonly number[] }
type Control = keyof typeof fixture.controls;

const PLAIN: KnownFormatting = knownCaret({}, {});
const AT_LEVEL_3: KnownFormatting = knownCaret({}, {}, {}, A4_NORMAL, { kind: 'decimal', level: 3 });

interface Drive { readonly state: EditorState; readonly press: (user: UserEvent) => Promise<void> }

const click = (id: string) => async (user: UserEvent): Promise<void> => { await user.click(await screen.findByTestId(id)); };
const insert = (...ids: string[]) => async (user: UserEvent): Promise<void> => {
  await user.click(screen.getByTestId('docs-ribbon-tab-insert'));
  for (const id of ids) await user.click(await screen.findByTestId(id));
};

const DRIVES: Record<Control, Drive> = {
  cut: { state: editorState(PLAIN, { selectionText: { complete: true, text: 'Quarterly plan' } }), press: click('ribbon-cut') },
  selectAll: { state: editorState(PLAIN), press: click('ribbon-select-all') },
  header: { state: editorState(PLAIN), press: insert('ribbon-edit-header-open', 'ribbon-edit-header-default') },
  evenPagesFooter: {
    state: editorState(PLAIN, { story: { kind: 'header', section: 2, which: 'default' } }),
    press: insert('ribbon-edit-footer-open', 'ribbon-edit-footer-evenPages'),
  },
  footnote: { state: editorState(PLAIN, { created: [{ kind: 'footnote', id: 300 }] }), press: insert('ribbon-insert-footnote') },
  returnToBody: { state: editorState(PLAIN, { story: { kind: 'footnote', id: 300 } }), press: click('docs-story-back') },
  bullets: { state: editorState(PLAIN), press: click('ribbon-bullets') },
  upperRomanAtLevel3: {
    state: editorState(AT_LEVEL_3),
    press: async (user: UserEvent): Promise<void> => { await click('ribbon-numbering-open')(user); await click('ribbon-numbering-upperRoman')(user); },
  },
  noList: { state: editorState(AT_LEVEL_3), press: click('ribbon-list-none') },
  indent: { state: editorState(AT_LEVEL_3), press: click('ribbon-indent') },
  outdent: { state: editorState(AT_LEVEL_3), press: click('ribbon-outdent') },
};

describe('the records the ribbon sends', () => {
  it.each(Object.keys(DRIVES) as Control[])('%s sends the spec’s record and nothing else', async (control: Control) => {
    const expected: readonly Sent[] = fixture.controls[control] as readonly Sent[];
    const drive: Drive = DRIVES[control];
    const editor: FakeEditor = new FakeEditor(PLAIN);
    renderRibbon({ editor, edit: MAY_EDIT, commentAuthor: 'Ada', environment: fixedEnvironment(new TestClipboard()) });
    act((): void => editor.report(drive.state));
    editor.state = drive.state;
    await drive.press(userEvent.setup());
    await waitFor((): void => expect(editor.sent).toEqual(expected.map((s: Sent): EditorCommand => s.command)));
    for (const s of expected) expect([...encodeCommand(s.command)]).toEqual(s.bytes);
  });
});
