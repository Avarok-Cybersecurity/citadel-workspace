/**
 * A chat document has no content store, so a picture inserted there would reach the other
 * person as an empty box. Its Picture control says so instead of acting: disabled with the
 * reason, pressing it explains, and the file picker never opens. A workspace document's
 * control is unchanged.
 */
import { screen, waitFor } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { CHAT_PICTURES_UNAVAILABLE, openChatDocument, type ChatDocument } from '../../chat-replica';
import { FakeEditor, knownCaret } from './fake-editor';
import { MAY_EDIT, renderRibbon } from './render-ribbon';

describe('a chat document\'s Picture control', () => {
  it('is disabled with the reason, and pressing it explains rather than opening the picker', async () => {
    const chat: ChatDocument = openChatDocument({ cid: 502n, name: 'Bob', username: 'bob' }, {
      docId: 'chat-doc-1', selfCid: 501n, title: 'Notes', origin: { kind: 'blank' }, heldApart: (): void => undefined,
    });
    if (chat.editing.kind !== 'replica') throw new Error('a chat document is edited through a kept replica');
    expect([chat.editing.save, chat.editing.pictures]).toEqual([null, CHAT_PICTURES_UNAVAILABLE]);
    const editor: FakeEditor = new FakeEditor(knownCaret({}, {}));
    renderRibbon({ editor, edit: MAY_EDIT, commentAuthor: 'Ada', pictures: chat.editing.pictures });
    const user: UserEvent = userEvent.setup();
    await user.click(screen.getByTestId('docs-ribbon-tab-insert'));
    const picture: HTMLElement = screen.getByTestId('ribbon-insert-picture');
    expect(picture).toHaveAttribute('aria-disabled', 'true');
    let picked: boolean = false;
    screen.getByTestId('ribbon-picture-file').addEventListener('click', (): void => { picked = true; });
    await user.click(picture);
    expect(picked).toBe(false);
    await waitFor((): void => expect(screen.getByTestId('docs-ribbon-status')).toHaveTextContent(CHAT_PICTURES_UNAVAILABLE));
  });

  it('is unchanged in a workspace document', async () => {
    renderRibbon({ editor: new FakeEditor(knownCaret({}, {})), edit: MAY_EDIT, commentAuthor: 'Ada', pictures: null });
    const user: UserEvent = userEvent.setup();
    await user.click(screen.getByTestId('docs-ribbon-tab-insert'));
    expect(screen.getByTestId('ribbon-insert-picture')).toHaveAttribute('aria-disabled', 'false');
  });
});
