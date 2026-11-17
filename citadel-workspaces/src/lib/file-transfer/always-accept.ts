/**
 * Whether to ask "always accept files from this person?", and about which offer.
 *
 * Asked once per peer, on the first offer the person has to answer by hand: the preference is
 * the per-peer, per-account `autoAccept` the chat settings already hold (settings-key.ts), and
 * `autoAcceptAnswered` records that the person has decided it, here or in the settings: setting
 * autoAccept anywhere (FileTransferService.setAutoAccept) answers it, so the question is never
 * asked twice. Pure.
 */
import type { FileTransfer, FileTransferSettings } from './types';

export function asksAlwaysAccept(settings: FileTransferSettings): boolean {
  return !settings.autoAccept && !settings.autoAcceptAnswered;
}

/** The oldest offer from this peer still waiting on the person, when they are still to be asked. */
export function offerToAskAbout(settings: FileTransferSettings, transfers: readonly FileTransfer[]): FileTransfer | null {
  if (!asksAlwaysAccept(settings)) return null;
  const waiting: FileTransfer[] = transfers.filter((t: FileTransfer): boolean => t.isIncoming && t.state === 'pending');
  waiting.sort((a: FileTransfer, b: FileTransfer): number => a.createdAt - b.createdAt);
  return waiting[0] ?? null;
}
