/**
 * What the peer sends for a chat document this tab does not have open: its edits and renames
 * are recorded on this device, so the document opens with them even if the peer has gone
 * offline since. Only for a document this account already keeps, in the chat with that peer
 * (an unknown id is the peer's to send, never a reason to create a record). A hello or an
 * awareness record needs an open replica to answer, so it waits for the next open, whose own
 * hello catches up; a payload in another format is refused, never recorded.
 */
import type { CdocChatCommandEvent, CdocChatSync } from '@/types/cdoc-chat-sync';
import { errorLog } from '@/lib/debug-config';
import { CHAT_SYNC, type ChatSyncConfig } from './chat-config';
import type { ChatIndexEntry, ChatStoreBackend } from './chat-ports';
import { isChatDocId, laterTitle, readChatSync } from './chat-wire';
import { isOpenHere } from './open-chat-documents';
import { appChatStore } from './chat-app-ports';

/** What the inbox did with a command; the app logs the two that drop it. */
export type InboxOutcome = 'recorded' | 'renamed' | 'open here' | 'not kept' | 'held apart' | 'refused' | 'nothing to record' | 'full';

const tails: Map<string, Promise<unknown>> = new Map<string, Promise<unknown>>();

/** One document's records are read-modify-write, so its commands are recorded one at a time. */
function inTurn<T>(key: string, step: () => Promise<T>): Promise<T> {
  const next: Promise<T> = (tails.get(key) ?? Promise.resolve()).then(step, step);
  tails.set(key, next.then((): void => undefined, (): void => undefined));
  return next;
}

async function record(account: bigint, event: CdocChatCommandEvent, store: ChatStoreBackend, config: ChatSyncConfig): Promise<InboxOutcome> {
  const { payload } = event;
  if (isOpenHere(account, payload.doc_id)) return 'open here';
  const entry: ChatIndexEntry | null = await store.loadEntry(payload.doc_id);
  if (entry === null || entry.peerCid !== event.peerCid) return 'not kept';
  if (entry.heldApart) return 'held apart';
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
  return 'recorded';
}

/** Records `event` for `account` when its document is kept here and closed. */
export function recordClosedDocumentCommand(account: bigint, event: CdocChatCommandEvent, store: ChatStoreBackend, config: ChatSyncConfig): Promise<InboxOutcome> {
  if (!isChatDocId(event.payload.doc_id)) return Promise.resolve('not kept');
  return inTurn(`${account.toString()}:${event.payload.doc_id}`, (): Promise<InboxOutcome> => record(account, event, store, config));
}

/** The app's inbox: the notification's recipient is the account; the legacy path, which names none, is not recorded. */
export function recordForClosedDocument(event: CdocChatCommandEvent): void {
  const account: bigint | undefined = event.recipientCid;
  if (account === undefined) return;
  recordClosedDocumentCommand(account, event, appChatStore(account), CHAT_SYNC).then(
    (outcome: InboxOutcome): void => {
      if (outcome === 'refused' || outcome === 'full') errorLog('ChatDocumentInbox', `Not recorded for ${event.payload.doc_id}: ${outcome}`);
    },
    (error: unknown): void => errorLog('ChatDocumentInbox', `Recording for ${event.payload.doc_id} failed:`, error),
  );
}
