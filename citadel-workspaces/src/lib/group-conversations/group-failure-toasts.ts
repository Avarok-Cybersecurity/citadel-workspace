/**
 * Telling the user when the server refuses a group operation.
 *
 * The group plane's failure variants — `GroupCreateFailure` and its seven
 * siblings — carry a message and a request id, and were mapped by nothing: no
 * failure variant of any group operation had a handler anywhere in the
 * frontend.
 *
 * That is invisible rather than merely quiet, because the create dialog
 * resolves on DISPATCH and closes. A refused create looked exactly like a
 * successful one that had not arrived yet: the form cleared, the dialog shut,
 * and the sidebar never gained the group. The same for invitations.
 */

import { eventEmitter } from '@/lib/event-emitter';
import { toast } from '@/hooks/use-toast';
import { debugLog } from '@/lib/debug-config';

/** "Create" -> "create the group", so the toast is a sentence. */
function operationVerb(operation: string): string {
  const verbs: Record<string, string> = {
    Create: 'create the group',
    ChannelCreate: 'create the group',
    Invite: 'send the invitation',
    Leave: 'leave the group',
    Kick: 'remove that member',
    End: 'delete the group',
    // `Join` and `Disconnect` were here for variants that do not exist. These
    // five do, and had no verb, so they fell to the generic fallback.
    RequestJoin: 'ask to join the group',
    RespondRequest: 'answer that invitation',
    Message: 'send that message',
    ListGroups: 'load your groups',
    ListJoined: 'load your groups',
    BroadcastHandle: 'reach the group',
  };
  return verbs[operation] ?? 'complete that group action';
}

export function bindGroupFailureToasts(): void {
  eventEmitter.on('group:failed', (data: { operation: string; message: string }) => {
    debugLog('GroupStore', 'Group operation failed:', data);
    toast({
      title: `Could not ${operationVerb(data.operation)}`,
      // The server's own words when it gave any: it knows why and the client
      // does not, and "please try again" for a refusal that will refuse again
      // is worse than saying nothing.
      description: data.message || 'The server refused the request.',
      variant: 'destructive',
    });
  });
}
