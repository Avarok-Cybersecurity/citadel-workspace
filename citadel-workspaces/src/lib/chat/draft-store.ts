/**
 * Half-written messages, kept when you look at another conversation.
 *
 * The composer's text was plain component state, and the chat is keyed by peer
 * — deliberately, because an unkeyed composer leaked one conversation's draft
 * into another. So switching conversations unmounted the composer and the draft
 * went with it: mid-message to Alice, you click Bob to check something she
 * asked about, and your paragraph is gone. Silently. Every chat product this
 * one resembles keeps it.
 *
 * The keyed remount stays — it is the fix for the worse bug — and the text
 * lives out here instead, one entry per conversation. Held in memory only: a
 * draft is a thought in progress, and persisting it to disk on a product whose
 * subject is privacy is a decision to make deliberately rather than as a side
 * effect of fixing this.
 *
 * The one exception is a reload the app itself asks for (a new deploy, a
 * superseded chunk): `exportDrafts` hands the entries to draft-handoff for that
 * single reload, and the next load takes them back and deletes them.
 */

import { instanceManager } from '@/lib/multi-instance';

const drafts: Map<string, string> = new Map<string, string>();

/**
 * Drafts are per-account AND per-conversation. One browser holds several
 * accounts at once, and a ClaimSession switches which account a tab runs as;
 * keyed by conversation alone, the account you switched TO saw the other
 * account's half-written message sitting in its composer. Same convention as
 * `scopedSettingsKey` (file-transfer/settings-key.ts), including the bare
 * fallback: a draft typed before any session exists belongs to no account,
 * and silently filing it under one would be worse.
 */
function scopedDraftKey(conversationKey: string): string {
  const own: bigint | null = instanceManager.cid;
  return own ? `${own.toString()}:${conversationKey}` : conversationKey;
}

/** Remember what is typed but unsent for a conversation. */
export function saveDraft(conversationKey: string, text: string): void {
  // An empty draft is not a draft; keeping it would resurrect a cleared box.
  if (text === '') {
    drafts.delete(scopedDraftKey(conversationKey));
    return;
  }
  drafts.set(scopedDraftKey(conversationKey), text);
}

/** What was typed but unsent, or empty. */
export function loadDraft(conversationKey: string): string {
  return drafts.get(scopedDraftKey(conversationKey)) ?? '';
}

/** Forget a conversation's draft — after a send, or when it is deleted. */
export function clearDraft(conversationKey: string): void {
  drafts.delete(scopedDraftKey(conversationKey));
}

/** Test-only. */
/** Every draft, keyed exactly as stored, for carrying across one reload. */
export function exportDrafts(): Array<[string, string]> {
  return [...drafts.entries()];
}

/** Put carried drafts back. One typed since the reload is newer, so it wins. */
export function importDrafts(entries: ReadonlyArray<readonly [string, string]>): void {
  for (const [key, text] of entries) {
    if (text !== '' && !drafts.has(key)) drafts.set(key, text);
  }
}

export function clearAllDraftsForTests(): void {
  drafts.clear();
}
