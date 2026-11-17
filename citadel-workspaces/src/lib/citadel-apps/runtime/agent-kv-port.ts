/**
 * `storage.local` (R4.5): the app's KV on this machine, in the local agent's per-account store
 * under the namespace (app id, scope key) taken from the install, never from the call
 * (`InternalServiceRequest::AppKv`). The agent offers no atomic batch, so `KvSetMany` here is
 * refused rather than done half-way. Every other backend is the server's (kernel-call-ports.ts).
 */
import type { OpArgs, OpReplies } from '../sdk/generated/AbiConstants';
import type { PortAnswer, Refused, StoragePort } from '../host/ports';
import { agentAsk, answering, bytesOf, type AgentLink, type AgentOutcome, type Json } from './agent-link';

export interface LocalKvTarget {
  readonly cid: bigint;
  readonly appId: string;
  readonly scopeKey: string;
  readonly timeoutMs: number;
}

type KvResult = { readonly ok: true; readonly result: unknown } | { readonly ok: false; readonly refusal: string };

const LIMITS: ReadonlySet<string> = new Set<string>(['Key', 'Value', 'Quota']);

function refusalOf(refusal: string): Refused {
  return LIMITS.has(refusal) ? { limit: refusal.toLowerCase() } : { unavailable: `local_${refusal.toLowerCase()}` };
}

function readKv(message: unknown, requestId: string): KvResult | undefined {
  const ok: Json | undefined = answering(message, 'AppKvResponse', requestId);
  if (ok !== undefined) return { ok: true, result: ok.result };
  const no: Json | undefined = answering(message, 'AppKvFailure', requestId);
  return no !== undefined && typeof no.refusal === 'string' ? { ok: false, refusal: no.refusal } : undefined;
}

const malformed: PortAnswer<never> = { refused: { unavailable: 'local_reply' } };

export function agentKvPort(link: AgentLink, target: LocalKvTarget): StoragePort {
  const run = async <T>(op: Json, accept: (result: unknown) => T | undefined): Promise<PortAnswer<T>> => {
    const asked: AgentOutcome<KvResult> = await agentAsk(link, (request_id: string): Json => ({
      AppKv: { request_id, cid: target.cid, namespace: { app_id: target.appId, scope_key: target.scopeKey }, op },
    }), readKv, target.timeoutMs);
    if (!asked.ok) return { refused: { unavailable: 'agent' } };
    if (!asked.value.ok) return { refused: refusalOf(asked.value.refusal) };
    const value: T | undefined = accept(asked.value.result);
    return value === undefined ? malformed : { ok: value };
  };
  const done = (r: unknown): null | undefined => (r === 'Done' ? null : undefined);
  return {
    KvGet: ({ key }: OpArgs['KvGet']) => run<OpReplies['KvGet']>({ Get: { key } }, (r: unknown) => {
      if (typeof r !== 'object' || r === null || !('Value' in r)) return undefined;
      const v: unknown = (r as { Value: unknown }).Value;
      if (v === null || v === undefined) return { value: null };
      const b: Uint8Array | null = bytesOf(v);
      return b === null ? undefined : { value: b };
    }),
    KvSet: ({ key, value }: OpArgs['KvSet']) => run<null>({ Set: { key, value: Array.from(value) } }, done),
    KvDelete: ({ key }: OpArgs['KvDelete']) => run<null>({ Delete: { key } }, done),
    KvList: ({ prefix, cursor }: OpArgs['KvList']) => run<OpReplies['KvList']>({ List: { prefix, after: cursor } }, (r: unknown) => {
      if (typeof r !== 'object' || r === null || !('Keys' in r)) return undefined;
      const k: { keys?: unknown; next?: unknown } = (r as { Keys: { keys?: unknown; next?: unknown } }).Keys;
      const keys: unknown = k.keys;
      const next: unknown = k.next ?? null;
      return Array.isArray(keys) && keys.every((x: unknown) => typeof x === 'string') && (next === null || typeof next === 'string')
        ? { keys: keys as string[], next: next as string | null } : undefined;
    }),
    KvSetMany: (): PortAnswer<null> => ({ refused: { unavailable: 'local_set_many' } }),
    KvListAuthored: (): PortAnswer<never> => ({ refused: { unavailable: 'local_authored' } }),
  };
}

/** One StoragePort: `local` to the agent (when there is one that serves apps), every other backend to the server. */
export function splitStorage(server: StoragePort, local: StoragePort | null): StoragePort {
  const pick = (backend: OpArgs['KvGet']['backend']): StoragePort | null => (backend === 'local' ? local : server);
  const none: PortAnswer<never> = { refused: { unavailable: 'local' } };
  return {
    KvGet: (a) => pick(a.backend)?.KvGet(a) ?? none,
    KvSet: (a) => pick(a.backend)?.KvSet(a) ?? none,
    KvSetMany: (a) => pick(a.backend)?.KvSetMany(a) ?? none,
    KvDelete: (a) => pick(a.backend)?.KvDelete(a) ?? none,
    KvList: (a) => pick(a.backend)?.KvList(a) ?? none,
    // Every author's keys on a node are the server's: the agent holds only this member's own.
    KvListAuthored: (a) => server.KvListAuthored(a),
  };
}
