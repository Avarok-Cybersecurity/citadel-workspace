/**
 * The background sweep after sign-in: every document on the device-wide index, migrated for
 * the signed-in account, a bounded number per tick, yielding to the UI between ticks.
 *
 * An unreadable index stops the sweep and says so (it is never "no documents"). A document
 * whose migration fails is reported and the sweep moves on: one bad document must not hold
 * the others back, and its next open (or the next sweep) tries it again. Once the engine has
 * no mapper the rest are not attempted: every one would answer the same.
 */
import { readDocumentIndex, type LocalDbGet } from '@/lib/live-document-store/stored-reads';
import type { MigrationOutcome } from './runner';

export interface SweepTarget {
  migrateIfNeeded(docId: string): Promise<MigrationOutcome>;
}

export interface SweepOptions {
  /** Documents migrated before the sweep yields; at least 1. */
  readonly perTick: number;
  /** Resolves when the UI has had its turn (an idle callback or a timeout in the browser). */
  readonly yieldToUi: () => Promise<void>;
  readonly signal: AbortSignal;
}

export type SweepResult =
  | { readonly kind: 'index-unreadable'; readonly message: string }
  | { readonly kind: 'swept'; readonly outcomes: ReadonlyMap<string, MigrationOutcome>; readonly stopped: 'done' | 'aborted' | 'mapper-unavailable' };

export async function sweepLiveDocuments(index: LocalDbGet, target: SweepTarget, options: SweepOptions): Promise<SweepResult> {
  if (!Number.isInteger(options.perTick) || options.perTick < 1) throw new Error(`perTick must be a whole number of at least 1, not ${options.perTick}`);
  let ids: string[];
  try {
    ids = await readDocumentIndex(index);
  } catch (error) {
    return { kind: 'index-unreadable', message: error instanceof Error ? error.message : String(error) };
  }
  const outcomes: Map<string, MigrationOutcome> = new Map();
  for (let i: number = 0; i < ids.length; i += 1) {
    if (options.signal.aborted) return { kind: 'swept', outcomes, stopped: 'aborted' };
    if (i > 0 && i % options.perTick === 0) {
      await options.yieldToUi();
      if (options.signal.aborted) return { kind: 'swept', outcomes, stopped: 'aborted' };
    }
    const outcome: MigrationOutcome = await target.migrateIfNeeded(ids[i]);
    outcomes.set(ids[i], outcome);
    if (outcome.kind === 'mapper-unavailable') return { kind: 'swept', outcomes, stopped: 'mapper-unavailable' };
  }
  return { kind: 'swept', outcomes, stopped: 'done' };
}
