/**
 * Tombstone GC runs only immediately before a snapshot, by the client storing it, only when
 * configured 'whenAlone' and no other peer is present; otherwise the snapshot is uncollected.
 * Real replicas: what is collected shows in the stored snapshot's size.
 */
import { describe, expect, it } from 'vitest';
import type { EditorSession } from '../../editor/editor-session';
import type { DocumentSessionConfig } from '../ports';
import { ALICE, BOB, newDocument, openTab, type Tab } from './doubles/harness';
import { realReplicas, typeInto } from './doubles/real-replicas';

type RealTab = Tab<EditorSession>;
type Stored = { readonly request: { StoreSnapshot: { snapshot: number[] } } };

const CHURN: number = 50;

/** Alice types and deletes, so her replica holds tombstones, then stores one snapshot. */
async function churnThenSnapshot(config: Partial<DocumentSessionConfig>, bobPresent: boolean): Promise<number> {
  const { kernel, clock } = await newDocument({});
  const alice: RealTab = openTab(kernel, clock, ALICE, { snapshotAfterLocalUpdates: 2 * CHURN, ...config }, realReplicas(), null);
  const bob: RealTab = openTab(kernel, clock, BOB, {}, realReplicas(), null);
  const sessions: RealTab['session'][] = bobPresent ? [alice.session, bob.session] : [alice.session];
  await alice.session.open();
  if (bobPresent) await bob.session.open();
  await kernel.settle(sessions);
  await typeInto(alice.replica(), 'x'.repeat(CHURN));
  for (let i: number = 0; i < CHURN; i += 1) await alice.replica().execute({ name: 'deleteBackward', unit: 'char' });
  await kernel.settle(sessions);
  const stored: Stored[] = kernel.sentOf('StoreSnapshot') as Stored[];
  expect(stored).toHaveLength(1);
  expect(alice.problems).toEqual([]);
  return stored[0].request.StoreSnapshot.snapshot.length;
}

describe('gc before a snapshot', () => {
  it('collects when alone, and the snapshot shrinks', async () => {
    const alone: number = await churnThenSnapshot({ gcBeforeSnapshot: 'whenAlone' }, false);
    const uncollected: number = await churnThenSnapshot({ gcBeforeSnapshot: 'never' }, false);
    // 50 collected units and 50 deletes: at least a byte each. Snapshot layout 2 (citadel-docs
    // 2e2f761) gap-codes clocks, so a churned run costs about 2 bytes a character, not several.
    expect(alone).toBeLessThan(uncollected - 2 * CHURN);
  });

  it('does not collect while another peer is present', async () => {
    const present: number = await churnThenSnapshot({ gcBeforeSnapshot: 'whenAlone' }, true);
    const uncollected: number = await churnThenSnapshot({ gcBeforeSnapshot: 'never' }, false);
    expect(present).toBe(uncollected);
  });

  it('never collects when configured never, even alone', async () => {
    const never: number = await churnThenSnapshot({ gcBeforeSnapshot: 'never' }, false);
    const alone: number = await churnThenSnapshot({ gcBeforeSnapshot: 'whenAlone' }, false);
    expect(never).toBeGreaterThan(alone + 2 * CHURN);
  });
});
