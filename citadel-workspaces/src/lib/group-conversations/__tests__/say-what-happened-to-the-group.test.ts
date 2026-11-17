/**
 * A group that ended while you were in it should not be reported as "may have
 * been deleted".
 *
 * `getGroup` returning nothing covers two situations: a stale link to a group
 * this session never knew about, and a group that ended a moment ago while the
 * page was open — deleted by its owner, or you were removed from it. The second
 * announced itself; the client acted on the event. Hedging about it is the same
 * evasion as telling someone their file picker result "may have expired" when
 * nothing expires (round 178).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { eventEmitter } from '@/lib/event-emitter';
import { bindEndedGroups, forgetEndedGroups, wasEnded } from '../ended-groups';
import { groupGoneMessage } from '../group-gone-message';

bindEndedGroups();

describe('a group that is not in the list', () => {
  beforeEach(() => forgetEndedGroups());

  it('is reported as ended when this session watched it end', () => {
    eventEmitter.emit('group:deleted', { groupId: '1:7' });
    expect(wasEnded('1:7')).toBe(true);
    expect(groupGoneMessage('1:7')?.title).toBe('Group ended');
  });

  it('is reported as not found when this session never saw it', () => {
    // The positive control for the test above: same call, opposite outcome, so
    // "ended" is a decision rather than the only branch anyone reaches.
    expect(groupGoneMessage('1:9')?.title).toBe('Group not found');
  });

  it('does not confuse one group with another', () => {
    eventEmitter.emit('group:deleted', { groupId: '1:7' });
    expect(groupGoneMessage('1:9')?.title).toBe('Group not found');
  });

  it('says removal is possible, because the wire cannot tell them apart', () => {
    // Deletion and being kicked both arrive as GroupDisconnectNotification and
    // the mapping collapses them. Claiming "deleted" outright would be a guess.
    eventEmitter.emit('group:deleted', { groupId: '1:7' });
    expect(groupGoneMessage('1:7')?.description).toMatch(/removed from it/);
  });

  it('stays quiet when the member was removed by someone else, which the removal notice already said', () => {
    // Measured live: a kicked member with the group open got "Group ended" AND
    // "You're no longer in Kick Probe 4" for one kick.
    eventEmitter.emit('group:deleted', { groupId: '1:8', byOthers: true });
    expect(groupGoneMessage('1:8')).toBeNull();
  });
});

