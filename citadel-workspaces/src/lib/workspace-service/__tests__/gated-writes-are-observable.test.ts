/**
 * THE regression this file exists to prevent, in the exact shape it shipped:
 *
 * `awaitWriteResponse` settles on a `workspace:raw-response` event. Most of the
 * router's variant handlers apply the response and `return true` — the response
 * ends there and no raw event is emitted. Gating a write on such a variant makes
 * every success wait out the full 15s timeout and then tell the user "the change
 * may not have been saved", AFTER the same handler already applied it. Worse
 * than the bug it was meant to fix: role changes, theme saves, message edits and
 * deletes all did this.
 *
 * I verified the SERVER sends the variant and never checked that the CLIENT
 * router forwards it. So this drives the real router with a response of every
 * gated variant and asserts the raw event arrives — mechanically, for every
 * entry in the table, including ones added later.
 */
import { describe, it, expect, beforeEach, vi  } from 'vitest';
import { eventEmitter } from '@/lib/event-emitter';
import { SUCCESS_RESPONSES } from '../await-write-response';
import { WorkspaceResponseHandler } from '@/lib/workspace-response-handler/service';
import { groupMessagingManager } from '@/lib/group-messaging-manager';
import { channelSignals } from '@/lib/group-conversations/channel-signals';

/** A minimal payload for each variant; handlers read fields off these. */
const PAYLOADS: Record<string, unknown> = {
  Node: { id: 'n1', name: 'n', entity_type: 'Office' },
  NodeDeleted: { node_id: 'n1', children_deleted: [] },
  NodeMoved: { node_id: 'n1', new_parent_id: 'p1' },
  Success: 'ok',
  MemberRoleUpdated: { user_id: 'u1', role: 'Member' },
  Workspace: { id: 'w1', name: 'w', description: '', metadata: [] },
  CreateWorkspace: { id: 'w1', name: 'w', description: '', metadata: [] },
  UserProfileUpdated: { id: 'u1', name: 'u' },
  GroupMessageNotification: { group_id: 'g1', message: { id: 'm1', sender_id: 'ada', content: 'hi' } },
  GroupMessageEdited: { group_id: 'g1', message_id: 'm1' },
  GroupMessageDeleted: { group_id: 'g1', message_id: 'm1' },
  GroupMessageReacted: { group_id: 'g1', message_id: 'm1', reactions: [] },
  GroupReadCursorMoved: { group_id: 'g1', cursor: { member: 'ada', upto_message_id: 'm1' } },
  SignInSettings: { require_turnstile_sign_in: true },
  Telemetry: { Deleted: { segments: 0 } },
  MessagingTrust: { Settings: { workspace: 'AllTrusted', mine: null, effective_root: 'workspace-root' } },
  Roles: { RoleChanged: { role_id: 'guest', roles: { roles: [], default_role_id: 'member' } } },
  SecureLinks: { Deleted: { id: 'link-1' } },
  Apps: { Uninstalled: { install_id: 'i-1' } },
};

/**
 * Handlers whose effect is a state write rather than a domain event of their own: each is
 * recognised by the write, spied for the one dispatch. Emitting an event nobody hears only to be
 * seen here is refused by check:event-pairs, and rightly.
 */
const STATE_WRITES: Record<string, () => ReturnType<typeof vi.spyOn>> = {
  GroupMessageReacted: () => vi.spyOn(groupMessagingManager, 'handleReactionsReplaced'),
  GroupReadCursorMoved: () => vi.spyOn(channelSignals, 'moveCursor'),
};

/**
 * Dispatch one response through the real router and report every event it
 * emitted.
 *
 * Spying on `emit` rather than subscribing to one name is deliberate. The first
 * version of this test subscribed only to 'workspace:raw-response' and used a
 * wrong wire shape, so every variant fell through to the router's Unhandled
 * branch — which ALSO emits that event. The test passed for every variant, and
 * passed just as happily with the emit deleted: another check that could not
 * fail. The `handled` flag below is what makes it discriminating.
 */
function dispatch(variant: string): { events: string[]; handled: boolean } {
  const spy: ReturnType<typeof vi.spyOn> = vi.spyOn(eventEmitter, 'emit');
  const write: ReturnType<typeof vi.spyOn> | null = STATE_WRITES[variant]?.() ?? null;
  try {
    // The shape extractWorkspaceResponse actually accepts: msg.Response IS the
    // WorkspaceProtocolResponse.
    eventEmitter.emit('websocket-message', { Response: { [variant]: PAYLOADS[variant] } });
    const events: string[] = spy.mock.calls
      .map((c) => String(c[0]))
      .filter((n) => n !== 'websocket-message');
    return {
      events,
      // A real variant handler emits at least one domain event of its own.
      // Only the Unhandled fallback emits raw-response and nothing else.
      handled: events.some((n) => n !== 'workspace:raw-response') || (write !== null && write.mock.calls.length > 0),
    };
  } finally {
    spy.mockRestore();
    write?.mockRestore();
  }
}

describe('every gated write is observable', () => {
  beforeEach(() => { WorkspaceResponseHandler.getInstance(); });

  const entries: [string, readonly string[]][] = Object.entries(SUCCESS_RESPONSES);

  it('covers a non-trivial number of writes', () => {
    // Guards the loop below against silently iterating nothing.
    expect(entries.length).toBeGreaterThan(10);
  });

  it.each(entries)(
    '%s: the router emits a raw response for its success variant',
    (requestType, variants) => {
      for (const variant of variants) {
        expect(
          PAYLOADS[variant],
          `add a sample payload for the '${variant}' variant`,
        ).toBeDefined();

        const { events, handled } = dispatch(variant);

        // Precondition: without this, a variant the router does not recognise
        // reaches the Unhandled fallback, which emits raw-response anyway and
        // makes the real assertion below vacuous.
        expect(
          handled,
          `'${variant}' was not recognised by any router handler — it fell ` +
            `through to the Unhandled branch, so this test proves nothing ` +
            `about ${requestType}.`,
        ).toBe(true);

        expect(
          events,
          `${requestType} is gated on '${variant}', but the router handles that ` +
            `variant without emitting 'workspace:raw-response' — every success ` +
            `would wait out the 15s timeout and report possible failure.`,
        ).toContain('workspace:raw-response');
      }
    },
  );
});
