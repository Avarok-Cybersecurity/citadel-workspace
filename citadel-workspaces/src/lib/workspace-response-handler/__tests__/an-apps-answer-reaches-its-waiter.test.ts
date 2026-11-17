/**
 * The kernel's Apps answer, which the generated response type does not name yet, is handled and
 * passed on whole as the raw response the apps client waits on. Control: an unknown variant is
 * still left unhandled. Real handler and event emitter; nothing doubled.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { WorkspaceProtocolResponse } from 'citadel-workspace-client-ts';
import { eventEmitter } from '@/lib/event-emitter';
import { handleWorkspaceVariants } from '../workspace-handlers';

const heard: unknown[] = [];
const listen = (r: unknown): void => { heard.push(r); };
const followed: unknown[] = [];
const follow = (e: unknown): void => { followed.push(e); };
afterEach((): void => {
  eventEmitter.off('workspace:raw-response', listen);
  eventEmitter.off('workspace:apps', follow);
  heard.length = 0;
  followed.length = 0;
});

describe('an Apps answer', () => {
  it('is handled and emitted unchanged, and its answer passed on', () => {
    eventEmitter.on('workspace:raw-response', listen);
    eventEmitter.on('workspace:apps', follow);
    const answer: WorkspaceProtocolResponse = { Apps: { Refused: 'Unavailable' } } as unknown as WorkspaceProtocolResponse;
    expect(handleWorkspaceVariants(answer, { cid: 0, request_id: 'r' })).toBe(true);
    expect(heard).toEqual([answer]);
    expect(followed).toEqual([{ answer: { Refused: 'Unavailable' } }]);
  });

  it('control: a variant nobody knows is not handled', () => {
    eventEmitter.on('workspace:raw-response', listen);
    expect(handleWorkspaceVariants({ NoSuchVariant: {} } as unknown as WorkspaceProtocolResponse, { cid: 0, request_id: 'r' })).toBe(false);
    expect(heard).toEqual([]);
  });
});
