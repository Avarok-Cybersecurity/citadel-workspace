/**
 * Where a paused contact's outbound waits: here, not in the ILM.
 *
 * The ILM holds messages for a peer only while this app says the peer is not
 * connected -- its `connected_peers` is this app's connection state. Live, a
 * paused contact's link came back without anyone accepting it (an SDK
 * simultaneous-connect shortcut), the state said "connected", and the ILM
 * drained everything the user had been told would wait. So a send to a paused
 * contact never reaches the ILM at all. It is written to the agent's LocalDB,
 * under the local session, one key per message, and leaves on Resume.
 *
 * One key per message, ordered by a stamp that strictly increases within this
 * tab, then a random tiebreak, so two tabs writing at once cannot overwrite
 * each other. Across tabs, same-stamp order is the tiebreak's. Durable, because the banner
 * promises delivery after Resume and a reload in between must not break that.
 *
 * The key also carries the send's security level and compression hint, so a
 * held message leaves on Resume exactly as it would have left at once. Keys
 * written before that have neither, and flush as they always did.
 *
 * And why it is held. A message to someone who has not yet accepted your
 * request waits here too (`'unregistered'`), and leaves when they accept, not
 * on Resume. One outbox, so one key order and one durability story; the reason
 * is the last key field. Keys written before reasons existed were written only
 * by the pause, so they read as `'paused'`.
 */
import type { CompressionHint } from 'citadel-workspace-client-ts';
import { readPauseStatus, type PauseStorage } from './pause-store';
import type { PauseStatus } from './pause-rules';
import { isGenuinelyAbsent } from '@/lib/storage/absence';
import { CHAT_SECURITY_LEVELS, type ChatSecurityLevel } from '@/lib/p2p/chat-advanced-settings';
import { isCompressionHint } from '@/lib/p2p/compression-hints';

export interface OutboxStorage extends PauseStorage {
  listKeys(localCid: bigint, prefix: string): Promise<string[]>;
}

export type SendOutcome = 'sent' | 'held';

/** Why a message waits here, and so which event lets it leave. */
export type HoldReason = 'paused' | 'unregistered';
const HOLD_REASONS: readonly HoldReason[] = ['paused', 'unregistered'];

/** How a message is sent, apart from its bytes. Absent fields mean the transport's own default. */
export interface ReliableSendOptions {
  securityLevel?: ChatSecurityLevel;
  compressionHint?: CompressionHint;
}

/** A send the pause forbids and nothing can hold: the caller must not retry around it. */
export class PausedPeerError extends Error {
  constructor(peerCid: bigint) {
    super(`The connection to ${peerCid.toString()} is paused`);
    this.name = 'PausedPeerError';
  }
}

const OUTBOX_PREFIX: 'p2p_paused_outbox_' = 'p2p_paused_outbox_';
const TIME_WIDTH: number = 16;
const ABSENT: '-' = '-';

function outboxPrefix(peerCid: bigint): string {
  return `${OUTBOX_PREFIX}${peerCid.toString()}_`;
}

function entrySuffix(options: ReliableSendOptions, reason: HoldReason): string {
  return `_${options.securityLevel ?? ABSENT}_${options.compressionHint ?? ABSENT}_${reason}`;
}

interface HeldEntry { options: ReliableSendOptions; reason: HoldReason }

/** Inverse of entrySuffix. A key this module did not write is an error, not a guess. */
function entryFromKey(key: string, prefix: string): HeldEntry {
  const parts: string[] = key.slice(prefix.length).split('_');
  if (parts.length === 2) return { options: {}, reason: 'paused' };
  const [, , level, hint, written] = parts;
  const securityLevel: ChatSecurityLevel | undefined = CHAT_SECURITY_LEVELS.find((l: ChatSecurityLevel): boolean => l === level);
  const reason: HoldReason | undefined = parts.length === 4 ? 'paused' : HOLD_REASONS.find((r: HoldReason): boolean => r === written);
  if (parts.length < 4 || parts.length > 5 || reason === undefined
    || (level !== ABSENT && securityLevel === undefined) || (hint !== ABSENT && !isCompressionHint(hint))) {
    throw new Error(`Unreadable held-message key ${key}; nothing further was flushed`);
  }
  const options: ReliableSendOptions = {
    ...(securityLevel !== undefined ? { securityLevel } : {}),
    ...(isCompressionHint(hint) ? { compressionHint: hint } : {}),
  };
  return { options, reason };
}

