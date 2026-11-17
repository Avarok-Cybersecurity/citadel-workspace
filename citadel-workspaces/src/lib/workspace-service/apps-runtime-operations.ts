/**
 * The apps requests a running app's host makes on the workspace protocol: its release and
 * artifact (to verify and instantiate), a server-backed host call (`Call`), and internal HTTP over
 * the server relay (`AdvertiseService`, `WithdrawService`, `IhttpSend`). Same transport, same strict answers, as
 * apps-operations.ts; each answer is taken for ours only when it names what we asked about.
 */
import type { AppListing, IhttpAddress } from 'citadel-workspace-client-ts';
import { ask, type AppsResult, type AppsTransport, type Of } from './apps-operations';

export interface Release {
  current: AppListing;
  waitingOn: AppListing | null;
}

export const getRelease = (t: AppsTransport, installId: string): Promise<AppsResult<Release>> =>
  ask(t, { GetRelease: { install_id: installId } }, 'release', (a: Of<'release'>) => a.installId === installId,
    (a: Of<'release'>): Release => ({ current: a.current, waitingOn: a.waitingOn }));

const fetchChunk = (t: AppsTransport, sha256: string, index: number): Promise<AppsResult<Of<'artifact-chunk'>>> =>
  ask(t, { FetchArtifact: { sha256, index } }, 'artifact-chunk', (a: Of<'artifact-chunk'>) => a.sha256 === sha256 && a.index === index, (a: Of<'artifact-chunk'>) => a);

/**
 * A stored artifact, chunk by chunk, refused as `Malformed` when the server's chunk count changes
 * between chunks, or the bytes pass `maxBytes` (checked as they arrive, before any is kept).
 */
export async function fetchArtifact(t: AppsTransport, sha256: string, maxBytes: number): Promise<AppsResult<Uint8Array>> {
  const parts: Uint8Array[] = [];
  let total: number | null = null;
  let size: number = 0;
  for (let index: number = 0; total === null || index < total; index++) {
    const chunk: AppsResult<Of<'artifact-chunk'>> = await fetchChunk(t, sha256, index);
    if (!chunk.ok) return chunk;
    if (chunk.value.totalChunks === 0 || (total !== null && chunk.value.totalChunks !== total)) return { ok: false, refusal: 'Malformed' };
    total = chunk.value.totalChunks;
    size += chunk.value.bytes.length;
    if (size > maxBytes) return { ok: false, refusal: 'Malformed' };
    parts.push(Uint8Array.from(chunk.value.bytes));
  }
  const out: Uint8Array = new Uint8Array(size);
  let at: number = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return { ok: true, value: out };
}

/** One server-backed host call: `call` is CBOR of the SDK's `HostCall`, the reply CBOR of its `HostReply`. */
export const callHost = (t: AppsTransport, installId: string, call: Uint8Array): Promise<AppsResult<Uint8Array>> =>
  ask(t, { Call: { install_id: installId, call: Array.from(call) } }, 'call-reply', (): boolean => true, (a: Of<'call-reply'>) => Uint8Array.from(a.reply));

/** `instance`: which running instance of the install serves; one closing withdraws only its own. */
export const advertiseService = (t: AppsTransport, installId: string, instance: string, routesDigest: string, untilMs: bigint): Promise<AppsResult<bigint>> =>
  ask(t, { AdvertiseService: { install_id: installId, instance, routes_digest: routesDigest, until_ms: untilMs } }, 'advertised', (): boolean => true, (a: Of<'advertised'>) => a.untilMs);

/** The instance stops serving; the answer counts the relayed streams that ended with it. */
export const withdrawService = (t: AppsTransport, installId: string, instance: string): Promise<AppsResult<number>> =>
  ask(t, { WithdrawService: { install_id: installId, instance } }, 'withdrawn', (a: Of<'withdrawn'>) => a.installId === installId, (a: Of<'withdrawn'>) => a.closedStreams);

/** `frame` is CBOR of `citadel_ihttp_types::IhttpFrame`. */
export const ihttpSend = (t: AppsTransport, fromInstallId: string, to: IhttpAddress, frame: Uint8Array): Promise<AppsResult<null>> =>
  ask(t, { IhttpSend: { from_install_id: fromInstallId, to, frame: Array.from(frame) } }, 'ihttp-sent', (): boolean => true, (): null => null);
