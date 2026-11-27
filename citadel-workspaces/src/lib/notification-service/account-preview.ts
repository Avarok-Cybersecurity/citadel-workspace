/**
 * The message-preview setting of the account a notification is for, which only the agent keeps
 * (lib/agent-conversations, `GetAccountPreferences`). Read as a system notification is about to
 * be shown, so a change made a moment ago holds. When it cannot be read -- no agent, no answer,
 * a notification for no account -- the answer is the agent's own default, `SenderOnly`: failing
 * closed shows who, never what.
 */
import type { NotificationPreview } from 'citadel-internal-service-wasm-client';
import { agentConversations } from '@/lib/agent-conversations/requests';

export async function accountPreview(recipientCid: string | undefined): Promise<NotificationPreview> {
  if (recipientCid === undefined) return 'SenderOnly';
  try {
    return (await agentConversations.getPreferences(BigInt(recipientCid))).notification_preview;
  } catch (error: unknown) {
    console.warn('[notifications] the preview setting could not be read, so the notification says who and not what', error);
    return 'SenderOnly';
  }
}
