/**
 * THE ONE KERNEL DOUBLE. The workspace server cannot run in vitest (it is the Rust kernel over a
 * Citadel session), and the session's whole job is how it reacts to the server's answers and
 * pushes, so the transport is replaced here and nowhere else. It keeps the kernel's rules
 * (KernelLog; the awareness limiter's fixed one-second window; `broadcast_to_node` excluding
 * the author; permission errors as plain `Error` strings) and its delivery (every message for a
 * cid reaches every tab holding that cid, as route-by-cid.ts does). Tests script faults on top:
 * a dropped push, a link drop, a denied permission, an injected payload, a request refused
 * for now (rate limited, log full) and the server's own compaction.
 */
import type { RequestPacer } from '../../request-pacer';
import type { DocumentsRequest, DocumentsResponse } from 'citadel-workspace-client-ts';
import type { DocumentsTransport, LinkState } from '../../ports';
import { KernelLog, type KernelLogConfig } from './kernel-log';
import type { ManualClock } from './manual-clock';

export interface ScriptedKernelConfig extends KernelLogConfig {
  readonly maxAwarenessBytes: number;
  readonly awarenessPerSecond: number;
  readonly appendsPerSecond: number;
  readonly pullsPerSecond: number;
}

/** Refusals of a request the kernel would take later (requests/documents.rs). */
export type HeldBack = 'LogFull' | 'AppendRateLimited' | 'PullRateLimited';

type Delivery = { readonly kind: 'response'; readonly response: DocumentsResponse } | { readonly kind: 'error'; readonly message: string };

interface Endpoint {
  readonly cid: bigint;
  link: LinkState;
  readonly responses: Set<(response: DocumentsResponse) => void>;
  readonly errors: Set<(message: string) => void>;
  readonly links: Set<(state: LinkState) => void>;
}

export class ScriptedKernel {
  readonly log: KernelLog;
  /** Every request received, with when (the manual clock's ms). */
  readonly requests: { readonly cid: bigint; readonly request: DocumentsRequest; readonly at: number }[] = [];
  readonly refusedAwareness: bigint[] = [];
  private readonly endpoints: Endpoint[] = [];
  private readonly inbox: { readonly to: Endpoint; readonly delivery: Delivery }[] = [];
  private readonly denied: Map<bigint, 'EditMdx' | 'ViewContent'> = new Map<bigint, 'EditMdx' | 'ViewContent'>();
  private readonly dropPushes: Map<bigint, number> = new Map<bigint, number>();
  private readonly windows: Map<string, { start: number; tokens: number }> = new Map<string, { start: number; tokens: number }>();
  private readonly pacers: RequestPacer[] = [];
  /** Appends and Pulls the per-CID limiter refused, in order. */
  readonly rateRefused: { readonly cid: bigint; readonly kind: 'Append' | 'Pull' }[] = [];
  private readonly held: Map<bigint, { kind: HeldBack; count: number }> = new Map<bigint, { kind: HeldBack; count: number }>();

  constructor(readonly nodeId: string, private readonly config: ScriptedKernelConfig, private readonly clock: ManualClock) {
    this.log = new KernelLog(nodeId, config);
  }

  /** A tab of session `cid`. */
  connect(cid: bigint): DocumentsTransport {
    const endpoint: Endpoint = { cid, link: 'up', responses: new Set(), errors: new Set(), links: new Set() };
    this.endpoints.push(endpoint);
    const subscribe = <T>(set: Set<T>, listener: T): (() => void) => { set.add(listener); return (): void => { set.delete(listener); }; };
    return {
      selfCid: cid,
      send: (request: DocumentsRequest): Promise<void> => { if (endpoint.link === 'up') this.handle(cid, request); return Promise.resolve(); },
      link: (): LinkState => endpoint.link,
      onResponse: (listener: (response: DocumentsResponse) => void): (() => void) => subscribe(endpoint.responses, listener),
      onError: (listener: (message: string) => void): (() => void) => subscribe(endpoint.errors, listener),
      onLink: (listener: (state: LinkState) => void): (() => void) => subscribe(endpoint.links, listener),
    };
  }

