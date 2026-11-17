/**
 * Dropping the permissions cache on a session change is announced.
 *
 * Measured live, switching workspace org in one tab: the service cleared its cache on
 * `instance:cid-changed` and told nobody. The React context kept its own copy of the
 * map, so `usePermission` saw the domain as known and never asked again -- no
 * GetUserPermissions left the tab at all -- while the emptied cache reported "no answer",
 * which permits: a Member was offered the hierarchy's "+".
 */
import { describe, it, expect } from 'vitest';
import { eventEmitter } from '@/lib/event-emitter';
import { permissionsService } from '../index';

describe('a session change', () => {
  it('clears the permissions cache and says so, after it is empty', () => {
    const seen: boolean[] = [];
    const off: () => void = eventEmitter.on('permissions:cleared', (): void => {
      seen.push(!permissionsService.hasAnswerFor('workspace-root'));
    });
    eventEmitter.emit('instance:cid-changed', { instanceId: 'tab', cid: 2n });
    if (typeof off === 'function') off();
    expect(seen).toEqual([true]);
  });
});
