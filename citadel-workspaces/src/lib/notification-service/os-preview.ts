/**
 * What a system notification may say, under the account's message-preview setting: the one rule
 * for every notification the browser shows, the same as the agent's (citadel-internal-service
 * kernel/notices/decide.rs). `SenderOnly`, the default, says who and not what: a lock screen must
 * not read a message out to the room. The bell, inside the page, still shows everything.
 *
 * - A message (one-to-one or group): its title names the sender; its text becomes "New message".
 * - An app notice that carries someone else's words names only its app and sender, in the line its
 *   host wrote (`data.senderLine`); the member's own reminders carry none and keep their title.
 * - A connection request or a system notice carries no one's words and reads as it is.
 *
 * Pure: the caller reads the setting (interrupt-os.ts).
 */
import type { NotificationPreview } from 'citadel-internal-service-wasm-client';
import { NotificationType, type Notification } from './types';

export interface OsContent {
  readonly title: string;
  readonly body: string;
}

export const HIDDEN_MESSAGE_TEXT: string = 'New message';

export function osContent(n: Pick<Notification, 'type' | 'title' | 'content' | 'data'>, preview: NotificationPreview): OsContent {
  const asIs: OsContent = { title: n.title, body: n.content };
  if (preview === 'Text') return asIs;
  if (n.type === NotificationType.MESSAGE) return { title: n.title, body: HIDDEN_MESSAGE_TEXT };
  const senderLine: unknown = n.data?.senderLine;
  if (typeof n.data?.appId === 'string' && typeof senderLine === 'string') return { title: senderLine, body: '' };
  return asIs;
}
