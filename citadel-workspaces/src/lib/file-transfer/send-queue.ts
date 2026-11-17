/**
 * Sending a file to a peer who is offline: it waits, then goes by itself.
 *
 * A send to an unreachable peer used to wait 15 s for a channel and then fail
 * at the agent ("Peer Connection Not Found"). Now it is held as a 'queued'
 * transfer -- the same record and state machine as every other transfer -- and
 * the outgoing bubble says "Will send when {name} is online". When the peer's
 * channel opens it is sent the ordinary way.
 *
 * The decisions are here and pure; holding the File (in memory and IndexedDB,
 * so it survives a reload) and noticing the peer come back are behind ports
 * (send-queue-io.ts).
 */
import type { FileTransfer } from './types';
import { formatBytes } from '../format-bytes';
import { isTerminalTransferState } from './transfer-outcome';

/** How many files one browser may hold for offline peers at once. */
export const MAX_QUEUED_FILES: number = 20;

/** How many bytes they may add up to: they are kept in this browser's storage. */
export const MAX_QUEUED_BYTES: number = 512 * 1024 * 1024;

/**
 * Whether a send should wait for the peer rather than go now.
 *
 * Known offline: wait. Known online: go, even if the channel was not confirmed
 * in time -- the connection tracker can lag the agent, and the send reports the
 * real outcome. Not known and no channel: nobody can receive it now, so wait.
 */
export function shouldQueue(peerOnline: boolean | null, channelOpened: boolean): boolean {
  if (peerOnline === false) return true;
  if (peerOnline === true) return false;
  return !channelOpened;
}

/**
 * What the Send dialog says before anyone commits to a send: a file for an offline
 * peer waits in this browser, within this limit. It was said only in the refusal,
 * after the fact, while the dialog showed a 2 GB maximum (UX review, finding 9).
 */
export function offlineHoldNote(): string {
  return `If they are offline, it waits in this browser and goes when they are back: up to ${MAX_QUEUED_FILES} files, ${formatBytes(MAX_QUEUED_BYTES)} in all.`;
}

/** The bubble's line for a held send. */
export function waitingText(peerName: string): string {
  return `Will send when ${peerName} is online`;
}

/** Why another file of `size` bytes cannot be held, or null when it can. */
export function queueRefusal(held: readonly FileTransfer[], size: number): string | null {
  const queued: readonly FileTransfer[] = held.filter((t) => t.state === 'queued');
  if (queued.length >= MAX_QUEUED_FILES) {
    return `${MAX_QUEUED_FILES} files are already waiting for peers to come online; send this one when they are back.`;
  }
  const bytes: number = queued.reduce((sum, t) => sum + t.fileSize, 0);
  if (bytes + size > MAX_QUEUED_BYTES) {
    return `Files waiting for offline peers would exceed what this browser keeps for them (${formatBytes(MAX_QUEUED_BYTES)}); send this one when they are back.`;
  }
  return null;
}

/**
 * Whether this browser may also keep the bytes of a send that goes now, so a
 * reload before it is offered can send it again by itself (reload-recovery.ts).
 * The same budget as held sends: both live in this browser's storage.
 */
export function canKeepBytes(transfers: readonly FileTransfer[], size: number): boolean {
  const kept: number = transfers
    .filter((t) => !t.isIncoming && (t.state === 'queued' || (t.bytesKept === true && !isTerminalTransferState(t.state))))
    .reduce((sum, t) => sum + t.fileSize, 0);
  return kept + size <= MAX_QUEUED_BYTES;
}

/** The sends held for `peerCid` by the account `ownCid`, oldest first. */
export function queuedFor(transfers: readonly FileTransfer[], ownCid: string, peerCid: string): FileTransfer[] {
  return transfers
    .filter((t) => t.state === 'queued' && !t.isIncoming && t.senderCid === ownCid && t.recipientCid === peerCid)
    .sort((a, b) => a.createdAt - b.createdAt);
}

/** The peers `ownCid` holds sends for. */
export function peersWithQueued(transfers: readonly FileTransfer[], ownCid: string): string[] {
  const peers: Set<string> = new Set<string>();
  for (const t of transfers) {
    if (t.state === 'queued' && !t.isIncoming && t.senderCid === ownCid) peers.add(t.recipientCid);
  }
  return [...peers];
}
