/**
 * When a notification may interrupt the user: the one rule, for every surface.
 *
 * There were four, and they disagreed. The OS notification and its chime waited
 * for `document.hidden`, which stays false for a window that is on screen behind
 * another app; group chat asked only whether the tab was visible; the P2P toast
 * asked whether the conversation was open, from a field nothing ever set; and the
 * agent's native notices are told what is in front by ReportFocus, which asks
 * `windowInFront()`. The last is the agent's rule too (kernel/notices/decide.rs):
 * a message is held back only when a focused window shows its conversation.
 *
 * So: a conversation is in front when its chat is open AND the window is in
 * front (visible and focused). An OS-level interruption is for a window that is
 * not in front, unless its source says it is for the system whenever it arrives
 * (a reminder; os-decision.ts); an in-app one for anything not in front.
 */
import { windowInFront } from '@/lib/agent-conversations/report-focus';

/** Whether the user can see this conversation now: it is open, in a window that is in front. */
export function conversationInFront(isOpen: boolean): boolean {
  return isOpen && windowInFront();
}

/** Whether this window is in front, for the system notification's rule (os-decision.ts). */
export function thisWindowInFront(): boolean {
  return typeof document !== 'undefined' && windowInFront();
}