  deny(cid: bigint, permission: 'EditMdx' | 'ViewContent'): void {
    this.denied.set(cid, permission);
  }

  /** `cid`'s next `count` Appends (LogFull, AppendRateLimited) or Pulls are refused, and dropped. */
  holdBack(cid: bigint, kind: HeldBack, count: number): void {
    this.held.set(cid, { kind, count });
  }

  /** The kernel compacted the log itself: every session with the document open hears it. */
  compact(): void {
    for (const cid of new Set(this.endpoints.map((e: Endpoint): bigint => e.cid))) {
      this.toCid(cid, { kind: 'response', response: { DocumentCompacted: { node_id: this.nodeId, upto_seq: this.log.latestSeq } } });
    }
  }

  /** The next `count` pushes to `cid` are lost, as a lagging broadcast receiver's are. */
  dropPushesTo(cid: bigint, count: number): void {
    this.dropPushes.set(cid, count);
  }

  setLink(cid: bigint, state: LinkState): void {
    for (const endpoint of this.endpoints.filter((e: Endpoint): boolean => e.cid === cid)) {
      endpoint.link = state;
      for (const listener of [...endpoint.links]) listener(state);
    }
  }

  /** Delivers `response` to every tab of `cid`, as if the server had sent it. */
  inject(cid: bigint, response: DocumentsResponse): void {
    this.toCid(cid, { kind: 'response', response });
  }

  /** Delivers everything queued, one message at a time, letting the sessions settle between. */
  async settle(sessions: readonly { settled(): Promise<void> }[]): Promise<void> {
    for (let rounds: number = 0; rounds < 10_000; rounds += 1) {
      await Promise.all(sessions.map((s: { settled(): Promise<void> }): Promise<void> => s.settled()));
      const next: { readonly to: Endpoint; readonly delivery: Delivery } | undefined = this.inbox.shift();
      if (!next) {
        // Quiet but for requests a pacer still holds: let time pass until the next may leave.
        const due: number[] = this.pacers.map((p: RequestPacer): number | null => p.dueInMs()).filter((d: number | null): d is number => d !== null);
        if (due.length === 0) return;
        this.clock.advance(Math.min(...due));
        continue;
      }
      if (next.to.link !== 'up') continue;
      if (next.delivery.kind === 'response') for (const listener of [...next.to.responses]) listener(next.delivery.response);
      else for (const listener of [...next.to.errors]) listener(next.delivery.message);
    }
    throw new Error('the sessions never went quiet');
  }

  sentOf<K extends string>(kind: K): { readonly cid: bigint; readonly request: Extract<DocumentsRequest, Record<K, unknown>>; readonly at: number }[] {
    return this.requests.filter((r: { readonly request: DocumentsRequest }): boolean => kind in r.request) as { readonly cid: bigint; readonly request: Extract<DocumentsRequest, Record<K, unknown>>; readonly at: number }[];
  }

  private handle(cid: bigint, request: DocumentsRequest): void {
    this.requests.push({ cid, request, at: this.clock.now() });
    const needs: 'EditMdx' | 'ViewContent' = 'Append' in request || 'StoreSnapshot' in request ? 'EditMdx' : 'ViewContent';
    const denied: 'EditMdx' | 'ViewContent' | undefined = this.denied.get(cid);
    if (denied === needs) {
      this.toCid(cid, { kind: 'error', message: `Permission denied: ${needs} required` });
      return;
    }
    if (this.heldBack(cid, request)) return;
    if (('Append' in request || 'Pull' in request) && !this.admit(cid, 'Append' in request ? 'Append' : 'Pull')) return;
    if ('Append' in request) {
      const { update, doc_version, client_seq } = request.Append;
      const { answer, stored } = this.log.append(update, doc_version, cid, client_seq);
      if (stored) this.push(cid, { DocumentUpdated: { node_id: this.nodeId, seq: stored.seq, doc_version: stored.doc_version, update: stored.update, author_cid: cid } });
      this.toCid(cid, { kind: 'response', response: answer });
    } else if ('Pull' in request) {
      this.toCid(cid, { kind: 'response', response: this.log.pull(request.Pull.since_seq) });
    } else if ('StoreSnapshot' in request) {
      const { snapshot, doc_version, upto_seq } = request.StoreSnapshot;
      this.toCid(cid, { kind: 'response', response: this.log.storeSnapshot(snapshot, doc_version, upto_seq) });
    } else {
      this.awareness(cid, request.Awareness.payload);
    }
  }

