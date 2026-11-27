/**
 * The words of an ask: the sentence the asker's client sends, the note an admin's Scratchpad
 * shows, and what a refusal tells the asker. Pure. The server stamps who asked and when, so the
 * sentence never names the asker itself.
 */
import type { AdminAskRefusal, AdminRequestEntry } from 'citadel-workspace-client-ts';
import type { AdminRequestKind } from '@/lib/recovery-route/route';

const ASK_LEAD: { readonly [K in AdminRequestKind]: string } = {
  permission: 'Asks for the permission',
  'app-access': 'Asks for access to the app',
  policy: 'Asks for an exception to the workspace policy, for',
  'storage-quota': 'Asks for more room, for',
  'remote-storage': 'Asks for remote storage to be turned on, for',
  membership: 'Asks to be let back into',
  'initialize-workspace': 'Asks for the workspace to be set up:',
};

/** The sentence sent to the admins. `about` names the thing (a permission, an app, a place). */
export function askSentence(kind: AdminRequestKind, about: string): string {
  return `${ASK_LEAD[kind]} “${about}”.`;
}

/** The note written into an admin's Scratchpad. */
export function noteFor(entry: AdminRequestEntry, at: (ms: bigint) => string): string {
  return `Request from @${entry.from_user} · ${at(entry.at_ms)}\n${entry.text}`;
}

export const REFUSAL_SENTENCE: { readonly [K in AdminAskRefusal]: string } = {
  Empty: 'There was nothing to ask.',
  TooLong: 'That ask is too long to send.',
  NoAdmins: 'You are the only admin here, so there is nobody to ask. You can change this yourself in Settings.',
  TooSoon: 'You asked a moment ago. You can ask again in a minute.',
};
