/**
 * The member's Calendar notification settings decide what the Calendar raises: read again before
 * each notice from their own storage, so a change made in another window holds at once. A kind
 * turned off, or the Calendar turned off, raises nothing; and whether a notice may reach the system
 * is told to the page before each one. Settings that cannot be read are said, and the ones before
 * a choice apply.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodePrefs, encodePrefs, NOTIFY_PREFS_KEY, PREFS_BEFORE_CHOICE, type NotifyPrefs } from '../notify-prefs';
import { encodeCbor } from '@/lib/citadel-apps/host/cbor';
import { noticeMember, type NoticeMember } from './notice-rig';

const USER = { kind: 'user' } as const;
const quiet: NotifyPrefs = { enabled: true, kinds: { reminders: true, invitations: true, bookings: false, polls: true }, leadMinutes: [30, 10], delivery: 'in_app' };
const choose = (m: NoticeMember, prefs: NotifyPrefs): Promise<void> => m.ports.storage.set(USER, NOTIFY_PREFS_KEY, encodePrefs(prefs));

afterEach(() => { vi.restoreAllMocks(); });

describe('the notification settings', () => {
  it('are kept as they were chosen, lead times in order', () => {
    expect(decodePrefs(encodePrefs(quiet))).toEqual({ ...quiet, leadMinutes: [10, 30] });
    expect(decodePrefs(encodePrefs(PREFS_BEFORE_CHOICE))).toEqual(PREFS_BEFORE_CHOICE);
  });

  it('refuse bytes that are not version-1 settings', () => {
    const base: { v: number; enabled: boolean; kinds: string[]; lead: number[]; delivery: string; } = { v: 1, enabled: true, kinds: ['reminders'], lead: [10], delivery: 'system' };
    expect(decodePrefs(encodeCbor(base))).not.toBeNull();
    expect(decodePrefs(encodeCbor({ ...base, v: 2 }))).toBeNull();
    expect(decodePrefs(encodeCbor({ ...base, kinds: ['everything'] }))).toBeNull();
    expect(decodePrefs(encodeCbor({ ...base, lead: [-5] }))).toBeNull();
    expect(decodePrefs(encodeCbor({ ...base, delivery: 'email' }))).toBeNull();
  });

  it('raise every kind, also to the system, before the member chooses', async () => {
    const m: NoticeMember = noticeMember('ana', new Map(), 0);
    await m.ports.notify('bookings', 'New booking', 'Intro with bo');
    expect(m.notes).toEqual(['New booking: Intro with bo']);
    expect(m.system).toEqual([true]);
  });

  it('raise nothing of a kind turned off, and keep the rest to the page', async () => {
    const m: NoticeMember = noticeMember('ana', new Map(), 0);
    await choose(m, quiet);
    await m.ports.notify('bookings', 'New booking', 'Intro with bo');
    await m.ports.notify('reminders', 'Standup', 'Starts at 9:00');
    expect(m.notes).toEqual(['Standup: Starts at 9:00']);
    expect(m.system).toEqual([false]);
  });

  it('raise nothing at all with the Calendar turned off, and hold a change at once', async () => {
    const m: NoticeMember = noticeMember('ana', new Map(), 0);
    await choose(m, { ...quiet, enabled: false });
    await m.ports.notify('reminders', 'Standup', 'Starts at 9:00');
    expect(m.notes).toEqual([]);
    await choose(m, { ...quiet, enabled: true });
    await m.ports.notify('reminders', 'Standup', 'Starts at 9:00');
    expect(m.notes).toEqual(['Standup: Starts at 9:00']);
  });

  it('say so when they cannot be read, and raise as before a choice', async () => {
    const said = vi.spyOn(console, 'error').mockImplementation(() => {});
    const m: NoticeMember = noticeMember('ana', new Map(), 0);
    await m.ports.storage.set(USER, NOTIFY_PREFS_KEY, new Uint8Array([0xff]));
    await m.ports.notify('polls', 'New poll: Retro', 'bo asks');
    expect(m.notes).toEqual(['New poll: Retro: bo asks']);
    expect(said).toHaveBeenCalledWith(expect.stringContaining('could not be read'));
  });

  it('cannot widen the grant: without `notifications` nothing reaches the page', async () => {
    const m: NoticeMember = noticeMember('ana', new Map(), 0, ['storage.user']);
    await expect(m.ports.notify('reminders', 'Standup', 'Starts at 9:00')).rejects.toMatchObject({ op: 'Notify', refused: 'ungranted' });
    expect(m.notes).toEqual([]);
  });
});
