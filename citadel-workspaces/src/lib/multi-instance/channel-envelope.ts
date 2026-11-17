/**
 * The version envelope every channel message carries (`v`), so tabs of different builds can
 * tell each other apart.
 *
 * Before it, a tab could not know that the tab it was electing against ran another build. An
 * old-build tab and a new-build tab that broke election ties by opposite rules each kept
 * winning by its own rule and losing by the other's: leadership, and with it the browser's
 * one agent socket, flipped between them for as long as both were open.
 *
 * - `proto`: the channel protocol this tab speaks. `minProto`: the oldest it can still serve.
 * - `seq`: the build's clock (build-identity.ts); newer builds lead, older ones step aside.
 * - `entry`: the build's entry chunk, for diagnostics; null until main.tsx has declared it.
 * - `epoch`: the fencing token of the leadership this tab acts under (leadership-epoch.ts).
 *
 * Additive: a message without `v` is from a build before this one (protocol 1), and every
 * other field keeps its meaning, so each side can still read the other's requests and acks.
 */
import { BUILD_SEQ, declaredEntry } from './build-identity';

export const CHANNEL_PROTO: number = 2;
export const CHANNEL_MIN_PROTO: number = 2;

export interface ChannelEnvelope {
  readonly proto: number;
  readonly minProto: number;
  readonly seq: number;
  readonly entry: string | null;
  readonly epoch: number;
}

/** This tab's envelope, acting under `epoch`. */
export function ownEnvelope(epoch: number): ChannelEnvelope {
  return { proto: CHANNEL_PROTO, minProto: CHANNEL_MIN_PROTO, seq: BUILD_SEQ, entry: declaredEntry(), epoch };
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/**
 * The sender's envelope, or null for a protocol-1 sender (no `v`). A `v` that is present but
 * malformed is also null: nothing can be compared against it, so it is not trusted as current.
 */
export function readEnvelope(message: { v?: unknown }): ChannelEnvelope | null {
  const v: unknown = message.v;
  if (typeof v !== 'object' || v === null) return null;
  const { proto, minProto, seq, entry, epoch } = v as Record<string, unknown>;
  if (!isCount(proto) || !isCount(minProto) || !isCount(seq) || !isCount(epoch)) return null;
  if (entry !== null && typeof entry !== 'string') return null;
  return { proto, minProto, seq, entry, epoch };
}

/** Where a sender's envelope leaves this tab. */
export type Compatibility = 'legacy' | 'too-old-for-us' | 'too-new-for-us' | 'compatible';

export function compatibilityOf(theirs: ChannelEnvelope | null): Compatibility {
  if (theirs === null) return 'legacy';
  if (theirs.proto < CHANNEL_MIN_PROTO) return 'too-old-for-us';
  if (CHANNEL_PROTO < theirs.minProto) return 'too-new-for-us';
  return 'compatible';
}
