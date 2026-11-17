/**
 * An update that changes nothing must return the array it was given.
 *
 * The store's only no-op guard is identity — `if (next === groups) return` —
 * and `Array.prototype.map` always allocates. So a writer that maps
 * unconditionally notifies every subscriber and writes to IndexedDB even when
 * the value is already what it is being set to.
 *
 * `mark-group-read.ts` records what that costs: the group page calls
 * `markAsRead` from an effect whose deps include `getGroup`, whose identity is
 * derived from `groups`. New array, new getGroup, effect re-runs, call again —
 * "opening any group chat was a perpetual render-and-write loop that ended
 * either in a hot tab or in React's Maximum update depth exceeded".
 *
 * `applyGroupRename` and `applyGroupSettings` were added in rounds 479 and 480
 * mapping unconditionally. Neither is called from an effect today, so neither
 * loops — but the rule is the codebase's, it is load-bearing where it is
 * already relied on, and a future caller should not have to rediscover it.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { applyGroupRename } from '../rename-group';
import { applyGroupSettings } from '../apply-group-settings';
import { forgetGroupNames } from '../group-names';
import { getGroups, updateGroups, subscribeToGroups } from '../group-store';
import type { GroupSettings } from '@/types/group';

const GROUP: string = '7:42';
const settings: GroupSettings = { roles: [], defaultRoleId: 'r1' } as unknown as GroupSettings;

function seed(): void {
  forgetGroupNames();
  updateGroups(() => ([
    { id: GROUP, name: 'stable', members: [], unreadCount: 0, settings },
  ] as never));
}

function countNotifications(run: () => void): number {
  let notified: number = 0;
  const stop: () => void = subscribeToGroups((): void => { notified += 1; });
  run();
  stop();
  return notified;
}

describe('an update that changes nothing', () => {
  beforeEach((): void => { seed(); });

  it('does not notify subscribers when the name is already that', () => {
    expect(countNotifications(() => applyGroupRename(GROUP, 'stable'))).toBe(0);
  });

  it('does not notify subscribers when the settings are the same object', () => {
    expect(countNotifications(() => applyGroupSettings(GROUP, settings))).toBe(0);
  });

  it('still notifies for a real change', () => {
    // Negative control: a guard that never lets anything through would pass
    // both assertions above.
    expect(countNotifications(() => applyGroupRename(GROUP, 'renamed'))).toBeGreaterThan(0);
    expect(getGroups()[0].name).toBe('renamed');
  });

  it('still notifies for genuinely different settings', () => {
    const different: GroupSettings = { ...settings, defaultRoleId: 'r2' } as GroupSettings;
    expect(countNotifications(() => applyGroupSettings(GROUP, different))).toBeGreaterThan(0);
  });
});
