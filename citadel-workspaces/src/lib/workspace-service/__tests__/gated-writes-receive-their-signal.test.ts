/**
 * Every variant a write WAITS for must actually be emitted as a raw response.
 *
 * `awaitWriteResponse` resolves on `workspace:raw-response`. The response router
 * emits that from the `Success` and `Error` branches and from its unhandled
 * fallback — but a variant with its OWN handler returns `true` and the response
 * ends there.
 *
 * So four writes gated on handled variants — UpdateMemberRole, UpdateWorkspaceTheme,
 * EditGroupMessage, DeleteGroupMessage — waited out the full 15s timeout and told
 * the user "the change may not have been saved", after the same handler had
 * already applied it. The action worked and the app said it had not: a regression
 * introduced by wiring the gate without checking the signal existed.
 *
 * Drives the REAL router, so it fails if either half drifts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { eventEmitter } from '@/lib/event-emitter';
import { workspaceResponseHandler } from '@/lib/workspace-response-handler';

vi.mock('@/lib/group-messaging-manager', () => ({
  groupMessagingManager: {
    handleMessageEdited: (): void => {},
    handleMessageDeleted: (): void => {},
    handleMessagesLoaded: (): void => {},
  },
}));

/** A minimal payload for each variant a write is gated on. */
const RESPONSES: Record<string, unknown> = {
  Success: { Success: 'ok' },
  Workspace: { Workspace: { id: 'workspace-root', name: 'W', description: '', metadata: [] } },
  MemberRoleUpdated: { MemberRoleUpdated: { user_id: 'u1', new_role: 'Admin' } },
  GroupMessageEdited: {
    GroupMessageEdited: { group_id: 'g1', message_id: 'm1', new_content: 'x', edited_at: 1 },
  },
  GroupMessageDeleted: { GroupMessageDeleted: { group_id: 'g1', message_id: 'm1' } },
};

/** Feed one response through the real router and report whether it surfaced. */
function reachesWaiter(response: unknown): boolean {
  let seen: boolean = false;
  const handler = (): void => {
    seen = true;
  };
  eventEmitter.on('workspace:raw-response', handler);
  try {
    (
      workspaceResponseHandler as unknown as {
        processWorkspaceResponse: (r: unknown) => void;
      }
    ).processWorkspaceResponse(response);
  } finally {
    eventEmitter.off('workspace:raw-response', handler);
  }
  return seen;
}

describe('a response a write is waiting for', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(Object.keys(RESPONSES))('%s reaches the waiter', (variant) => {
    expect(
      reachesWaiter(RESPONSES[variant]),
      `${variant} is in SUCCESS_RESPONSES but never emits workspace:raw-response, ` +
        'so every write gated on it times out'
    ).toBe(true);
  });
});
