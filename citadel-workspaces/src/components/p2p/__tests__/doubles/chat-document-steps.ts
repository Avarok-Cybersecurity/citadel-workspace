/** What a person does with a chat's documents, and what the tests read back, over chat-document-world.tsx. */
import { expect } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { localDbChatStore } from '@/lib/cdoc/chat/chat-local-db';
import type { StoredBase } from '@/lib/cdoc/chat/chat-ports';
import { modelJson } from '@/lib/cdoc/chat/__tests__/doubles/chat-pair';
import type { ChatDocumentWorld } from './chat-document-world';

/** Long enough for the engine to open a replica in process and the fake network to settle. */
export const CANVAS_MS: number = 10_000;
/** A whole flow: typing, the dialog, two canvases opening and a round of the sync. */
export const FLOW_MS: number = 40_000;

export const chatPane = (name: 'Alice' | 'Bob'): HTMLElement => screen.getByTestId(`chat-of-${name}`);

/** Alice makes a document from the composer: `typed` first (in user-event's keyboard syntax), then the dialog. */
export async function makeDocument(user: UserEvent, title: string, typed: string): Promise<void> {
  if (typed !== '') await user.type(within(chatPane('Alice')).getByTestId('p2p-message-input'), typed);
  await user.click(within(chatPane('Alice')).getByRole('button', { name: 'Live Doc' }));
  const dialog: HTMLElement = await screen.findByRole('dialog');
  await user.click(within(dialog).getByTestId('live-doc-app-docs'));
  await user.type(within(dialog).getByTestId('live-doc-title'), title);
  await user.click(within(dialog).getByTestId('live-doc-create'));
}

/** The canvas is up: the host, its title, and the editor's input over the real replica. */
export async function canvasOpen(where: HTMLElement, title: string): Promise<HTMLElement> {
  const pane: HTMLElement = await within(where).findByTestId('chat-document-pane', {}, { timeout: CANVAS_MS });
  expect(within(pane).getByRole('heading', { level: 1 })).toHaveTextContent(title);
  await within(pane).findByTestId('editor-input', {}, { timeout: CANVAS_MS });
  return pane;
}

/** Closes the document (back to the conversation) and reads, as model JSON, what this device stored for it. */
export async function storedText(world: ChatDocumentWorld, where: HTMLElement, account: bigint, docId: string): Promise<string> {
  fireEvent.click(within(where).getByRole('button', { name: 'Messages' }));
  const stored: StoredBase = await waitFor(async (): Promise<StoredBase> => {
    const base: StoredBase | null = await localDbChatStore(account, world.db.connection([account])).loadBase(docId);
    if (base === null) throw new Error(`nothing stored for ${docId} yet`);
    return base;
  }, { timeout: CANVAS_MS });
  return modelJson(stored.snapshot);
}
