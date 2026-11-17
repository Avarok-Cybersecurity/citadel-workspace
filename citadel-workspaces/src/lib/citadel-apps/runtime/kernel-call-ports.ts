/**
 * The host ports the workspace server answers, over `AppsRequest::Call` (R4.5, R4.6): the
 * server-side KV backends (user, scope, node), blobs, the app's file store and server egress.
 * Each op is sent as the SDK's `HostCall` in CBOR and answered with its `HostReply` in CBOR; the
 * server binds the namespace from the install record, never from the arguments. A reply that is
 * not a HostReply, and every refusal of the request itself, is a refusal the app can read.
 */
import type { AppsFailure, AppsResult } from '@/lib/workspace-service/apps-operations';
import { decodeCbor, encodeCbor, type Decoded } from '../host/cbor';
import { isPortAnswer } from '../host/dispatch';
import type { BlobPort, PortAnswer, Refused, ServerNetPort, StoragePort, StoreFilesPort } from '../host/ports';
import type { HttpResponse } from '../sdk/generated/HttpResponse';

/** Sends one `HostCall` (CBOR) for this install; resolves with the reply bytes or why there were none. */
export type HostCaller = (call: Uint8Array) => Promise<AppsResult<Uint8Array>>;

/**
 * What the request's own refusal means to the app (the reply, when there is one, is the server's).
 * `NoHost` is the kernel's one answer for every internal-HTTP target it will not open a stream to,
 * so it stays one answer here: `{unavailable: "no_host"}`.
 */
export function refusedFor(failure: AppsFailure): Refused {
  if (typeof failure === 'object' && 'Ungranted' in failure) return 'ungranted';
  if (typeof failure === 'object' && 'Limit' in failure) return { limit: failure.Limit };
  if (failure === 'Policy') return { policy: 'server' };
  if (failure === 'NoHost') return { unavailable: 'no_host' };
  return { unavailable: 'server' };
}

export async function viaServer(call: HostCaller, group: 'Storage' | 'Net', op: string, args: object): Promise<PortAnswer> {
  const sent: AppsResult<Uint8Array> = await call(encodeCbor({ [group]: { [op]: args } }));
  if (!sent.ok) return { refused: refusedFor(sent.refusal) };
  const reply: Decoded = decodeCbor(sent.value);
  return reply.ok && isPortAnswer(reply.value) ? reply.value : { refused: { unavailable: 'server_reply' } };
}

type Answer<T> = Promise<PortAnswer<T>>;

/** The server-side KV backends; `local` is not the server's and is answered elsewhere (agent-kv-port.ts). */
export function serverStorage(call: HostCaller): StoragePort {
  const s = <T>(op: string, args: object): Answer<T> => viaServer(call, 'Storage', op, args) as Answer<T>;
  return {
    KvGet: (a) => s('KvGet', a), KvSet: (a) => s('KvSet', a), KvSetMany: (a) => s('KvSetMany', a),
    KvDelete: (a) => s('KvDelete', a), KvList: (a) => s('KvList', a), KvListAuthored: (a) => s('KvListAuthored', a),
  };
}

export function serverBlob(call: HostCaller): BlobPort {
  const s = <T>(op: string, args: object): Answer<T> => viaServer(call, 'Storage', op, args) as Answer<T>;
  return { BlobPut: (a) => s('BlobPut', a), BlobGet: (a) => s('BlobGet', a), BlobDelete: (a) => s('BlobDelete', a) };
}

export function serverFiles(call: HostCaller): StoreFilesPort {
  const s = <T>(op: string, args: object): Answer<T> => viaServer(call, 'Storage', op, args) as Answer<T>;
  return { StoreFileWrite: (a) => s('StoreFileWrite', a), StoreFileRead: (a) => s('StoreFileRead', a), StoreFileList: (a) => s('StoreFileList', a) };
}

export function serverNet(call: HostCaller): ServerNetPort {
  return { ServerFetch: (a) => viaServer(call, 'Net', 'ServerFetch', a) as Answer<HttpResponse> };
}
