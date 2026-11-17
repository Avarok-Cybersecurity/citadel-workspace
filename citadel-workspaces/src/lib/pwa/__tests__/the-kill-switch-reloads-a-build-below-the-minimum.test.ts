/**
 * `/version.json` can name a minimum build (`minSeq`). A page running an older one reloads at
 * once, whether or not anyone is looking, and keeps what the user was typing; a page at or
 * above it is left alone.
 *
 * For a defect that must not keep running in tabs left open across the deploy that fixes it.
 * Nothing is mocked: the watch and the kill switch take their I/O as arguments, the drafts
 * are the real draft store, and the storage is jsdom's sessionStorage.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { startVersionWatch, type VersionWatchIO } from '../version-watch';
import { KILL_SWITCH_KEY, runKillSwitch, type KillSwitchIO } from '../kill-switch';
import { checkedMinSeq, manifestForBuild } from '../version-manifest';
import { MIN_BUILD_SEQ } from '../min-build-seq';
import { DRAFT_HANDOFF_KEY, takeStashedDrafts } from '@/lib/chat/draft-handoff';
import { clearAllDraftsForTests, saveDraft } from '@/lib/chat/draft-store';

const RUNNING_SEQ: number = 1_700_000_000;
const ENTRY: string = '/assets/index-aaaa1111.js';

const settle: () => Promise<void> = async (): Promise<void> => { for (let i: number = 0; i < 5; i += 1) await Promise.resolve(); };

function watchServing(manifest: unknown): { kills: () => number } {
  let kills: number = 0;
  const io: VersionWatchIO = {
    runningEntry: `https://bench.work.avarok.net${ENTRY}`,
    runningSeq: RUNNING_SEQ,
    origin: 'https://bench.work.avarok.net',
    intervalMs: 600_000,
    fetchManifest: async (): Promise<unknown> => manifest,
    isOnline: (): boolean => true,
    onWake: (): (() => void) => (): void => undefined,
    setInterval: (): unknown => 1,
    clearInterval: (): void => undefined,
    onNewDeploy: (): void => undefined,
    onKillSwitch: (): void => { kills += 1; },
  };
  startVersionWatch(io);
  return { kills: (): number => kills };
}

interface Recorded { io: KillSwitchIO; order: string[] }

function killSwitch(storage: Storage | null): Recorded {
  const order: string[] = [];
  return {
    order,
    io: {
      runningSeq: RUNNING_SEQ,
      storage,
      checkWorker: async (): Promise<void> => { order.push('check-worker'); },
      applyWaitingUpdate: async (): Promise<boolean> => { order.push('apply-waiting'); return true; },
      reload: (): void => { order.push(`reload (drafts stashed: ${storage?.getItem(DRAFT_HANDOFF_KEY) !== null})`); },
      offerReload: (): void => { order.push('offer'); },
    },
  };
}

describe('the version watch', () => {
  it('pulls the kill switch for a minimum above the running build', async () => {
    const watch: { kills: () => number } = watchServing({ entry: ENTRY, seq: RUNNING_SEQ + 50, minSeq: RUNNING_SEQ + 1 });
    await settle();
    expect(watch.kills()).toBe(1);
  });

  it('does nothing for a minimum at or below it, or none', async () => {
    for (const manifest of [
      { entry: ENTRY, seq: RUNNING_SEQ, minSeq: RUNNING_SEQ },
      { entry: ENTRY, seq: RUNNING_SEQ + 50, minSeq: RUNNING_SEQ - 1 },
      { entry: ENTRY, seq: RUNNING_SEQ + 50 },
      { entry: ENTRY },
    ]) {
      const watch: { kills: () => number } = watchServing(manifest);
      await settle();
      expect(watch.kills(), JSON.stringify(manifest)).toBe(0);
    }
  });
});

describe('the kill switch', () => {
  beforeEach((): void => {
    clearAllDraftsForTests();
    window.sessionStorage.clear();
  });

  it('reloads into the new build with the drafts stashed', async () => {
    saveDraft('peer:alice', 'half a thought');
    const k: Recorded = killSwitch(window.sessionStorage);

    await runKillSwitch(k.io);

    expect(k.order).toEqual(['check-worker', 'apply-waiting', 'reload (drafts stashed: true)']);
    expect(takeStashedDrafts(window.sessionStorage)).toEqual([['peer:alice', 'half a thought']]);
  });

  it('does not reload a second time for the same build: it asks instead', async () => {
    await runKillSwitch(killSwitch(window.sessionStorage).io);
    const again: Recorded = killSwitch(window.sessionStorage);

    await runKillSwitch(again.io);

    expect(again.order).toEqual(['offer']);
    expect(window.sessionStorage.getItem(KILL_SWITCH_KEY)).toBe(String(RUNNING_SEQ));
  });

  it('asks instead when there is no storage to remember the reload in', async () => {
    const k: Recorded = killSwitch(null);
    await runKillSwitch(k.io);
    expect(k.order).toEqual(['offer']);
  });

  it('still reloads when the worker cannot be updated first', async () => {
    const k: Recorded = killSwitch(window.sessionStorage);
    k.io.checkWorker = async (): Promise<void> => { throw new Error('no registration'); };
    const reload: ReturnType<typeof vi.fn> = vi.fn();
    k.io.reload = reload;

    await runKillSwitch(k.io);

    expect(reload).toHaveBeenCalledOnce();
  });
});

describe('the minimum a build is deployed with', () => {
  it('is refused when it is not seconds or is above the build itself', () => {
    expect(checkedMinSeq(RUNNING_SEQ - 10, RUNNING_SEQ)).toBe(RUNNING_SEQ - 10);
    expect(() => checkedMinSeq(1.5, RUNNING_SEQ)).toThrow(/unix seconds/);
    expect(() => checkedMinSeq(RUNNING_SEQ + 1, RUNNING_SEQ)).toThrow(/above this build/);
  });

  it('this release ships one: a build made now carries it, so every older page reloads', () => {
    const now: number = Math.floor(Date.now() / 1000);
    expect(MIN_BUILD_SEQ).toBeGreaterThanOrEqual(1_794_768_948);
    const manifest: { minSeq?: number; seq: number } = JSON.parse(manifestForBuild(
      { 'index.js': { type: 'chunk', isEntry: true, facadeModuleId: '/src/index.html', fileName: 'assets/index-x.js' } } as never,
      '/', { seq: now, minSeq: checkedMinSeq(MIN_BUILD_SEQ, now) },
    )) as { minSeq?: number; seq: number };
    expect(manifest.minSeq).toBe(MIN_BUILD_SEQ);
  });
});
