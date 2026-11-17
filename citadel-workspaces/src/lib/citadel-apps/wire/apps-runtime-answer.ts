/**
 * The `AppsResponse` variants a running app's host reads, as strictly as apps-answer.ts reads the
 * marketplace's: a release to verify, an artifact chunk, a server host call's reply, an
 * advertisement's expiry, a withdrawal's receipt, a relayed frame's receipt, and a frame relayed to one of this person's
 * running apps. Anything not exactly one of these is not one of these.
 */
import type { AppListing, IhttpFrom } from 'citadel-workspace-client-ts';
import { exactly, isAppListing, isBytes, isString, isStrings, single } from './install-shape';

export type RuntimeAnswer =
  | { kind: 'release'; installId: string; current: AppListing; waitingOn: AppListing | null }
  | { kind: 'artifact-chunk'; sha256: string; index: number; totalChunks: number; bytes: number[] }
  /** CBOR of the SDK's `HostReply`, decoded by whoever made the call. */
  | { kind: 'call-reply'; reply: number[] }
  | { kind: 'advertised'; untilMs: bigint }
  | { kind: 'withdrawn'; installId: string; closedStreams: number }
  | { kind: 'ihttp-sent' }
  | { kind: 'ihttp-frame'; from: IhttpFrom; toInstallId: string; frame: number[] }
  /** An app wrote to a node this person may view: which install, which store, which keys; never a value. */
  | { kind: 'storage-changed'; installId: string; backend: NodeStore; keys: string[] };

/** The stores the server announces writes to: a node's, and one author's on a node. */
export type NodeStore = { node: { node_id: string } } | { node_authored: { node_id: string; author: string } };

const isU32 = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 0xffff_ffff;
const isU64 = (v: unknown): v is bigint => typeof v === 'bigint' && v >= 0n && v < 2n ** 64n;
// Undefined as well as null: an Option the wasm client hands over as `None` arrives undefined.
const optionalListing = (v: unknown): boolean => v === null || v === undefined || isAppListing(v);
const isNodeStore = (v: unknown): v is NodeStore =>
  single(v, 'node', (x: unknown) => exactly(x, { node_id: isString }))
  || single(v, 'node_authored', (x: unknown) => exactly(x, { node_id: isString, author: isString }));
const isFrom = (v: unknown): v is IhttpFrom => exactly(v, { username: isString, cid: isU64, app_id: isString, install_id: isString });

type Json = Record<string, unknown>;
const inner = (payload: unknown, name: string): Json => (payload as Record<string, Json>)[name];

export function readRuntimeAnswer(payload: unknown): RuntimeAnswer | null {
  if (payload === 'IhttpSent') return { kind: 'ihttp-sent' };
  if (single(payload, 'Release', (x: unknown) => exactly(x, { install_id: isString, current: isAppListing, waiting_on: optionalListing }))) {
    const r: Json = inner(payload, 'Release');
    return { kind: 'release', installId: r.install_id as string, current: r.current as AppListing, waitingOn: (r.waiting_on ?? null) as AppListing | null };
  }
  if (single(payload, 'ArtifactChunk', (x: unknown) => exactly(x, { sha256: isString, index: isU32, total_chunks: isU32, bytes: isBytes }))) {
    const c: Json = inner(payload, 'ArtifactChunk');
    return { kind: 'artifact-chunk', sha256: c.sha256 as string, index: c.index as number, totalChunks: c.total_chunks as number, bytes: c.bytes as number[] };
  }
  if (single(payload, 'CallReply', (x: unknown) => exactly(x, { reply: isBytes }))) return { kind: 'call-reply', reply: inner(payload, 'CallReply').reply as number[] };
  if (single(payload, 'Advertised', (x: unknown) => exactly(x, { until_ms: isU64 }))) return { kind: 'advertised', untilMs: inner(payload, 'Advertised').until_ms as bigint };
  if (single(payload, 'Withdrawn', (x: unknown) => exactly(x, { install_id: isString, closed_streams: isU32 }))) {
    const w: Json = inner(payload, 'Withdrawn');
    return { kind: 'withdrawn', installId: w.install_id as string, closedStreams: w.closed_streams as number };
  }
  if (single(payload, 'IhttpFrame', (x: unknown) => exactly(x, { from: isFrom, to_install_id: isString, frame: isBytes }))) {
    const f: Json = inner(payload, 'IhttpFrame');
    return { kind: 'ihttp-frame', from: f.from as IhttpFrom, toInstallId: f.to_install_id as string, frame: f.frame as number[] };
  }
  if (single(payload, 'StorageChanged', (x: unknown) => exactly(x, { install_id: isString, backend: isNodeStore, keys: isStrings }))) {
    const c: Json = inner(payload, 'StorageChanged');
    return { kind: 'storage-changed', installId: c.install_id as string, backend: c.backend as NodeStore, keys: c.keys as string[] };
  }
  return null;
}
