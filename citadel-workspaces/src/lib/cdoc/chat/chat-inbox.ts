/**
 * What the peer sends for a chat document this tab does not have open: its edits and renames
 * are recorded on this device, so the document opens with them even if the peer has gone
 * offline since. Only for a document this account already keeps, in the chat with that peer
 * (an unknown id is the peer's to send, never a reason to create a record). A hello or an
 * awareness record needs an open replica to answer, so it waits for the next open, whose own
 * hello catches up; a payload in another format is refused, never recorded.
 */
import type { CdocChatCommandEvent, CdocChatSync } from '@/types/cdoc-chat-sync';
import type { ChatSyncConfig } from './chat-config';
import type { ChatIndexEntry, ChatStoreBackend } from './chat-ports';
import { isChatDocId, laterTitle, readChatSync } from './chat-wire';
import { isOpenHere } from './open-chat-documents';

/** What the inbox did with a command; the app logs the two that drop it. */
export type InboxOutcome = 'recorded' | 'renamed' | 'open here' | 'not kept' | 'refused' | 'nothing to record' | 'full';

/** The writer the inbox announces its records as: never an open replica, so every open one hears them. */
const INBOX: object = Object.freeze({ writer: 'chat-document-inbox' });

async function record(account: bigint, event: CdocChatCommandEvent, store: ChatStoreBackend, config: ChatSyncConfig): Promise<InboxOutcome> {
  const { payload } = event;
  if (isOpenHere(account, payload.doc_id)) return 'open here';
  const entry: ChatIndexEntry | null = await store.loadEntry(payload.doc_id);
  if (entry === null || entry.peerCid !== event.peerCid) return 'not kept';
  if (payload.doc_version !== config.docVersion) return 'refused';
  const sync: CdocChatSync = readChatSync(payload);
  if (sync.kind === 'rename') {
    if (!laterTitle(entry.title, sync.title)) return 'nothing to record';
    await store.saveEntry(payload.doc_id, { ...entry, title: sync.title });
    return 'renamed';
  }
  const arrived: readonly Uint8Array[] = sync.kind === 'update' ? sync.updates : sync.kind === 'diff' ? [sync.chunk] : [];
  if (arrived.length === 0) return 'nothing to record';
  const pending: readonly Uint8Array[] = await store.loadPending(payload.doc_id);
  if (pending.length + arrived.length > config.closedMaxPending) return 'full';
  await store.savePending(payload.doc_id, [...pending, ...arrived]);
  store.wrote(payload.doc_id, INBOX);
  return 'recorded';
}

/**
 * Records `event` for `account` when its document is kept here and closed in this window. Its
 * records are read-modify-write and another window may write the same copy (it has the document
 * open, or records the same command), so the whole step takes the copy's browser-wide turn.
 */
export function recordClosedDocumentCommand(account: bigint, event: CdocChatCommandEvent, store: ChatStoreBackend, config: ChatSyncConfig): Promise<InboxOutcome> {
  if (!isChatDocId(event.payload.doc_id)) return Promise.resolve('not kept');
  return store.exclusive(event.payload.doc_id, (): Promise<InboxOutcome> => record(account, event, store, config));
}
