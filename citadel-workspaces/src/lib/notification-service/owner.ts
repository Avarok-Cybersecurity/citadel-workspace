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
 * attached. An app's notice (a Calendar invitation) is the page's to derive,
 * and is handed to the agent to show when the agent takes app notices
 * (`app_notices`); a reminder the agent fired itself reaches the page marked
 * `fromAgent`. Everything else is the browser's. Handing it to the agent without
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

/**
 * 'agent': the agent announces it itself (a conversation's message).
 * 'hand-to-agent': the page derived it (an app's notice) and hands it to the agent to show
 * (`AppNoticePost`); if the agent says nothing showed it, the browser shows it after all.
 * 'browser': the browser announces it.
 */
export type NotificationOwner = 'agent' | 'hand-to-agent' | 'browser';

export interface AgentNotices {
  /** Something on the agent's side will show its notice to the user. */
  notifierAttached: boolean;
  /** The agent takes apps' notices and keeps their reminders (`AgentCapabilities.app_notices`). */
  appNotices: boolean;
}

/** A P2P conversation's message: it names its peer (message-arrival-notification.ts). */
function isConversationMessage(n: Pick<Notification, 'type' | 'data'>): boolean {
  return n.type === NotificationType.MESSAGE && n.data?.peerCid !== undefined;
}

/**
 * An app's notice the page raised (app-notices.ts names its app). One the agent fired and told
 * the page about (`fromAgent`) is never handed back: the agent already did what it could.
 */
function isPageAppNotice(n: Pick<Notification, 'data'>): boolean {
  return typeof n.data?.appId === 'string' && n.data?.fromAgent !== true;
}

export function notificationOwner(n: Pick<Notification, 'type' | 'data'>, agent: AgentNotices): NotificationOwner {
  if (!agent.notifierAttached) return 'browser';
  if (isConversationMessage(n)) return 'agent';
  return agent.appNotices && isPageAppNotice(n) ? 'hand-to-agent' : 'browser';
}
