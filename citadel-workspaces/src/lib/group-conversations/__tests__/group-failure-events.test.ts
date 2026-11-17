/**
 * The server refusing a group operation must reach the user.
 *
 * `GroupCreateFailure` and its seven siblings carry a message and a request id,
 * and `toGroupEvents` mapped no failure variant of any group operation. That is
 * invisible rather than merely quiet, because the create dialog resolves on
 * DISPATCH and closes: a refused create looked exactly like a successful one
 * that had not arrived yet — the form cleared, the dialog shut, the sidebar
 * never gained the group, and nothing was said.
 */

import { describe, it, expect } from 'vitest';
import { toGroupEvents } from '../group-events';
import { GROUP_FAILURE_VARIANTS } from '../group-failure-variants';

const noName = (): string => 'peer';

describe('a refused group operation', () => {
  it('becomes an event carrying the server\'s reason', () => {
    const [event] = toGroupEvents(
      { GroupCreateFailure: { cid: 1n, message: 'not permitted', request_id: 'r-1' } },
      1n,
      'me',
      noName,
    );

    expect(event.name).toBe('group:failed');
    expect(event.payload.message).toBe('not permitted');
    expect(event.payload.operation).toBe('Create');
  });

  it('covers every failure variant the group plane can produce', () => {
    // Driven by the arm's own list, not a copy of it.
    //
    // This test used to hardcode the same eight names the arm did — including
    // `GroupJoinFailure` and `GroupDisconnectFailure`, which exist in no
    // generated type. So it asserted coverage of two events that can never
    // arrive, and stayed green while five real failures went unhandled. A test
    // that keeps its own copy of the thing under test confirms the copy.
    //
    // `every-group-failure-is-handled.test.ts` pins that list against the
    // generated types, in both directions. This one pins that everything on it
    // actually reaches the user.
    for (const variant of GROUP_FAILURE_VARIANTS) {
      const [event] = toGroupEvents(
        { [variant]: { cid: 1n, message: 'refused', request_id: 'r' } },
        1n,
        'me',
        noName,
      );
      expect(event?.name, variant).toBe('group:failed');
    }
  });

  it('still produces an event when the server gave no message', () => {
    // The caller supplies the fallback sentence; dropping the event because the
    // message is empty would restore the silence.
    const [event] = toGroupEvents({ GroupCreateFailure: { cid: 1n } }, 1n, 'me', noName);

    expect(event.name).toBe('group:failed');
    expect(event.payload.message).toBe('');
  });

  it('does not mistake a success for a failure', () => {
    const [event] = toGroupEvents(
      { GroupCreateSuccess: { cid: 1n, group_key: { cid: 1n, mgid: 2n } } },
      1n,
      'me',
      noName,
    );

    expect(event.name).toBe('group:created');
  });
});
