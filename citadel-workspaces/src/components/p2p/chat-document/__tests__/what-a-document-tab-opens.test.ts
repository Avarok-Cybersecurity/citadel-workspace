/**
 * What a chat's document tab opens, decided from the id: a Citadel Docs document opens as a
 * canvas from blank (or from the creator's typed text); an earlier editor's document is moved
 * first and opens over the moved snapshot, its banner read, and a peer's copy held apart is
 * recorded as the creator rule says (the creator is whoever sent the invitation); one that
 * cannot be moved says why, offering the original only where it may be read.
 *
 * The ports are the I/O this logic is handed (the canvas's opener and the migration), so they
 * are the stand-ins here: recording what they were asked, answering as the real ones do. The
 * migration's own behaviour is tested in lib/live-doc-migration, the canvas's in lib/cdoc/chat,
 * and the two together through the whole chat in components/p2p/__tests__.
 */
import { describe, expect, it } from 'vitest';
import type { ChatDocument, ChatDocumentRequest } from '@/components/documents/chat-replica';
import type { AccountMigration, ChatDocumentMigration } from '@/lib/live-doc-migration/boot';
import type { CreatorSide } from '@/lib/live-doc-migration/conflict-rule';
import type { MigrationOutcome } from '@/lib/live-doc-migration/runner';
import type { ConflictRecord } from '@/lib/live-doc-migration/conflict-record';
import { createValueStore } from '@/lib/value-store';
import { openChatDocumentTab, type ChatDocumentOpening, type ChatDocumentTarget, type OpeningPorts } from '../chat-document-opening';

const HEX: string = 'e'.repeat(64);
const SNAPSHOT: Uint8Array = new Uint8Array([7, 7, 7]);

interface Recorded {
  readonly requests: ChatDocumentRequest[];
  readonly heldApart: { readonly docId: string; readonly theirs: string | null; readonly creator: CreatorSide }[];
  readonly accounts: bigint[];
  readonly reports: string[];
}

function ports(outcome: MigrationOutcome): { readonly ports: OpeningPorts; readonly seen: Recorded } {
  const seen: Recorded = { requests: [], heldApart: [], accounts: [], reports: [] };
  const account: AccountMigration = {
    migrateIfNeeded: async (): Promise<MigrationOutcome> => outcome,
    readMigrated: async () => ({ marker: { v: 1, originYjsSvHash: HEX, client: 9n, snapshotSha256: HEX, reportJson: '{}' }, snapshot: SNAPSHOT }),
    loadBanner: async () => ({ report: { losses: [], problems: [] }, conflict: null }),
    loadOriginal: async () => ({ title: 'Plan', docsPm: null, text: 'Ship Friday' }),
    applyPeerMigration: async () => { throw new Error('not on the wire'); },
    recordHeldApart: async (docId: string, theirs: string | null, creator: CreatorSide): Promise<ConflictRecord | null> => {
      seen.heldApart.push({ docId, theirs, creator });
      return null;
    },
  };
  const migration: ChatDocumentMigration = {
    forAccount: (cid: bigint): AccountMigration => { seen.accounts.push(cid); return account; },
    startSweep: (): (() => void) => (): void => undefined,
  };
  const document: ChatDocument = {
    editing: { kind: 'readOnly', reason: 'a stand-in' }, title: createValueStore<string>('t', 'Plan'), rename: async (): Promise<void> => undefined,
  };
  return {
    seen,
    ports: {
      opener: async () => (request: ChatDocumentRequest): ChatDocument => { seen.requests.push(request); return document; },
      migration: async (): Promise<ChatDocumentMigration> => migration,
      report: (title: string): void => { seen.reports.push(title); },
    },
  };
}

const target = (docId: string, creator: 'self' | 'peer', seed: string | null): ChatDocumentTarget => ({ docId, title: 'Plan', selfCid: 1n, creator, seed });
const MOVED: MigrationOutcome = { kind: 'migrated', marker: { v: 1, originYjsSvHash: HEX, client: 9n, snapshotSha256: HEX, reportJson: '{}' }, title: 'Plan' };

describe('a document tab', () => {
  it('opens a Citadel Docs document blank, or from what its creator typed, without moving anything', async () => {
    const { ports: p, seen } = ports(MOVED);
    await openChatDocumentTab(target('cdoc-1', 'self', null), p);
    await openChatDocumentTab(target('cdoc-2', 'self', 'Agenda'), p);
    expect(seen.requests.map((r) => r.origin)).toEqual([{ kind: 'blank' }, { kind: 'seeded', text: 'Agenda' }]);
    expect(seen.accounts).toEqual([]);
  });

  it('opens a moved document over its snapshot, as the chat\'s own account, with its move\'s origin', async () => {
    const { ports: p, seen } = ports(MOVED);
    const opening: ChatDocumentOpening = await openChatDocumentTab(target('uuid-1', 'self', null), p);
    expect(opening.kind).toBe('canvas');
    expect(seen.accounts).toEqual([1n]);
    expect(seen.requests[0].origin).toEqual({ kind: 'migrated', snapshot: SNAPSHOT, migrationOrigin: HEX });
  });

  it('records a copy held apart with the creator the invitation names: its sender', async () => {
    for (const [creator, side] of [['peer', 'peer'], ['self', 'local']] as const) {
      const { ports: p, seen } = ports(MOVED);
      await openChatDocumentTab(target('uuid-1', creator, null), p);
      seen.requests[0].heldApart('f'.repeat(64));
      await new Promise<void>((resolve: () => void): void => { setTimeout(resolve, 0); });
      expect(seen.heldApart).toEqual([{ docId: 'uuid-1', theirs: 'f'.repeat(64), creator: side }]);
    }
  });

  it('records nothing for a Citadel Docs document held apart: it was never moved', async () => {
    const { ports: p, seen } = ports(MOVED);
    await openChatDocumentTab(target('cdoc-1', 'peer', null), p);
    seen.requests[0].heldApart(HEX);
    expect(seen.heldApart).toEqual([]);
  });

  it('says why one cannot be moved, offering the original only where it may be read', async () => {
    const cases: readonly [MigrationOutcome, string, boolean][] = [
      [{ kind: 'no-original' }, 'not-stored', false],
      [{ kind: 'not-owned', reason: 'another account' }, 'not-owned', false],
      [{ kind: 'mapper-unavailable' }, 'no-converter', true],
      [{ kind: 'failed', stage: 'read-original', message: 'timed out' }, 'failed', true],
    ];
    for (const [outcome, reason, offered] of cases) {
      const opening: ChatDocumentOpening = await openChatDocumentTab(target('uuid-1', 'peer', null), ports(outcome).ports);
      expect(opening.kind === 'unmoved' && [opening.reason.kind, opening.loadOriginal !== null]).toEqual([reason, offered]);
    }
  });

  it('says it did not load, never rejecting, when the editor or the migration does not load', async () => {
    const { ports: p } = ports(MOVED);
    const broken: OpeningPorts = { ...p, opener: () => Promise.reject(new Error('chunk failed')), migration: () => Promise.reject(new Error('chunk failed')) };
    for (const id of ['cdoc-1', 'uuid-1']) {
      const opening: ChatDocumentOpening = await openChatDocumentTab(target(id, 'self', null), broken);
      expect(opening).toEqual({ kind: 'unmoved', reason: { kind: 'failed', stage: 'load', message: 'chunk failed' }, loadOriginal: null });
    }
  });
});
