/**
 * `setCid` emitted `instance:cid-changed` unconditionally, including when the
 * cid it was handed was the one already set.
 *
 * That was harmless while nothing destructive listened. It stopped being
 * harmless once four resets bound to it: the permissions cache, the group
 * reconciler, the channel's cid rebroadcast, and the conversation-cache reset
 * added for the account-switch bug. Five call sites re-set the cid on paths that
 * are not session switches at all — post-auth setup, IO service init, the
 * channel's tab-selection sync, orphan-session selection, and connect — so an
 * ordinary reconnect wiped the in-memory message cache and the connections map
 * and then restored only the conversations, leaving peers rendered as
 * disconnected until something re-established their presence.
 *
 * CID is permanent per account, so "the cid I already have" is never a session
 * switch. An event named `cid-changed` that fires when the cid did not change is
 * simply wrong, and the guard belongs at the emit rather than in each of the
 * four listeners.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { instanceManager } from '../instance-manager';
import { eventEmitter } from '@/lib/event-emitter';

const CID: bigint = 12345678901234n;
const OTHER: bigint = 98765432109876n;

describe('setCid', () => {
  let seen: Array<bigint | null>;
  let off: () => void;

  beforeEach(() => {
    seen = [];
    const handler = (data: { cid: bigint | null }): void => {
      seen.push(data.cid);
    };
    eventEmitter.on('instance:cid-changed', handler);
    off = (): void => {
      eventEmitter.off('instance:cid-changed', handler);
    };
    instanceManager.setCid(null);
    seen = [];
  });

  afterEach(() => {
    off();
    instanceManager.setCid(null);
  });

  it('announces a real change', () => {
    instanceManager.setCid(CID);
    expect(seen).toEqual([CID]);
  });

  it('does NOT announce a change when handed the cid it already has', () => {
    instanceManager.setCid(CID);
    instanceManager.setCid(CID);
    instanceManager.setCid(CID);

    // The defect in one assertion. Three of these calls are the reconnect and
    // tab-sync paths; only the first is a session switch.
    expect(seen).toEqual([CID]);
  });

  it('still announces every genuine switch in a sequence', () => {
    instanceManager.setCid(CID);
    instanceManager.setCid(CID);
    instanceManager.setCid(OTHER);
    instanceManager.setCid(OTHER);
    instanceManager.setCid(CID);

    expect(seen).toEqual([CID, OTHER, CID]);
  });

  it('treats clearing the cid as a change, and clearing twice as one', () => {
    instanceManager.setCid(CID);
    instanceManager.setCid(null);
    instanceManager.setCid(null);

    expect(seen).toEqual([CID, null]);
  });

  it('records the cid even when it announces nothing', () => {
    instanceManager.setCid(CID);
    instanceManager.setCid(CID);

    // Suppressing the event must not suppress the assignment: the state the
    // rest of the app reads is still the cid it was handed.
    expect(instanceManager.getState().cid).toBe(CID);
  });
});
