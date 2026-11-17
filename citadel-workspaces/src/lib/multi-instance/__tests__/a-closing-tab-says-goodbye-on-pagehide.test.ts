/**
 * A tab says goodbye when its page is hidden for good, and only then.
 *
 * The goodbye went out on `beforeunload` alone. That event does not fire on much
 * of mobile Safari or when a page enters the back/forward cache, so those tabs'
 * CIDs stayed in the leader's registry; and it can be cancelled, so a user who
 * chose Stay at the unsaved-changes prompt kept a tab that had already left and
 * released its session. The page is a plain EventTarget and the channel a
 * recorder; the instance manager is the real one.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { setupPageDepartureHandlers, type PageEvents, type UnloadChannel } from '../channel-lifecycle';
import { instanceManager } from '../instance-manager';
import { eventEmitter } from '@/lib/event-emitter';

interface Recorder { channel: UnloadChannel; calls: string[] }

function recorder(): Recorder {
  const calls: string[] = [];
  return {
    calls,
    channel: {
      send: (message: { type: string }): void => { calls.push(`send:${message.type}`); },
      announceGoodbye: (): void => { calls.push('goodbye'); },
      relinquishLeadership: (): void => { calls.push('relinquish'); },
      announcePresence: (): void => { calls.push('announce'); },
      broadcastCid: (): void => { calls.push('cid'); },
    },
  };
}

function pageEvent(type: 'pagehide' | 'pageshow', persisted: boolean): Event {
  const event: Event = new Event(type);
  Object.defineProperty(event, 'persisted', { value: persisted });
  return event;
}

let page: EventTarget;
let r: Recorder;
const releases: bigint[] = [];
eventEmitter.on('session:release-request', ({ cid }: { cid: bigint }) => { releases.push(cid); });

beforeEach(() => {
  page = new EventTarget();
  r = recorder();
  releases.length = 0;
  setupPageDepartureHandlers(r.channel, page as unknown as PageEvents);
  instanceManager.setCid(77n);
  instanceManager.setLeader(false, 'someone-else');
});

describe('a page going away for good', () => {
  it('releases the last tab session through the leader, then says goodbye', () => {
    page.dispatchEvent(pageEvent('pagehide', false));
    expect(r.calls).toEqual(['send:session-release', 'goodbye']);
  });

  it('releases directly when this tab leads', () => {
    instanceManager.setLeader(true, instanceManager.instanceId);
    page.dispatchEvent(pageEvent('pagehide', false));
    expect(releases).toEqual([77n]);
    expect(r.calls).toEqual(['goodbye']);
  });

  it('does nothing on beforeunload, which a prompt can still cancel', () => {
    page.dispatchEvent(new Event('beforeunload'));
    expect(r.calls).toEqual([]);
  });
});

describe('a page kept in the back/forward cache', () => {
  it('leaves without releasing its session', () => {
    page.dispatchEvent(pageEvent('pagehide', true));
    expect(r.calls).toEqual(['goodbye']);
  });

  it('gives up leadership rather than holding it while frozen', () => {
    instanceManager.setLeader(true, instanceManager.instanceId);
    page.dispatchEvent(pageEvent('pagehide', true));
    expect(r.calls).toEqual(['relinquish']);
    expect(releases).toEqual([]);
  });

  it('announces itself and its session again when restored', () => {
    page.dispatchEvent(pageEvent('pageshow', true));
    expect(r.calls).toEqual(['announce', 'cid']);
  });

  it('an ordinary first load announces nothing extra', () => {
    page.dispatchEvent(pageEvent('pageshow', false));
    expect(r.calls).toEqual([]);
  });
});
