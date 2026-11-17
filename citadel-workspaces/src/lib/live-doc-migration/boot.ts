/**
 * The chat-document migration with its real I/O: the agent's LocalDB through the websocket
 * service, the signed-in account this tab acts as, and cdoc-wasm's StarterKit importer.
 *
 * Loaded only by dynamic import (check-bundle-budget's DEFERRED_MODULES): the sweep from the
 * signed-in layout (hooks/use-live-doc-migration-sweep.ts), and `chatDocumentMigration` from the
 * chat's document tab when it opens one.
 */
import { websocketService } from '@/lib/websocket-service';
import { getCurrentCid } from '@/lib/p2p/current-cid';
import { debugLog, warnLog } from '@/lib/debug-config';
import { MigrationRunner, type MigrationOutcome } from './runner';
import { sweepLiveDocuments, type SweepResult } from './sweep';
import { applyPeerMigration, type PeerMigration, type PeerMigrationOutcome } from './peer-migration';
import { recordHeldApart } from './held-apart';
import { loadCdocMigrationMapper } from './cdoc-mapper';
import type { CreatorSide } from './conflict-rule';
import type { MigrationMarker } from './marker';
import type { MigrationLocalDb } from './account-store';
import type { ConversionReport } from '@/lib/cdoc/editor/file-formats';
import type { ConflictRecord } from './conflict-record';
import type { WalkedDocument } from './yjs-walker';
import { migrationReport, originalDocument, type OriginalDocument } from './migration-report';

/** One document per tick: each may load the engine and convert a whole document. */
const SWEEP_DOCS_PER_TICK: number = 1;
/** How long the sweep waits for an idle moment before taking its turn anyway, in ms. */
const SWEEP_IDLE_TIMEOUT_MS: number = 2_000;

const db: MigrationLocalDb = websocketService;
const runners: Map<bigint, MigrationRunner> = new Map();

function runnerFor(account: bigint): MigrationRunner {
  let runner: MigrationRunner | undefined = runners.get(account);
  if (runner === undefined) {
    runner = new MigrationRunner({ db, accountCid: account, loadMapper: loadCdocMigrationMapper });
    runners.set(account, runner);
  }
  return runner;
}

/** The sweep's account: the one signed in on this tab. */
async function runnerForThisTab(): Promise<MigrationRunner> {
  const cid: bigint | null = await getCurrentCid();
  if (cid === null) throw new Error('no account is signed in on this tab, so there is no account to migrate documents for');
  return runnerFor(cid);
}

/** The migration as one account sees it: the chat's own, whichever account this tab shows. */
function forAccount(account: bigint): AccountMigration {
  const runner: MigrationRunner = runnerFor(account);
  return {
    migrateIfNeeded: (docId: string): Promise<MigrationOutcome> => runner.migrateIfNeeded(docId),
    readMigrated: (docId: string): Promise<{ readonly marker: MigrationMarker; readonly snapshot: Uint8Array } | null> => runner.readMigrated(docId),
    loadBanner: async (docId: string): Promise<{ readonly report: ConversionReport; readonly conflict: ConflictRecord | null } | null> => {
      const [marker, conflict]: [MigrationMarker | null, ConflictRecord | null] = await Promise.all([runner.readMarker(docId), runner.readConflict(docId)]);
      return marker === null ? null : { report: migrationReport(marker, conflict), conflict };
    },
    loadOriginal: async (docId: string): Promise<OriginalDocument | null> => {
      const original: { readonly walked: WalkedDocument; readonly title: string } | null = await runner.readOriginal(docId);
      if (original === null) return null;
      return originalDocument(original.walked, original.title, await loadCdocMigrationMapper());
    },
    applyPeerMigration: (docId: string, peer: PeerMigration, creator: CreatorSide): Promise<PeerMigrationOutcome> => applyPeerMigration(runner, db, docId, peer, creator),
    recordHeldApart: (docId: string, peerOrigin: string | null, creator: CreatorSide): Promise<ConflictRecord | null> => recordHeldApart(runner, db, docId, peerOrigin, creator),
  };
}

function yieldToUi(): Promise<void> {
  return new Promise<void>((resolve: () => void): void => {
    // WebKit has no requestIdleCallback; a timeout still lets the UI take its turn.
    if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback((): void => resolve(), { timeout: SWEEP_IDLE_TIMEOUT_MS });
    else window.setTimeout(resolve, 0);
  });
}

function reportSweep(result: SweepResult): void {
  if (result.kind === 'index-unreadable') {
    warnLog('LiveDocMigration', 'The document index could not be read; nothing was migrated.', result.message);
    return;
  }
  for (const [docId, outcome] of result.outcomes) {
    if (outcome.kind === 'failed') warnLog('LiveDocMigration', `Document ${docId} was not migrated (${outcome.stage}).`, outcome.message);
  }
  debugLog('LiveDocMigration', 'Sweep', result.stopped, result.outcomes.size);
}

/** Starts the background sweep for this tab's account after sign-in; the returned function stops it. */
function startMigrationSweep(): () => void {
  const controller: AbortController = new AbortController();
  runnerForThisTab()
    .then(async (runner: MigrationRunner): Promise<void> => {
      await yieldToUi();
      if (controller.signal.aborted) return;
      reportSweep(await sweepLiveDocuments(db, runner, { perTick: SWEEP_DOCS_PER_TICK, yieldToUi, signal: controller.signal }));
    })
    .catch((error: unknown): void => warnLog('LiveDocMigration', 'The migration sweep stopped.', error));
  return (): void => controller.abort();
}

/** The migration of one account's chat documents; the chat's document tab acts through it. */
export interface AccountMigration {
  /** Migrates `docId` once (single-flight with the sweep); call it when the chat opens a document. */
  readonly migrateIfNeeded: (docId: string) => Promise<MigrationOutcome>;
  /** The migrated snapshot to open, checked against its marker; null when not migrated. */
  readonly readMigrated: (docId: string) => Promise<{ readonly marker: MigrationMarker; readonly snapshot: Uint8Array } | null>;
  /** The loss banner's report and conflict; null when not migrated. */
  readonly loadBanner: (docId: string) => Promise<{ readonly report: ConversionReport; readonly conflict: ConflictRecord | null } | null>;
  /** The original for "Show original" (LossReportBanner's loadOriginal); null when this device holds none. */
  readonly loadOriginal: (docId: string) => Promise<OriginalDocument | null>;
  /** Acts on a peer's migration (conflict-rule.ts); `creator` says which side made the chat document. */
  readonly applyPeerMigration: (docId: string, peer: PeerMigration, creator: CreatorSide) => Promise<PeerMigrationOutcome>;
  /** The chat held this account's moved copy apart from the peer's: records the conflict the banner states. */
  readonly recordHeldApart: (docId: string, peerOrigin: string | null, creator: CreatorSide) => Promise<ConflictRecord | null>;
}

/** What the chat's document tab and the signed-in layout use. */
export interface ChatDocumentMigration {
  /** The migration for `account`: the chat's local account, named by the chat, not read from the tab. */
  readonly forAccount: (account: bigint) => AccountMigration;
  /** The background sweep, for the account signed in on this tab; the returned function stops it. */
  readonly startSweep: () => () => void;
}

export const chatDocumentMigration: ChatDocumentMigration = {
  forAccount,
  startSweep: startMigrationSweep,
};
