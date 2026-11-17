/**
 * A group is called what its creator called it.
 *
 * `GroupCreate` carries no name field, so `createGroup(name, members)` sent
 * only the members and `group:created` set `name: ''` -- the creator's own
 * username stood in. The dialog asks for a name, the user types one, and the
 * sidebar showed something else.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { noSessionUsername } from '@/test-utils/no-session-username';
import { eventEmitter } from '@/lib/event-emitter';
import {
  startGroupEventBindings,
  getGroups,
  updateGroups,
} from '../group-store';
import { rememberGroupName, forgetChosenNames } from '../group-names';
import type { GroupConversation } from '@/types/group-entities';

function emitCreated(id: string): void {
  eventEmitter.emit('group:created', {
    groupId: id,
    name: '',
    ownerId: '7',
    ownerUsername: 'alice',
  });
}

describe('a group created here', () => {
  beforeEach(() => {
    forgetChosenNames();
    updateGroups(() => []);
    startGroupEventBindings(noSessionUsername);
  });

  it('is called what the creator typed, not their username', () => {
    rememberGroupName('7:100', 'Design review');
    emitCreated('7:100');

    const group: GroupConversation | undefined = getGroups().find(g => g.id === '7:100');
    expect(group?.name).toBe('Design review');
  });

  it('falls back to the owner when nobody named it here', () => {
    // Positive control: an invited member has no chosen name for this group,
    // and must still get a usable label rather than an empty string.
    emitCreated('7:101');

    const group: GroupConversation | undefined = getGroups().find(g => g.id === '7:101');
    expect(group?.name).toBe('alice');
  });

  it('ignores a blank name rather than storing one', () => {
    rememberGroupName('7:102', '   ');
    emitCreated('7:102');

    expect(getGroups().find(g => g.id === '7:102')?.name).toBe('alice');
  });
});
