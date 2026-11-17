/**
 * Streamed host fetches (`HostFetchOpen` / `NetStreamRead` / `NetStreamClose`) over the agent's
 * `AppFetch { stream: true }`: the head, then body chunks the agent sends only against credit. The
 * agent starts with the initial credit internal HTTP uses; this grants one more (`AppFetchCredit`)
 * each time the app has read a whole chunk, so at most that many chunks wait here, and a slow app
 * holds the upstream read back instead of filling memory. Closing cancels (`AppFetchCancel`).
 */
import type { HttpRequest } from '../sdk/generated/HttpRequest';
import type { OpReplies } from '../sdk/generated/AbiConstants';
import type { PortAnswer, Refused } from '../host/ports';
import { answering, bytesOf, type AgentLink, type Json } from './agent-link';
import { appFetchRequest, fetchRefusal, headersOf, type HostFetchTarget } from './agent-fetch-wire';

/** Streams one instance may hold open at once. */
export const MAX_OPEN_FETCH_STREAMS: number = 8;

interface Stream {
  readonly fetchId: string;
  readonly chunks: Uint8Array[];
  ended: boolean;
  failed: Refused | null;
  wake: (() => void) | null;
  readonly stop: () => void;
}

export class FetchStreams {
  private nextId: number = 0;
  private readonly streams: Map<number, Stream> = new Map<number, Stream>();

  constructor(private readonly link: AgentLink, private readonly target: HostFetchTarget) {}

  open(request: HttpRequest): Promise<PortAnswer<OpReplies['HostFetchOpen']>> {
    if (this.streams.size >= MAX_OPEN_FETCH_STREAMS) return Promise.resolve({ refused: { limit: 'streams' } });
    const id: number = ++this.nextId;
    const fetchId: string = this.link.newRequestId();
    return new Promise<PortAnswer<OpReplies['HostFetchOpen']>>((resolve: (a: PortAnswer<OpReplies['HostFetchOpen']>) => void): void => {
      let headed: boolean = false;
      const settle = (a: PortAnswer<OpReplies['HostFetchOpen']>): void => {
        if (headed) return;
        headed = true;
        clearTimeout(timer);
        if ('refused' in a) this.drop(id);
        resolve(a);
      };
      const stream: Stream = {
        fetchId, chunks: [], ended: false, failed: null, wake: null,
        stop: this.link.listen((message: unknown): void => {
          const head: Json | undefined = answering(message, 'AppFetchStreamHead', fetchId);
          const headers: [string, string][] | null = head === undefined ? null : headersOf(head.headers);
          if (head !== undefined) settle(headers !== null && typeof head.status === 'number' ? { ok: { stream: id, status: head.status, headers } } : { refused: { unavailable: 'agent_reply' } });
          const chunk: Json | undefined = answering(message, 'AppFetchStreamChunk', fetchId);
          const bytes: Uint8Array | null = chunk === undefined ? null : bytesOf(chunk.bytes);
          if (bytes !== null) stream.chunks.push(bytes);
          if (answering(message, 'AppFetchStreamEnd', fetchId) !== undefined) stream.ended = true;
          const failure: Json | undefined = answering(message, 'AppFetchFailure', fetchId);
          if (failure !== undefined) {
            stream.failed = fetchRefusal(failure.refusal);
            settle({ refused: stream.failed });
          }
          stream.wake?.();
        }),
      };
      this.streams.set(id, stream);
      const timer: ReturnType<typeof setTimeout> = setTimeout((): void => settle({ refused: { unavailable: 'agent' } }), this.target.timeoutMs);
      this.link.send(appFetchRequest(this.target, request, true)(fetchId)).catch((): void => settle({ refused: { unavailable: 'agent' } }));
    });
  }

  async read(id: number, max: number): Promise<PortAnswer<OpReplies['NetStreamRead']>> {
    const s: Stream | undefined = this.streams.get(id);
    if (s === undefined) return { refused: { policy: 'unknown_stream' } };
    if (s.chunks.length === 0 && !s.ended && s.failed === null) {
      const arrived: boolean = await new Promise<boolean>((resolve: (v: boolean) => void): void => {
        const timer: ReturnType<typeof setTimeout> = setTimeout((): void => { s.wake = null; resolve(false); }, this.target.timeoutMs);
        s.wake = (): void => { clearTimeout(timer); s.wake = null; resolve(true); };
      });
      if (!arrived) return { refused: { unavailable: 'agent' } };
    }
    if (s.failed !== null) return { refused: s.failed };
    const head: Uint8Array | undefined = s.chunks[0];
    if (head === undefined) return { ok: { bytes: new Uint8Array(0), end: true } };
    const take: number = Math.max(0, Math.min(max, head.byteLength));
    const bytes: Uint8Array = head.slice(0, take);
    if (take >= head.byteLength) {
      s.chunks.shift();
      this.credit(s);
    } else s.chunks[0] = head.slice(take);
    return { ok: { bytes, end: s.ended && s.chunks.length === 0 } };
  }

  close(id: number): PortAnswer<null> {
    const s: Stream | undefined = this.streams.get(id);
    if (s === undefined) return { ok: null };
    if (!s.ended && s.failed === null) this.control('AppFetchCancel', { fetch_id: s.fetchId });
    this.drop(id);
    return { ok: null };
  }

  closeAll(): void {
    for (const id of [...this.streams.keys()]) this.close(id);
  }

  private credit(s: Stream): void {
    if (!s.ended && s.failed === null) this.control('AppFetchCredit', { fetch_id: s.fetchId, n: 1 });
  }

  private control(variant: 'AppFetchCredit' | 'AppFetchCancel', fields: Json): void {
    // Answered with nothing; a lost control shows up as the stream's own timeout, not here.
    this.link.send({ [variant]: { request_id: this.link.newRequestId(), cid: this.target.cid, ...fields } }).catch((): void => undefined);
  }

  private drop(id: number): void {
    this.streams.get(id)?.stop();
    this.streams.delete(id);
  }
}
