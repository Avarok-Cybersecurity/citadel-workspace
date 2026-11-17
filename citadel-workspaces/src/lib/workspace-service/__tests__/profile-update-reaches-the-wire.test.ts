/**
 * `updateUserProfile` must put email and title on the wire under the names
 * the Rust enum reads (`email`, `title`), or serde reads them as absent and the
 * save is a silent no-op that still reports success.
 *
 * The sender is a stand-in for the socket (the only I/O here); the response is
 * delivered on the real event bus the real gate listens to.
 */
import { describe, it, expect } from 'vitest';
import { updateUserProfile } from '../messaging-operations';
import { eventEmitter } from '@/lib/event-emitter';
import type { WorkspaceProtocolRequestTS } from '@/types/workspace-protocol';

describe('the profile update request', () => {
  it('carries every field under its Rust name', async () => {
    const sent: WorkspaceProtocolRequestTS[] = [];
    const done: Promise<void> = updateUserProfile(
      {
        currentCid: 1n,
        sendProtocolRequest: async (request: WorkspaceProtocolRequestTS): Promise<void> => {
          sent.push(request);
          eventEmitter.emit('workspace:raw-response', { UserProfileUpdated: { id: 'u' } });
        },
      },
      { name: 'Ada', avatarData: 'UklGR', email: 'ada@example.com', title: '' },
    );
    await done;
    expect(sent).toEqual([
      { UpdateUserProfile: { name: 'Ada', avatar_data: 'UklGR', email: 'ada@example.com', title: '' } },
    ]);
  });
});
