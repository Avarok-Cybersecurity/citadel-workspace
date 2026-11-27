/**
 * The workspace server as the app-page harness needs it, at the apps transport (AppsTransport):
 * the install's release (the committed synchronized.work manifest's exact bytes under a signature
 * the harness's stand-in check accepts, as app-zone-harness does: no wasm client, so no ML-DSA-65
 * here), its artifact in 64 KiB chunks (the committed module), and the server-side `storage.user`
 * KV over `AppsRequest::Call` (CBOR `HostCall` in, `HostReply` out), which outlives a remount as
 * the server's does. Every request is recorded by kind, and every `Call` by its group and op, so
 * the check can say the guest asked the server for nothing but its own storage.
 */
import type { AppListing, AppsRequest } from 'citadel-workspace-client-ts';
import { decodeCbor, encodeCbor, isCborMap, type CborMap, type Decoded } from '@/lib/citadel-apps/host/cbor';
import { readAppsAnswer, type AppsAnswer } from '@/lib/citadel-apps/wire/apps-answer';
import type { AppsTransport } from '@/lib/workspace-service/apps-operations';

export interface ServerRecord {
  /** `GetRelease`, `FetchArtifact`, `Call Storage/KvGet`, ... in order. */
  readonly requests: string[];
}

export interface HarnessServer {
  readonly transport: AppsTransport;
  readonly record: ServerRecord;
}

export interface Release {
  readonly installId: string;
  readonly manifestBytes: Uint8Array;
  readonly signatureHex: string;
  readonly wasm: Uint8Array;
}

const CHUNK: number = 64 * 1024;

/** One `HostCall`'s group, op and arguments, or null when it is not one. */
function callOf(bytes: Uint8Array): { group: string; op: string; args: CborMap } | null {
  const d: Decoded = decodeCbor(bytes);
  if (!d.ok || !isCborMap(d.value)) return null;
  const group: string | undefined = Object.keys(d.value)[0];
  const inner: unknown = group === undefined ? undefined : d.value[group];
  if (!isCborMap(inner)) return null;
  const op: string | undefined = Object.keys(inner)[0];
  const args: unknown = op === undefined ? undefined : inner[op];
  return op !== undefined && isCborMap(args) ? { group, op, args } : null;
}

export function harnessServer(release: Release): HarnessServer {
  const record: ServerRecord = { requests: [] };
  /** `storage.user` for this one member and install: the server binds the namespace, so a key is all it takes here. */
  const user: Map<string, Uint8Array> = new Map<string, Uint8Array>();

  const storage = (op: string, args: CborMap): unknown => {
    if (args.backend !== 'user') return { refused: 'ungranted' };
    const key: string = String(args.key);
    if (op === 'KvGet') return { ok: { value: user.get(key) ?? null } };
    if (op === 'KvSet' && args.value instanceof Uint8Array) {
      user.set(key, args.value.slice());
      return { ok: null };
    }
    return { refused: { unavailable: 'harness' } };
  };

  const answer = (r: AppsRequest): unknown => {
    if (typeof r === 'object' && 'GetRelease' in r) {
      record.requests.push('GetRelease');
      const current: AppListing = { source: { Global: { catalogue_version: 1n } }, manifest_bytes: release.manifestBytes, signature: release.signatureHex };
      return { Release: { install_id: release.installId, current, waiting_on: null } };
    }
    if (typeof r === 'object' && 'FetchArtifact' in r) {
      record.requests.push('FetchArtifact');
      const { index } = r.FetchArtifact;
      return { ArtifactChunk: { ...r.FetchArtifact, total_chunks: Math.ceil(release.wasm.byteLength / CHUNK), bytes: (release.wasm.slice(index * CHUNK, (index + 1) * CHUNK)) } };
    }
    if (typeof r === 'object' && 'Call' in r) {
      const call: { group: string; op: string; args: CborMap } | null = callOf(Uint8Array.from(r.Call.call));
      record.requests.push(call === null ? 'Call (unreadable)' : `Call ${call.group}/${call.op}`);
      const reply: unknown = call?.group === 'Storage' ? storage(call.op, call.args) : { refused: { unavailable: 'harness' } };
      return { CallReply: { reply: encodeCbor(reply) } };
    }
    record.requests.push(typeof r === 'string' ? r : Object.keys(r)[0] ?? '(empty)');
    return { Refused: 'ServerFeatureUnavailable' };
  };

  return {
    record,
    transport: {
      request: async (r: AppsRequest, isOurs: (a: AppsAnswer) => boolean): Promise<AppsAnswer> => {
        const a: AppsAnswer = readAppsAnswer(answer(r));
        if (!isOurs(a)) throw new Error(`the harness answer ${a.kind} was not taken`);
        return a;
      },
    },
  };
}
