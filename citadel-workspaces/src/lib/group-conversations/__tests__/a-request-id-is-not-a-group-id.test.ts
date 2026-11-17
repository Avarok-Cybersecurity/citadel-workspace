/**
 * The group id is the group's, not the request's.
 *
 * `sendGroupCreate` resolves with its own `crypto.randomUUID()` request id.
 * Groups are keyed `<cid>:<mgid>`. Two rounds were built on that uuid before
 * anything noticed -- the name was remembered under it, and the app navigated
 * to `/groups/<request id>` -- and the spec read the url back and reported
 * "Group created successfully". A false success assembled from two halves that
 * each looked right.
 */
import { describe, it, expect, vi } from 'vitest';
import { eventEmitter } from '@/lib/event-emitter';
import { awaitGroupCreated } from '../await-group-created';

const REQUEST: string = 'e2f0a5b6-0000-4000-8000-000000000001';
const GROUP: string = '7:42';

function emitCreated(requestId: string | undefined, groupId: string): void {
  eventEmitter.emit('group:created', {
    groupId,
    name: '',
    ownerId: '7',
    ownerUsername: 'ada',
    requestId,
  });
}

describe('waiting for the group a request made', () => {
  it('resolves with the group id, not the request id', async () => {
    const pending: Promise<string> = awaitGroupCreated(REQUEST, 1_000);
    emitCreated(REQUEST, GROUP);
    await expect(pending).resolves.toBe(GROUP);
  });

  it('ignores a group created by somebody else at the same moment', async () => {
    // An invite arriving now emits `group:created` too. Taking "the next one"
    // would navigate the creator into a group they did not make.
    const pending: Promise<string> = awaitGroupCreated(REQUEST, 1_000);
    emitCreated(undefined, '9:99');
    emitCreated('a-different-request', '9:100');
    emitCreated(REQUEST, GROUP);
    await expect(pending).resolves.toBe(GROUP);
  });

  it('fails rather than hanging when the answer never comes', async () => {
    vi.useFakeTimers();
    const pending: Promise<string> = awaitGroupCreated(REQUEST, 1_000);
    const assertion: Promise<void> = expect(pending).rejects.toThrow(/not created in time/);
    await vi.advanceTimersByTimeAsync(1_100);
    await assertion;
    vi.useRealTimers();
  });
});
