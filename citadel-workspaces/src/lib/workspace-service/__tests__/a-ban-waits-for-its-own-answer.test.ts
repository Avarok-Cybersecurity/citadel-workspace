/**
 * Ban and Unban are sent as their own requests and resolve on the server's answer about THAT
 * member: both answers are broadcast to the workspace, so another member's ban must not settle
 * this one. Real awaitWriteResponse; only the socket is a stand-in.
 */
import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceProtocolRequest } from 'citadel-workspace-client-ts';
import { eventEmitter } from '@/lib/event-emitter';
import { setBanned } from '../member-operations';

interface RecordingSender { sent: WorkspaceProtocolRequest[]; sendProtocolRequest: (r: WorkspaceProtocolRequest) => Promise<void> }

function sender(): RecordingSender {
  const sent: WorkspaceProtocolRequest[] = [];
  return { sent, sendProtocolRequest: vi.fn(async (r: WorkspaceProtocolRequest): Promise<void> => { sent.push(r); }) };
}

async function settles(write: Promise<unknown>): Promise<boolean> {
  let done: boolean = false;
  void write.then((): void => { done = true; });
  await new Promise((resolve): void => { setTimeout(resolve, 0); });
  return done;
}

describe('setBanned', () => {
  it('sends Ban and resolves on MemberBanned for that member only', async () => {
    const s: RecordingSender = sender();
    const write: Promise<unknown> = setBanned(s as never, 'mal', true);
    await Promise.resolve();
    expect(s.sent).toEqual([{ Ban: { user_id: 'mal' } }]);
    eventEmitter.emit('workspace:raw-response', { MemberBanned: { user_id: 'someone-else' } });
    expect(await settles(write)).toBe(false);
    eventEmitter.emit('workspace:raw-response', { MemberBanned: { user_id: 'mal' } });
    expect(await settles(write)).toBe(true);
  });

  it('sends Unban, and rejects with the server words when refused', async () => {
    const s: RecordingSender = sender();
    const write: Promise<unknown> = setBanned(s as never, 'mal', false);
    await Promise.resolve();
    expect(s.sent).toEqual([{ Unban: { user_id: 'mal' } }]);
    eventEmitter.emit('workspace:raw-response', { Error: 'Failed to unban member: mal is not banned' });
    await expect(write).rejects.toThrow('not banned');
  });
});
