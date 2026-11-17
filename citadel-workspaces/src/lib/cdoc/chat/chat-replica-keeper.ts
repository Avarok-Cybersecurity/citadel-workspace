/**
 * A chat document's replica, opened and kept for DocsCanvas (the ReplicaKeeper seam): from
 * this device's copy when there is one (its snapshot, then the updates applied since, in
 * order), else blank or from the migration it was converted by; then kept in step with the
 * peer (chat-sync.ts) and written back after each pause (chat-replica-store.ts). Always live:
 * there is no Save. The replica opens with a fresh random client id every time, whatever it
 * opens from (the runtime's EditorOpener mints it), never the migration's.
 *
 * A stored copy in another CRDT format, or one that belongs to another chat, is not opened:
 * the open fails with the reason, and the copy is left as it is.
 */
import type { CdocChatTitleStamp } from '@/types/cdoc-chat-sync';
import type { EditorController, EditorOrigin } from '../editor/controller';
import type { Keeper } from '../collab/replica-keeper';
import type { ChatSyncConfig } from './chat-config';
import type { ChatIndexEntry, ChatStoreBackend, StoredBase } from './chat-ports';
import { ChatSyncError, type ChatSyncProblem } from './chat-problems';
import { ChatReplicaStore } from './chat-replica-store';
import { ChatDocumentSync, type ChatSyncPorts } from './chat-sync';
import { isChatDocId } from './chat-wire';
import { holdOpen } from './open-chat-documents';

/** What a document new to this device opens from. */
export type ChatDocumentOrigin =
  | { readonly kind: 'blank' }
  /** Blank, with the creator's typed text as its first paragraphs (one per line). */
  | { readonly kind: 'seeded'; readonly text: string }
  /** Converted from an earlier format; `migrationOrigin` names the source, and both peers compare it. */
  | { readonly kind: 'migrated'; readonly snapshot: Uint8Array; readonly migrationOrigin: string };

export interface ChatKeeperPorts extends ChatSyncPorts {
  readonly store: ChatStoreBackend;
}

export interface ChatKeeperHost {
  report(problem: ChatSyncProblem): void;
  /** The document's title, as stored when it opens and whenever a rename wins after. */
  titled(stamp: CdocChatTitleStamp): void;
  /** The kept sync, while it runs (rename goes through it); null once the document closes. */
  bound(sync: ChatDocumentSync | null): void;
  /** The peer's copy was moved from another original (`theirs`); the two are held apart from now on. */
  heldApart(theirs: string | null): void;
}

interface StoredCopy {
  readonly entry: ChatIndexEntry | null;
  readonly base: StoredBase | null;
  readonly pending: readonly Uint8Array[];
}

async function readCopy(store: ChatStoreBackend, docId: string): Promise<StoredCopy> {
  try {
    const [entry, base, pending] = await Promise.all([store.loadEntry(docId), store.loadBase(docId), store.loadPending(docId)]);
    return { entry, base, pending };
  } catch (cause: unknown) {
    throw new ChatSyncError({ kind: 'storeFailed', operation: 'read', cause });
  }
}

function checkCopy(copy: StoredCopy, docId: string, peerCid: bigint, docVersion: number): void {
  if (copy.entry !== null && copy.entry.peerCid !== peerCid) throw new ChatSyncError({ kind: 'otherChat', docId });
  if (copy.base !== null && copy.base.docVersion !== docVersion) {
    throw new ChatSyncError({ kind: 'docVersionMismatch', expected: docVersion, received: copy.base.docVersion, where: 'the stored copy' });
  }
}

const editorOrigin = (base: StoredBase | null, origin: ChatDocumentOrigin): EditorOrigin =>
  base !== null ? { kind: 'snapshot', snapshot: base.snapshot }
    : origin.kind === 'migrated' ? { kind: 'snapshot', snapshot: origin.snapshot } : { kind: 'blank' };

