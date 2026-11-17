/**
 * What is recorded when the chat holds two moved copies of a document apart
 * (lib/cdoc/chat/chat-migration-gate.ts): the conflict the loss banner states, for this account.
 *
 * The rule is conflict-rule.ts's: the creator's copy is the document. The creator keeps its
 * own. A non-creator would adopt the creator's (peer-migration.ts), but the chat's wire carries
 * no snapshot to adopt, so it records 'held-apart' and keeps its own copy, said as its alone.
 * A copy that was never moved here has no marker and nothing to record: the chat's own notice
 * (chat-problems.ts) is all there is to say.
 */
import { AccountMigrationStore, migrationKeys, type MigrationLocalDb } from './account-store';
import { CONFLICT_VERSION, encodeConflict, type ConflictRecord } from './conflict-record';
import type { CreatorSide } from './conflict-rule';
import type { MigrationMarker } from './marker';
import type { MigrationRunner } from './runner';

const RESOLUTION: { readonly [K in CreatorSide]: ConflictRecord['resolution'] } = {
  local: 'creator-keeps',
  peer: 'held-apart',
  neither: 'await-creator',
};

export async function recordHeldApart(
  runner: MigrationRunner, db: MigrationLocalDb, docId: string, peerOrigin: string | null, creator: CreatorSide,
): Promise<ConflictRecord | null> {
  const local: MigrationMarker | null = await runner.readMarker(docId);
  if (local === null) return null;
  const conflict: ConflictRecord = { v: CONFLICT_VERSION, resolution: RESOLUTION[creator], localOrigin: local.originYjsSvHash, peerOrigin, lostEdits: [] };
  await new AccountMigrationStore(db, runner.accountCid).set(migrationKeys(docId).conflict, encodeConflict(conflict));
  return conflict;
}
