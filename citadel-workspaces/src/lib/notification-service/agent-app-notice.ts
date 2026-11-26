/**
 * An app's notice the page raised, handed to the agent to show natively (owner.ts
 * 'hand-to-agent'). Whether the agent showed it: when it did not (nothing listens on its side,
 * a refusal, no answer), the caller shows it in the browser, so it is never shown by neither.
 *
 * One that may carry someone else's words (an invitation, a booking, a poll) names its sender
 * line, all the agent shows while the account keeps previews off: the one the host wrote for it
 * (citadel-apps/runtime/first-party-ports.ts `senderLine`), never one the app gave. The app's own
 * notice to its member has none, and its title shows.
 */
import type { AppNotice } from 'citadel-internal-service-wasm-client';
import { postAppNotice } from '@/lib/agent-apps/app-notice-requests';
import type { Notification } from './types';

const ID_MAX: number = 160;

/** The notice the agent is handed, or null when the notification names no app, node or session. */
export function appNoticeOf(n: Pick<Notification, 'id' | 'title' | 'content' | 'data'>): AppNotice | null {
  const appId: unknown = n.data?.appId;
  const nodeId: unknown = n.data?.nodeId;
  const senderLine: unknown = n.data?.senderLine;
  if (typeof appId !== 'string' || typeof nodeId !== 'string') return null;
  return {
    id: `page:${n.id}`.replace(/[^A-Za-z0-9:_.-]/g, '-').slice(0, ID_MAX),
    app_id: appId,
    node_id: nodeId,
    title: n.title,
    body: n.content,
    sender_only: typeof senderLine === 'string' ? senderLine : undefined,
    fire_at_ms: undefined,
    start_ms: undefined,
  };
}

export async function handedToAgent(n: Notification): Promise<boolean> {
  const notice: AppNotice | null = appNoticeOf(n);
  if (notice === null || n.recipient_cid === undefined) return false;
  try {
    await postAppNotice(BigInt(n.recipient_cid), notice);
    return true;
  } catch (error: unknown) {
    console.warn('[notifications] the agent did not show an app notice; the browser shows it', error);
    return false;
  }
}