export class HeldOutbox {
  private readonly storage: OutboxStorage;
  private readonly now: () => number;
  /**
   * The last stamp written. Stamps strictly increase, so messages held within
   * one millisecond still sort in write order: with the clock alone they tied,
   * and the random tiebreak decided which left first.
   */
  private lastStamp: number = 0;

  constructor(deps: { storage: OutboxStorage; now: () => number }) {
    this.storage = deps.storage;
    this.now = deps.now;
  }

  private nextStamp(): number {
    this.lastStamp = Math.max(this.now(), this.lastStamp + 1);
    return this.lastStamp;
  }

  /**
   * An unreadable pause record is refused rather than guessed: sending could
   * break a pause, and holding would park a message for a contact who may not
   * be paused at all, with no Resume ever coming to release it.
   */
  async sendOrHold(
    localCid: bigint, peerCid: bigint, bytes: Uint8Array, options: ReliableSendOptions, send: () => Promise<void>
  ): Promise<SendOutcome> {
    const status: PauseStatus = await readPauseStatus(this.storage, localCid, peerCid);
    if (status === 'unknown') {
      throw new Error(`Could not check whether the connection to ${peerCid.toString()} is paused; nothing was sent`);
    }
    if (status === 'active') {
      await send();
      return 'sent';
    }
    await this.hold(localCid, peerCid, bytes, options, 'paused');
    return 'held';
  }

  /** Durable before it resolves: a caller that tells the user "this will wait" may rely on it. */
  async hold(localCid: bigint, peerCid: bigint, bytes: Uint8Array, options: ReliableSendOptions, reason: HoldReason): Promise<void> {
    const key: string = `${outboxPrefix(peerCid)}${this.nextStamp().toString().padStart(TIME_WIDTH, '0')}_${crypto.randomUUID()}${entrySuffix(options, reason)}`;
    await this.storage.set(localCid, key, Array.from(bytes));
  }

  /** For sends with no queue behind them: refuse unless known not to be paused. */
  async refuseIfPaused(localCid: bigint, peerCid: bigint): Promise<void> {
    const status: PauseStatus = await readPauseStatus(this.storage, localCid, peerCid);
    if (status !== 'active') throw new PausedPeerError(peerCid);
  }

  async heldCount(localCid: bigint, peerCid: bigint, reason: HoldReason): Promise<number> {
    const prefix: string = outboxPrefix(peerCid);
    return (await this.heldKeys(localCid, peerCid)).filter((key: string): boolean => entryFromKey(key, prefix).reason === reason).length;
  }

  /**
   * In write order; each one removed only after it was handed on, and the first
   * failure stops the flush, so what is left is exactly what did not go. Only
   * what was held for `reason`: Resume does not release a message still
   * waiting for its peer to accept, nor acceptance one still waiting on a pause.
   */
  async flush(
    localCid: bigint, peerCid: bigint, reason: HoldReason, send: (bytes: Uint8Array, options: ReliableSendOptions) => Promise<void>
  ): Promise<number> {
    const keys: string[] = await this.heldKeys(localCid, peerCid);
    let flushed: number = 0;
    for (const key of keys) {
      const entry: HeldEntry = entryFromKey(key, outboxPrefix(peerCid));
      if (entry.reason !== reason) continue;
      const stored: { value: number[] } | null = await this.storage.get(localCid, key);
      if (stored !== null) await send(Uint8Array.from(stored.value), entry.options);
      await this.storage.remove(localCid, key);
      flushed += 1;
    }
    return flushed;
  }

  private async heldKeys(localCid: bigint, peerCid: bigint): Promise<string[]> {
    try {
      return [...await this.storage.listKeys(localCid, outboxPrefix(peerCid))].sort();
    } catch (error: unknown) {
      if (isGenuinelyAbsent(error)) return [];
      throw error;
    }
  }
}
