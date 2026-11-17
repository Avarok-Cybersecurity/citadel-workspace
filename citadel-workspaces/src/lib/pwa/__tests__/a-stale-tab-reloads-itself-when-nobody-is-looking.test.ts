/**
 * A tab running a superseded build shows the reload banner, and reloads by itself once it has
 * been hidden for a minute -- but never in the middle of a call, an upload or an unsaved edit.
 *
 * A background tab is the one nobody reloads: it is how an old build stayed open across
 * deploys. Nothing is mocked: the policy takes its I/O as arguments, the holds are the real
 * reload-safety registry, and the clock is the test's.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { startStaleAutoReload, type StaleAutoReloadIO } from '../stale-auto-reload';
import { holdReload, onReloadSafe, reloadIsSafe } from '../reload-safety';
import { clearDeployNoticeForTests, getDeployNotice, offerDeployNotice } from '../deploy-notice';
import { registerUnsavedEdits } from '@/lib/unsaved-edits';

const HIDDEN_FOR_MS: number = 60_000;

interface Page {
  hidden: boolean;
  stale: boolean;
  now: number;
  reloads: number;
  setHidden: (hidden: boolean) => void;
  setStale: () => void;
  advance: (ms: number) => void;
}

function page(): Page {
  const visibility: Set<() => void> = new Set<() => void>();
  const staleness: Set<() => void> = new Set<() => void>();
  let timers: Array<{ at: number; fn: () => void }> = [];
  const p: Page = {
    hidden: false, stale: false, now: 0, reloads: 0,
    setHidden: (hidden: boolean): void => { p.hidden = hidden; for (const l of [...visibility]) l(); },
    setStale: (): void => { p.stale = true; for (const l of [...staleness]) l(); },
    advance: (ms: number): void => {
      const until: number = p.now + ms;
      for (;;) {
        const due: { at: number; fn: () => void } | undefined = timers.filter((t) => t.at <= until).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        timers = timers.filter((t) => t !== due);
        p.now = due.at;
        due.fn();
      }
      p.now = until;
    },
  };
  const io: StaleAutoReloadIO = {
    hiddenForMs: HIDDEN_FOR_MS,
    now: (): number => p.now,
    isHidden: (): boolean => p.hidden,
    onVisibilityChange: (l: () => void): (() => void) => { visibility.add(l); return (): void => { visibility.delete(l); }; },
    isStale: (): boolean => p.stale,
    onStaleChange: (l: () => void): (() => void) => { staleness.add(l); return (): void => { staleness.delete(l); }; },
    reloadIsSafe,
    onReloadSafe,
    schedule: (fn: () => void, ms: number): (() => void) => {
      const timer: { at: number; fn: () => void } = { at: p.now + ms, fn };
      timers.push(timer);
      return (): void => { timers = timers.filter((t) => t !== timer); };
    },
    reload: (): void => { p.reloads += 1; },
  };
  startStaleAutoReload(io);
  return p;
}

describe('a stale tab', () => {
  it('reloads once it has been hidden for the whole minute', () => {
    const p: Page = page();
    p.setStale();
    p.setHidden(true);
    p.advance(HIDDEN_FOR_MS - 1);
    expect(p.reloads).toBe(0);
    p.advance(1);
    expect(p.reloads).toBe(1);
    p.advance(10 * HIDDEN_FOR_MS);
    expect(p.reloads).toBe(1);
  });

  it('never reloads while it is visible, and starts the minute again when hidden again', () => {
    const p: Page = page();
    p.setStale();
    p.advance(10 * HIDDEN_FOR_MS);
    p.setHidden(true);
    p.advance(HIDDEN_FOR_MS / 2);
    p.setHidden(false);
    p.advance(HIDDEN_FOR_MS);
    p.setHidden(true);
    p.advance(HIDDEN_FOR_MS / 2);
    expect(p.reloads).toBe(0);
  });

  it('reloads at once on becoming stale after a minute already hidden', () => {
    const p: Page = page();
    p.setHidden(true);
    p.advance(2 * HIDDEN_FOR_MS);
    expect(p.reloads).toBe(0);
    p.setStale();
    expect(p.reloads).toBe(1);
  });

  it('waits for a call, an upload and an unsaved edit to end, then reloads', () => {
    const p: Page = page();
    const endCall: () => void = holdReload('call');
    const endUpload: () => void = holdReload('upload');
    const saved: () => void = registerUnsavedEdits('editor-1');
    p.setStale();
    p.setHidden(true);
    p.advance(3 * HIDDEN_FOR_MS);
    endCall();
    endUpload();
    expect(p.reloads).toBe(0);
    saved();
    expect(p.reloads).toBe(1);
  });

  it('is not reloaded at all when it is not stale', () => {
    const p: Page = page();
    p.setHidden(true);
    p.advance(10 * HIDDEN_FOR_MS);
    expect(p.reloads).toBe(0);
  });
});

describe('the stale banner', () => {
  beforeEach((): void => clearDeployNoticeForTests());

  it('goes up as soon as the channel hears a newer build, in this page', async () => {
    const { watchTabStaleness } = await import('../watch-tab-staleness');
    const { noteNewerTab } = await import('@/lib/multi-instance/tab-staleness');
    const stop: () => void = watchTabStaleness();
    expect(getDeployNotice()).toBeNull();

    noteNewerTab('1760000000000000009');

    expect(getDeployNotice()?.reason).toBe('stale');
    stop();
  });

  it('is shown when nothing else is, and never replaces a notice that names the new build', () => {
    const reload: () => void = (): void => undefined;
    offerDeployNotice({ reason: 'stale', accept: reload });
    expect(getDeployNotice()?.reason).toBe('stale');

    offerDeployNotice({ reason: 'waiting', accept: reload });
    offerDeployNotice({ reason: 'stale', accept: reload });
    expect(getDeployNotice()?.reason).toBe('waiting');
  });
});
