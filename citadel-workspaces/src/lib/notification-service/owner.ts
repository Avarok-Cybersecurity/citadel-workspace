/**
 * Who announces a notification outside the page: the agent or the browser.
 *
 * One notification per message, but never none. The agent, which hosts every
 * account's conversations, raises a native notice for a message
 * (kernel/notices/decide.rs) -- and that notice reaches the OS only through a
 * notifier attached to the agent: today the macOS menu-bar app, subscribed to
 * the notice plane (apps/macos-agent/NoticeClient.swift). Windows and Linux
 * have none, so there the agent's notice goes nowhere.
 *
 * So the agent owns a conversation's message only when a notifier is
 * attached; everything else is the browser's. Handing it to the agent without
 * one left a message with no notification at all.
 *
 * The agent says whether one is attached (`notices_heard`, kept current by
 * `NoticesHeardNotification`; agent kernel/notices/heard.rs), and the window
 * holds it in `noticesHeard` (capabilities.ts). Until it says, none is attached:
 * the browser shows it -- a duplicate at worst, never a silence.
 *
 * Pure: the caller finds out what the agent does (capabilities.ts).
 */
import { NotificationType, type Notification } from './types';

export type NotificationOwner = 'agent' | 'browser';

export interface AgentNotices {
  /** Something on the agent's side will show its notice to the user. */
  notifierAttached: boolean;
}

/** A P2P conversation's message: it names its peer (message-arrival-notification.ts). */
function isConversationMessage(n: Pick<Notification, 'type' | 'data'>): boolean {
  return n.type === NotificationType.MESSAGE && n.data?.peerCid !== undefined;
}

export function notificationOwner(n: Pick<Notification, 'type' | 'data'>, agent: AgentNotices): NotificationOwner {
  return agent.notifierAttached && isConversationMessage(n) ? 'agent' : 'browser';
}
