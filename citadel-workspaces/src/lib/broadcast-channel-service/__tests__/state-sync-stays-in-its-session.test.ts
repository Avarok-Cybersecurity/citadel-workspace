/**
 * A leader tab's workspace must not land in a tab signed in as someone else.
 *
 * One browser, one WebSocket, several sessions in several tabs is how this product is used and
 * how it is tested. The four sibling handlers gate on the payload's cid; state-sync did not,
 * and its payload carries none — so `{ type: 'workspace', data: { workspace, loading,
 * needsWorkspaceInitialization } }` from tab A was applied by tab B over its own workspace.
 * The metadata type records what that costs: an assignment over another session's workspace
 * erased `initialized`, and a modal backdrop then blocked the whole app.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const selected: { cid: bigint | undefined } = { cid: 200n };
vi.mock('@/lib/tab-context', () => ({
  getSelectedUser: async (): Promise<{ selectedCid: bigint | undefined } | null> =>
    selected.cid === undefined ? null : { selectedCid: selected.cid },
}));

import { handleStateSync } from '../message-handlers';
import { eventEmitter } from '@/lib/event-emitter';
import type { BroadcastMessage } from '../types';

function stateSync(targetCid?: bigint): BroadcastMessage {
  return {
    type: 'state-sync',
    data: { type: 'workspace', data: { workspace: { id: 'w', name: 'Theirs' } } },
    timestamp: 1,
    tabId: 'tab-a',
    isLeader: true,
    targetCid,
  } as BroadcastMessage;
}

describe('state-sync stays in its session', () => {
  let applied: unknown[];
  beforeEach(() => {
    applied = [];
    selected.cid = 200n;
  });

  it('applies state addressed to this tab', async () => {
    const off: () => void = eventEmitter.on('broadcast-state-sync', (d: unknown): number => applied.push(d));
    await handleStateSync(stateSync(200n));
    expect(applied).toHaveLength(1);
    if (typeof off === 'function') off();
  });

  it('drops state addressed to another session', async () => {
    const off: () => void = eventEmitter.on('broadcast-state-sync', (d: unknown): number => applied.push(d));
    await handleStateSync(stateSync(999n));
    expect(applied, "another session's workspace must not be applied here").toHaveLength(0);
    if (typeof off === 'function') off();
  });

  it('still applies an unaddressed message, so an early-boot sender keeps working', async () => {
    const off: () => void = eventEmitter.on('broadcast-state-sync', (d: unknown): number => applied.push(d));
    await handleStateSync(stateSync(undefined));
    expect(applied).toHaveLength(1);
    if (typeof off === 'function') off();
  });

  it('applies anything when this tab has no session yet', async () => {
    selected.cid = undefined;
    const off: () => void = eventEmitter.on('broadcast-state-sync', (d: unknown): number => applied.push(d));
    await handleStateSync(stateSync(999n));
    expect(applied).toHaveLength(1);
    if (typeof off === 'function') off();
  });
});
