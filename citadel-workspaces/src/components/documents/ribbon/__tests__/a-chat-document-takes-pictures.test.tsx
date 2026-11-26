/**
 * A chat document keeps its pictures: a scratchpad's on this device, a direct chat's on both
 * people's devices, exchanged over their P2P channel (lib/cdoc/pictures/pair-pictures.ts). So
 * its Picture control is enabled, as a workspace document's is, and pressing it opens the file
 * picker. The ribbon is given the plan's reason exactly as DocsCanvas derives it.
 */
import { screen } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { openChatDocument, type ChatDocument } from '../../chat-replica';
import { FakeEditor, knownCaret } from './fake-editor';
import { MAY_EDIT, renderRibbon } from './render-ribbon';

const SELF: bigint = 501n;

async function pictureControlOf(peerCid: bigint): Promise<{ readonly disabled: string | null; readonly picked: boolean }> {
  const chat: ChatDocument = openChatDocument({ cid: peerCid, name: 'Bob', username: 'bob' }, {
    docId: 'chat-doc-1', selfCid: SELF, title: 'Notes', origin: { kind: 'blank' },
  });
  if (chat.editing.kind !== 'replica') throw new Error('a chat document is edited through a kept replica');
  expect(chat.editing.save).toBeNull();
  expect(chat.editing.pictures.kind).toBe('stored');
  const editor: FakeEditor = new FakeEditor(knownCaret({}, {}));
  renderRibbon({ editor, edit: MAY_EDIT, commentAuthor: 'Ada', pictures: chat.editing.pictures.kind === 'none' ? chat.editing.pictures.reason : null });
  const user: UserEvent = userEvent.setup();
  await user.click(screen.getByTestId('docs-ribbon-tab-insert'));
  const picture: HTMLElement = screen.getByTestId('ribbon-insert-picture');
  let picked: boolean = false;
  screen.getByTestId('ribbon-picture-file').addEventListener('click', (): void => { picked = true; });
  const disabled: string | null = picture.getAttribute('aria-disabled');
  await user.click(picture);
  return { disabled, picked };
}

describe('a chat document\'s Picture control', () => {
  it('is enabled in a direct chat\'s document, and opens the file picker', async () => {
    expect(await pictureControlOf(502n)).toEqual({ disabled: 'false', picked: true });
  });

  it('is enabled in a scratchpad document, and opens the file picker', async () => {
    expect(await pictureControlOf(SELF)).toEqual({ disabled: 'false', picked: true });
  });
});
