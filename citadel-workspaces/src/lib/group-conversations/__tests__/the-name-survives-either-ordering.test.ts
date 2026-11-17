/**
 * The creator's name lands whichever way the race goes.
 *
 * `createGroup` awaits `sendGroupCreate`, then records the name and nudges the
 * store. But `group:created` is emitted from `GroupCreateSuccess` -- the same
 * response that resolves the promise -- so whether the store has already built
 * the record is a race, and round 425 covered both sides without either being
 * tested:
 *
 *   store first  -> `rememberGroupName` is too late for the record, and the
 *                   `updateGroups` pass is what renames it.
 *   store second -> `updateGroups` finds nothing to rename, and
 *                   `chosenGroupName` is what the handler reads.
 *
 * One of those is dead in any single run, so a test that exercises one ordering
 * proves half the fix.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { noSessionUsername } from '@/test-utils/no-session-username';
import { eventEmitter } from '@/lib/event-emitter';
import { startGroupEventBindings, getGroups, updateGroups } from '../group-store';
import { rememberGroupName, forgetChosenNames } from '../group-names';
import type { GroupConversation } from '@/types/group-entities';

const ID: string = '7:500';

function created(): void {
  eventEmitter.emit('group:created', {
    groupId: ID,
    name: '',
    ownerId: '7',
    ownerUsername: 'ada',
  });
}

/** What `createGroup` does once the id comes back. */
function creatorNames(name: string): void {
  rememberGroupName(ID, name);
  updateGroups(prev =>
    prev.map(g => (g.id === ID && name.trim().length > 0 ? { ...g, name: name.trim() } : g)),
  );
}

function nameOf(): string | undefined {
  return getGroups().find((g: GroupConversation): boolean => g.id === ID)?.name;
}

describe('naming a group the creator just made', () => {
  beforeEach(() => {
    forgetChosenNames();
    updateGroups(() => []);
    startGroupEventBindings(noSessionUsername);
  });

  it('holds when the store builds the record first', () => {
    created();
    expect(nameOf(), 'the record exists with the fallback').toBe('ada');
    creatorNames('Design review');
    expect(nameOf()).toBe('Design review');
  });

  it('holds when the creator names it first', () => {
    creatorNames('Design review');
    created();
    expect(nameOf()).toBe('Design review');
  });

  it('leaves an invited member with the owner, not a blank', () => {
    // Positive control: nothing was chosen here, so the fallback must stand.
    created();
    expect(nameOf()).toBe('ada');
  });
});