/** The creator's text, typed into the new blank replica: a paragraph per line. */
export async function seed(editor: EditorController, text: string): Promise<void> {
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (index > 0) await editor.execute({ name: 'splitParagraph' });
    if (line.length > 0) await editor.execute({ name: 'insertText', text: line });
  }
}

export function chatReplicaKeeper<E extends EditorController>(
  docId: string,
  origin: ChatDocumentOrigin,
  config: ChatSyncConfig,
  ports: ChatKeeperPorts,
  host: ChatKeeperHost,
): Keeper<E> {
  return (open: (from: EditorOrigin) => Promise<E>, show: (editor: E) => void, fail: (error: unknown) => void): (() => Promise<void>) => {
    let live: boolean = true;
    let close: (() => Promise<void>) | null = null;
    const keep = async (editor: E, copy: StoredCopy): Promise<void> => {
      for (const update of copy.pending) await editor.applyRemote(update);
      let entry: ChatIndexEntry = copy.entry ?? { peerCid: ports.transport.peerCid, title: null, heldApart: false };
      const saveEntry = (next: ChatIndexEntry): void => {
        entry = next;
        ports.store.saveEntry(docId, next).catch((cause: unknown): void => host.report({ kind: 'storeFailed', operation: 'write', cause }));
      };
      if (copy.entry === null) await ports.store.saveEntry(docId, entry);
      else if (copy.entry.title !== null) host.titled(copy.entry.title);
      if (!live) return editor.dispose();
      const migrationOrigin: string | null = copy.base !== null ? copy.base.migrationOrigin : origin.kind === 'migrated' ? origin.migrationOrigin : null;
      const kept: ChatReplicaStore = new ChatReplicaStore(ports.store, docId, config, ports.clock,
        { baseStored: copy.base !== null, pending: copy.pending, migrationOrigin },
        { snapshot: (): Promise<Uint8Array> => editor.snapshot(), report: host.report });
      const sync: ChatDocumentSync = new ChatDocumentSync(config, { docId, migrationOrigin, title: entry.title, heldApart: entry.heldApart }, editor, ports, {
        report: host.report,
        applied: (update: Uint8Array): void => kept.added(update),
        titled: (stamp: CdocChatTitleStamp): void => {
          host.titled(stamp);
          saveEntry({ ...entry, title: stamp });
        },
        heldApart: (theirs: string | null): void => {
          saveEntry({ ...entry, heldApart: true });
          host.heldApart(theirs);
        },
        // The page draws them (PeerOverlay); a chat document lists no one beside that.
        peers: (): void => undefined,
      });
      const release: () => void = holdOpen(ports.transport.selfCid, docId);
      sync.start();
      host.bound(sync);
      show(editor);
      close = (): Promise<void> => {
        host.bound(null);
        sync.stop();
        release();
        // Steps already queued finish first, then the last edits are written, then the replica goes.
        return sync.settled().then((): Promise<void> => kept.write()).finally((): void => editor.dispose());
      };
    };
    const start = async (): Promise<void> => {
      if (!isChatDocId(docId)) throw new Error(`not a chat document id: "${docId}"`);
      const copy: StoredCopy = await readCopy(ports.store, docId);
      checkCopy(copy, docId, ports.transport.peerCid, config.docVersion);
      const editor: E = await open(editorOrigin(copy.base, origin));
      if (!live) return editor.dispose();
      try {
        if (copy.base === null && copy.entry === null && origin.kind === 'seeded') await seed(editor, origin.text);
        await keep(editor, copy);
      } catch (error: unknown) {
        editor.dispose();
        throw error;
      }
    };
    const starting: Promise<void> = start().catch((error: unknown): void => {
      if (live) fail(error);
    });
    return async (): Promise<void> => {
      live = false;
      // An open still under way finishes first (and, no longer live, disposes what it opened).
      await starting;
      await close?.();
    };
  };
}