  /** The tabs' pacers, so settle() lets time pass while they hold requests. */
  paced(...pacers: RequestPacer[]): void {
    this.pacers.push(...pacers);
  }

  /** `rate_limiter.rs`: per CID, per kind, a fixed one-second window of the configured budget. */
  private admit(cid: bigint, kind: 'Append' | 'Pull'): boolean {
    if (this.take(`${kind}:${cid.toString()}`, kind === 'Append' ? this.config.appendsPerSecond : this.config.pullsPerSecond)) return true;
    this.rateRefused.push({ cid, kind });
    const refusal: { AppendRateLimited: { node_id: string } } | { PullRateLimited: { node_id: string } } = kind === 'Append' ? { AppendRateLimited: { node_id: this.nodeId } } : { PullRateLimited: { node_id: this.nodeId } };
    this.toCid(cid, { kind: 'response', response: { Refused: refusal } });
    return false;
  }

  private take(bucket: string, budget: number): boolean {
    const now: number = this.clock.now();
    const window: { start: number; tokens: number } = this.windows.get(bucket) ?? { start: now, tokens: budget };
    if (now - window.start >= 1000) { window.start = now; window.tokens = budget; }
    this.windows.set(bucket, window);
    if (window.tokens === 0) return false;
    window.tokens -= 1;
    return true;
  }

  private heldBack(cid: bigint, request: DocumentsRequest): boolean {
    const held: { kind: HeldBack; count: number } | undefined = this.held.get(cid);
    if (!held || held.count === 0 || !(held.kind === 'PullRateLimited' ? 'Pull' in request : 'Append' in request)) return false;
    held.count -= 1;
    const refusal: DocumentsResponse = held.kind === 'LogFull'
      ? { Refused: { LogFull: { node_id: this.nodeId, pending_bytes: 33_554_432n, max_bytes: 33_554_432n } } }
      : { Refused: { [held.kind]: { node_id: this.nodeId } } as { AppendRateLimited: { node_id: string } } };
    this.toCid(cid, { kind: 'response', response: refusal });
    return true;
  }

  private awareness(cid: bigint, payload: readonly number[]): void {
    if (payload.length > this.config.maxAwarenessBytes) {
      this.toCid(cid, { kind: 'response', response: { Refused: { AwarenessTooLarge: { node_id: this.nodeId, size_bytes: BigInt(payload.length), max_bytes: BigInt(this.config.maxAwarenessBytes) } } } });
      return;
    }
    if (!this.take(`Awareness:${cid.toString()}`, this.config.awarenessPerSecond)) {
      this.refusedAwareness.push(cid);
      this.toCid(cid, { kind: 'response', response: { Refused: { AwarenessRateLimited: { node_id: this.nodeId } } } });
      return;
    }
    this.push(cid, { DocumentAwareness: { node_id: this.nodeId, from_cid: cid, payload: [...payload] } });
    this.toCid(cid, { kind: 'response', response: { AwarenessRelayed: { node_id: this.nodeId } } });
  }

  /** `broadcast_to_node`: every other session, never the author's. */
  private push(author: bigint, response: DocumentsResponse): void {
    const others: Set<bigint> = new Set(this.endpoints.map((e: Endpoint): bigint => e.cid).filter((c: bigint): boolean => c !== author));
    for (const cid of others) {
      const drop: number = this.dropPushes.get(cid) ?? 0;
      if (drop > 0 && 'DocumentUpdated' in response) { this.dropPushes.set(cid, drop - 1); continue; }
      this.toCid(cid, { kind: 'response', response });
    }
  }

  private toCid(cid: bigint, delivery: Delivery): void {
    for (const to of this.endpoints.filter((e: Endpoint): boolean => e.cid === cid)) this.inbox.push({ to, delivery });
  }
}
