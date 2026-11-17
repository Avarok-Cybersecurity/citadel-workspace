/**
 * Appends and Pulls never sent faster than the kernel admits them.
 *
 * The kernel's limiters (`kernel/rate_limiter.rs`, one per kind in `kernel/documents/mod.rs`)
 * grant `appends_per_second` and `pulls_per_second` per CID per fixed one-second window, over
 * every document and connection of the account. Requests at least `1000 / per_second` ms apart
 * can never exceed a window, so each kind has one pacer per account in this tab, shared by all
 * of the tab's documents, and requests leave it in the order they were queued.
 *
 * Per tab, not per browser: two tabs of one account editing at once share the kernel's budget
 * without coordinating, so one can still be refused; refused-retry.ts resends through the same
 * pacer, and the status names it as paused, not broken. Accepted for R1.
 *
 * A queued request is built when it leaves, not when it was queued: `fire` reads what is still
 * unacknowledged then, and answers false when nothing is left to send, which spends no slot.
 * One request per (owner, key) waits at a time, so a resend never queues a duplicate.
 */
import type { DocumentsRequest } from 'citadel-workspace-client-ts';
import type { Clock } from './ports';

interface Queued {
  readonly owner: object;
  readonly key: string;
  readonly fire: () => boolean;
}

export class RequestPacer {
  private readonly minIntervalMs: number;
  private lastSentAt: number | null = null;
  private readonly queue: Queued[] = [];
  private cancelTimer: (() => void) | null = null;

  constructor(private readonly clock: Clock, perSecond: number) {
    if (!(perSecond > 0)) throw new Error('a request rate must be positive');
    this.minIntervalMs = Math.ceil(1000 / perSecond);
  }

  /** Queues `fire` behind everything queued; a second (owner, key) while one waits is dropped. */
  enqueue(owner: object, key: string, fire: () => boolean): void {
    if (this.queue.some((q: Queued): boolean => q.owner === owner && q.key === key)) return;
    this.queue.push({ owner, key, fire });
    if (this.cancelTimer === null) this.pump();
  }

  /** `owner` closed: what it queued never leaves. */
  forget(owner: object): void {
    for (let i: number = this.queue.length - 1; i >= 0; i -= 1) if (this.queue[i].owner === owner) this.queue.splice(i, 1);
    if (this.queue.length === 0) this.stopTimer();
  }

  get waiting(): number {
    return this.queue.length;
  }

  /** How long until the next queued request may leave; null when none waits. */
  dueInMs(): number | null {
    if (this.queue.length === 0) return null;
    return Math.max(0, this.nextSlot() - this.clock.now());
  }

  private nextSlot(): number {
    return this.lastSentAt === null ? this.clock.now() : this.lastSentAt + this.minIntervalMs;
  }

  private pump(): void {
    while (this.queue.length > 0) {
      const wait: number = this.nextSlot() - this.clock.now();
      if (wait > 0) {
        this.cancelTimer = this.clock.after(wait, (): void => { this.cancelTimer = null; this.pump(); });
        return;
      }
      const next: Queued = this.queue.shift() as Queued;
      if (next.fire()) this.lastSentAt = this.clock.now();
    }
  }

  private stopTimer(): void {
    if (this.cancelTimer) this.cancelTimer();
    this.cancelTimer = null;
  }
}

/** One pacer per kind for one account in this tab. */
export interface DocumentPacing {
  readonly appends: RequestPacer;
  readonly pulls: RequestPacer;
}

type Send = (request: DocumentsRequest, name: 'Append' | 'Pull') => Promise<void>;

/** One document's Appends and Pulls through the tab's pacers; `build` answers null for nothing to send. */
export class PacedSends {
  constructor(private readonly pacing: DocumentPacing, private readonly send: Send) {}

  append(clientSeq: bigint, build: () => DocumentsRequest | null): void {
    this.pacing.appends.enqueue(this, clientSeq.toString(), (): boolean => this.fire(build(), 'Append'));
  }

  /** At most one Pull waits, built from the cursor as it is when it leaves. */
  pull(build: () => DocumentsRequest | null): void {
    this.pacing.pulls.enqueue(this, 'pull', (): boolean => this.fire(build(), 'Pull'));
  }

  forget(): void {
    this.pacing.appends.forget(this);
    this.pacing.pulls.forget(this);
  }

  private fire(request: DocumentsRequest | null, name: 'Append' | 'Pull'): boolean {
    if (request === null) return false;
    void this.send(request, name);
    return true;
  }
}
