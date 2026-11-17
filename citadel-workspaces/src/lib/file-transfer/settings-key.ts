import { instanceManager } from '@/lib/multi-instance';

/**
 * The key a peer's file-transfer settings are stored under.
 *
 * Settings are per-account AND per-peer: two accounts in one browser talking to
 * the same peer must not share a max-file-size or an auto-accept switch.
 * Keyed by peer alone, one account enabling "auto-accept files from X" made
 * every other account in the browser auto-accept from X: a security setting
 * inherited by an account that never agreed to it.
 *
 * It lives here rather than as a private method on the service because the
 * lifecycle module also reads these settings, and it was reading them under the
 * BARE peer CID -- a key nothing writes in a live session. So both the send-time
 * and the accept-time size checks always saw the 100 MiB default, and the user's
 * slider limited nothing on either path. The scoping fix and the accept-limit
 * fix were each correct, and each worked only in isolation.
 *
 * A missing own-CID falls back to the bare peer key rather than inventing a
 * scope: settings written before a session exists belong to no account, and
 * silently filing them under one would be worse.
 */
export function scopedSettingsKey(peerCid: string): string {
  const own: bigint | null = instanceManager.cid;
  return own ? `${own.toString()}:${peerCid}` : peerCid;
}

/**
 * The localStorage key the transfer HISTORY is stored under, for this account.
 *
 * Settings were given account scoping (above) and the transfer store was not,
 * so one browser's accounts shared a single `citadel:file-transfers` map:
 * every tab loaded every account's history, and each write serialised all of
 * it. Two accounts in one browser is the ordinary case here, not an edge one.
 *
 * Falls back to the bare key when no account is known, for the same reason
 * `scopedSettingsKey` does: records written before a session exists belong to
 * no account, and filing them under one silently would be worse than leaving
 * them where they are.
 */
export function scopedTransfersKey(): string {
  const own: bigint | null = instanceManager.cid;
  return own ? `citadel:file-transfers:${own.toString()}` : 'citadel:file-transfers';
}
