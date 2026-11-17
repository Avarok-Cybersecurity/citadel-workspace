/**
 * What a chat's document tab opens, decided from the document's id (lib/p2p/chat-document-id.ts):
 * a Citadel Docs document opens as a live canvas kept in step with the peer; one made in the
 * earlier chat editor is moved first (lib/live-doc-migration, once per device and account) and
 * opens as a canvas over the moved snapshot with its loss banner, or, when it cannot be moved,
 * as a notice that says why and, where there is one to read, its original. Nothing here is
 * silent: a failed read is a failure with its stage, never "no document".
 *
 * Its I/O arrives as ports (the canvas's opener and the migration, both loaded on first use).
 */
import type { ChatDocument, ChatDocumentRequest } from '@/components/documents/chat-replica';
import type { AccountMigration, ChatDocumentMigration } from '@/lib/live-doc-migration/boot';
import type { ConflictRecord } from '@/lib/live-doc-migration/conflict-record';
import type { CreatorSide } from '@/lib/live-doc-migration/conflict-rule';
import type { MigrationMarker } from '@/lib/live-doc-migration/marker';
import type { OriginalDocument } from '@/lib/live-doc-migration/migration-report';
import type { MigrationOutcome } from '@/lib/live-doc-migration/runner';
import type { ConversionReport } from '@/lib/cdoc/editor/file-formats';
import { chatDocumentFormat } from '@/lib/p2p/chat-document-id';
import { createValueStore, type ValueStore } from '@/lib/value-store';
import type { UnmovedReason } from './chat-document-copy';

/** Who made the document: whoever sent the chat message that names it. */
export type ChatDocumentCreator = 'self' | 'peer';

export interface ChatDocumentTarget {
  readonly docId: string;
  /** The title the chat message gave it. */
  readonly title: string;
  readonly selfCid: bigint;
  readonly creator: ChatDocumentCreator;
  /** The creator's typed text, for a document made in this chat just now; null otherwise. */
  readonly seed: string | null;
}

export interface MovedBanner {
  readonly report: ConversionReport;
  readonly conflict: ConflictRecord['resolution'] | null;
}

export type OriginalLoader = () => Promise<OriginalDocument | null>;

export type ChatDocumentOpening =
  /** `moved`: the loss banner of a moved document (null until read), or null for a Citadel Docs one. */
  | { readonly kind: 'canvas'; readonly document: ChatDocument; readonly moved: { readonly banner: ValueStore<MovedBanner | null>; readonly loadOriginal: OriginalLoader } | null }
  | { readonly kind: 'unmoved'; readonly reason: UnmovedReason; readonly loadOriginal: OriginalLoader | null };

/** Opens a document of one conversation: who it is kept live with is the opener's, not the request's. */
export type ChatDocumentOpener = (request: ChatDocumentRequest) => ChatDocument;

export interface OpeningPorts {
  readonly opener: () => Promise<ChatDocumentOpener>;
  readonly migration: () => Promise<ChatDocumentMigration>;
  /** Says a failure that happens after the pane is up (the banner's read, a conflict's record). */
  readonly report: (title: string, error: unknown) => void;
}

const CREATOR_SIDE: { readonly [K in ChatDocumentCreator]: CreatorSide } = { self: 'local', peer: 'peer' };

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const failed = (stage: Extract<UnmovedReason, { kind: 'failed' }>['stage'], error: unknown, loadOriginal: OriginalLoader | null): ChatDocumentOpening => (
  { kind: 'unmoved', reason: { kind: 'failed', stage, message: messageOf(error) }, loadOriginal }
);

async function openCdoc(target: ChatDocumentTarget, ports: OpeningPorts): Promise<ChatDocumentOpening> {
  const open: ChatDocumentOpener = await ports.opener();
  const document: ChatDocument = open({
    docId: target.docId, selfCid: target.selfCid, title: target.title,
    origin: target.seed === null ? { kind: 'blank' } : { kind: 'seeded', text: target.seed },
    // A new document has no move to record; the chat's own notice (chat-problems.ts) says it.
    heldApart: (): void => undefined,
  });
  return { kind: 'canvas', document, moved: null };
}

function unmoved(outcome: Exclude<MigrationOutcome, { kind: 'migrated' | 'already' }>, loadOriginal: OriginalLoader): ChatDocumentOpening {
  switch (outcome.kind) {
    case 'no-original': return { kind: 'unmoved', reason: { kind: 'not-stored' }, loadOriginal: null };
    case 'not-owned': return { kind: 'unmoved', reason: { kind: 'not-owned' }, loadOriginal: null };
    case 'mapper-unavailable': return { kind: 'unmoved', reason: { kind: 'no-converter' }, loadOriginal };
    case 'failed': return failed(outcome.stage, new Error(outcome.message), loadOriginal);
  }
}

async function openMoved(target: ChatDocumentTarget, ports: OpeningPorts): Promise<ChatDocumentOpening> {
  let migration: AccountMigration;
  try {
    migration = (await ports.migration()).forAccount(target.selfCid);
  } catch (error: unknown) {
    return failed('load', error, null);
  }
  const loadOriginal: OriginalLoader = (): Promise<OriginalDocument | null> => migration.loadOriginal(target.docId);
  // Every stage's failure is an outcome (runner.ts); anything else is openChatDocumentTab's "did not load".
  const outcome: MigrationOutcome = await migration.migrateIfNeeded(target.docId);
  if (outcome.kind !== 'migrated' && outcome.kind !== 'already') return unmoved(outcome, loadOriginal);
  let moved: { readonly marker: MigrationMarker; readonly snapshot: Uint8Array } | null;
  try {
    moved = await migration.readMigrated(target.docId);
    if (moved === null) throw new Error('the move left no copy behind');
  } catch (error: unknown) {
    return failed('open', error, loadOriginal);
  }
  const banner: ValueStore<MovedBanner | null> = createValueStore<MovedBanner | null>(`moved-chat-document:${target.docId}`, null);
  const readBanner = (): Promise<void> => migration.loadBanner(target.docId).then((read): void => {
    banner.set(read === null ? null : { report: read.report, conflict: read.conflict?.resolution ?? null });
  });
  readBanner().catch((error: unknown): void => ports.report('What the move left out could not be read', error));
  const open: ChatDocumentOpener = await ports.opener();
  const document: ChatDocument = open({
    docId: target.docId, selfCid: target.selfCid, title: target.title,
    origin: { kind: 'migrated', snapshot: moved.snapshot, migrationOrigin: moved.marker.originYjsSvHash },
    heldApart: (theirs: string | null): void => {
      migration.recordHeldApart(target.docId, theirs, CREATOR_SIDE[target.creator]).then(readBanner)
        .catch((error: unknown): void => ports.report('The two copies are kept apart, but this could not be recorded', error));
    },
  });
  return { kind: 'canvas', document, moved: { banner, loadOriginal } };
}

/** Never rejects: a part that did not load is an opening that says so. */
export function openChatDocumentTab(target: ChatDocumentTarget, ports: OpeningPorts): Promise<ChatDocumentOpening> {
  const opening: Promise<ChatDocumentOpening> = chatDocumentFormat(target.docId) === 'cdoc' ? openCdoc(target, ports) : openMoved(target, ports);
  return opening.catch((error: unknown): ChatDocumentOpening => failed('load', error, null));
}
