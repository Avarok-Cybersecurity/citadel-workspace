/**
 * The serving and calling hosts' authority for P2P (p2p-demo-design §1, check #5): the kernel's
 * `AuthorizePeer`, asked per (peer CID, direction) for this install and held until
 * min(until_ms, now + 60 s), so a revocation takes effect within a minute -- or at once, when an
 * install-change push evicts every answer. A refusal is held for REFUSAL_CACHE_MS, so a peer
 * flooding refused heads costs the kernel one ask, not the whole per-peer budget. An answer asked
 * before an eviction is never held after it: the change it missed may be the one that refuses.
 * Each peer is rate-limited BEFORE the kernel is asked, so a flood of heads cannot become kernel
 * load. Pure over the injected ask and clock.
 */
import { TokenBucket } from '../host/token-bucket';
import type { PeerDirection } from 'citadel-workspace-client-ts';
import { peerDirectionKey, type PeerAuthorization } from '../member-consent-types';

/** At most this long, whatever the kernel's until_ms says. */
export const AUTHORIZE_CACHE_MS: number = 60_000;
/** A refusal is held this long. */
export const REFUSAL_CACHE_MS: number = 5_000;

export type AuthorizeAsk = (peerCid: bigint, direction: PeerDirection) => Promise<PeerAuthorization>;

interface Held {
  readonly answer: PeerAuthorization;
  readonly until: number;
}

export class PeerAuthority {
  private readonly held: Map<string, Held> = new Map<string, Held>();
  private readonly asking: Map<string, Promise<PeerAuthorization>> = new Map<string, Promise<PeerAuthorization>>();
  private readonly buckets: Map<bigint, TokenBucket> = new Map<bigint, TokenBucket>();
  /** Bumped by every eviction: an answer is held only when no eviction happened while it was asked. */
  private generation: number = 0;

  /** `asksPerSecond`: per peer, before the kernel is asked (the manifest's call rate). */
  constructor(private readonly ask: AuthorizeAsk, private readonly nowMs: () => number, private readonly asksPerSecond: number) {}

  /** The kernel's answer for this peer, from the cache while it is fresh. `limited`: the peer is over its rate. */
  authorize(peerCid: bigint, direction: PeerDirection): Promise<PeerAuthorization | 'limited'> {
    const key: string = `${peerCid.toString()}|${peerDirectionKey(direction)}`;
    const now: number = this.nowMs();
    const cached: Held | undefined = this.held.get(key);
    if (cached !== undefined && now < cached.until) return Promise.resolve(cached.answer);
    this.held.delete(key);
    const pending: Promise<PeerAuthorization> | undefined = this.asking.get(key);
    if (pending !== undefined) return pending;
    if (!this.bucket(peerCid, now).take(now)) return Promise.resolve('limited');
    const generation: number = this.generation;
    const asked: Promise<PeerAuthorization> = this.ask(peerCid, direction).then(
      (answer: PeerAuthorization): PeerAuthorization => {
        if (this.asking.get(key) === asked) this.asking.delete(key);
        if (generation === this.generation) this.held.set(key, { answer, until: this.holdUntil(answer) });
        return answer;
      },
      (): PeerAuthorization => {
        if (this.asking.get(key) === asked) this.asking.delete(key);
        return { ok: false, why: 'no_answer' };
      },
    );
    this.asking.set(key, asked);
    return asked;
  }

  /** An install or app change was pushed: nothing held is trusted any more. */
  evictAll(): void {
    this.generation += 1;
    this.held.clear();
    this.asking.clear();
  }

  private holdUntil(answer: PeerAuthorization): number {
    const now: number = this.nowMs();
    return answer.ok ? Math.min(Number(answer.untilMs), now + AUTHORIZE_CACHE_MS) : now + REFUSAL_CACHE_MS;
  }

  private bucket(peerCid: bigint, now: number): TokenBucket {
    let b: TokenBucket | undefined = this.buckets.get(peerCid);
    if (b === undefined) {
      b = new TokenBucket(this.asksPerSecond, now);
      this.buckets.set(peerCid, b);
    }
    return b;
  }
}
