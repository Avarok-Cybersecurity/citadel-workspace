/**
 * TEST HELPER: the app-zone runtime against a contract fake of the kernel's runtime requests
 * (GetRelease, FetchArtifact in chunks, Call), whose raw answers go through the production reader,
 * and the production worker host in-process (host/__tests__/in-process.ts). The one stand-in in
 * the trust path is the signature check (fake-verifier.ts): ML-DSA-65 lives in the Rust wasm
 * client, which exports no app-signature check yet. Real SHA-256 throughout.
 */
import type { AppInstall, AppListing, AppsRequest } from 'citadel-workspace-client-ts';
import type { AppsTransport } from '@/lib/workspace-service/apps-operations';
import { readAppsAnswer, type AppsAnswer } from '@/lib/citadel-apps/wire/apps-answer';
import { installOf, manifestJson, type ManifestChanges } from '@/test/app-manifests';
import { readManifestBytes, type ManifestReading } from '@/lib/citadel-apps/manifest/manifest-rules';
import { decodeCbor, encodeCbor } from '../../host/cbor';
import { STANDARD_HOST_POLICY } from '../../host/limits';
import { InstanceSlots } from '../../host/instance-slots';
import type { HostChannel, ToWorker } from '../../host/worker-protocol';
import type { ArtifactVerifierPort } from '../../host/verify-artifact';
import { appModule, callGroup, type AppModuleOptions } from '../../host/__tests__/app-fixtures';
import { fakeSign, fakeVerifier, sha256Hex } from '../../host/__tests__/fake-verifier';
import { inProcess, realClock, type InProcess } from '../../host/__tests__/in-process';
import type { AgentLink } from '../agent-link';
import type { ZoneAudit } from '../zone-close';
import { createAppZoneRuntime } from '../zone-runtime';
import type { ZoneRuntimeDeps } from '../mount-steps';
import { fakeWatchers, type FakeWatchers } from './fake-watchers';
import type { AppTabMount, AppZoneMount, AppZoneRuntime, ZoneHost } from '@/components/office/app-zone/app-zone-environment';

export const APP_ID: string = 'com.acme.kanban';
const KV_ARGS: Uint8Array = encodeCbor({ backend: 'user', key: 'k' });
const KV_AT: number = 1024;

/** app_init asks storage KvGet {user, k} once and returns 0; its reply arrives later as reply_ready. */
export function kvAtInit(): Uint8Array {
  const base: AppModuleOptions = { groups: ['storage'] };
  return appModule({ ...base, init: [...callGroup(base, 'storage', 1, KV_AT, KV_ARGS.byteLength), 0x41, 0x00], data: [{ offset: KV_AT, bytes: KV_ARGS }] });
}

export interface Release {
  listing: AppListing;
  install: AppInstall;
  wasm: Uint8Array;
}

/**
 * A signed release of `wasm` and the install that pinned it (granted: `granted`). `changes` are
 * made to the shared base manifest, whose surfaces are `canvas_pane` and `md_zone`: none, for a
 * test about zones.
 */
export function release(wasm: Uint8Array, granted: AppInstall['granted'], changes: ManifestChanges = {}): Release {
  const m: Record<string, unknown> = manifestJson({ ...changes, id: APP_ID, name: 'Kanban', version: '1.4.0' });
  m.artifact = { ...(m.artifact as Record<string, unknown>), sha256: sha256Hex(wasm), bytes: wasm.byteLength };
  const manifestBytes: Uint8Array = new TextEncoder().encode(JSON.stringify(m));
  const key: string = (m.publisher as { mldsa65_public_key: string }).mldsa65_public_key;
  const signature: string = Buffer.from(fakeSign(key, APP_ID, '1.4.0', sha256Hex(manifestBytes), sha256Hex(wasm))).toString('hex');
  return {
    wasm,
    listing: { source: { Global: { catalogue_version: 1n } }, manifest_bytes: Array.from(manifestBytes), signature },
    install: installOf(APP_ID, 'Workspace', { id: 'inst-1', granted, manifest_sha256: sha256Hex(manifestBytes), artifact_sha256: sha256Hex(wasm), pinned_publisher_key: key }),
  };
}

export const CHUNK: number = 100;

/** The kernel's runtime answers for one release; `served` is what FetchArtifact hands out. */
export class FakeRuntimeKernel implements AppsTransport {
  readonly requests: AppsRequest[] = [];
  readonly calls: unknown[] = [];
  served: Uint8Array;
  private gate: Promise<void> | null = null;
  private release_: (() => void) | null = null;

  constructor(readonly rel: Release) {
    this.served = rel.wasm;
  }

  pause(): void { this.gate = new Promise<void>((r: () => void) => { this.release_ = r; }); }
  resume(): void { this.release_?.(); this.gate = null; }

  async request(request: AppsRequest, isOurs: (answer: AppsAnswer) => boolean): Promise<AppsAnswer> {
    this.requests.push(request);
    if (this.gate !== null) await this.gate;
    const answer: AppsAnswer = readAppsAnswer(this.raw(request));
    if (!isOurs(answer)) throw new Error(`not taken: ${answer.kind}`);
    return answer;
  }

  private raw(request: AppsRequest): unknown {
    if (typeof request !== 'object') return { Refused: 'Policy' };
    if ('GetRelease' in request) return request.GetRelease.install_id === this.rel.install.id ? { Release: { install_id: this.rel.install.id, current: this.rel.listing, waiting_on: null } } : { Refused: 'Unavailable' };
    if ('FetchArtifact' in request) {
      const total: number = Math.ceil(this.served.byteLength / CHUNK);
      const { sha256, index } = request.FetchArtifact;
      return { ArtifactChunk: { sha256, index, total_chunks: total, bytes: Array.from(this.served.slice(index * CHUNK, (index + 1) * CHUNK)) } };
    }
    if ('Call' in request) {
      const call: ReturnType<typeof decodeCbor> = decodeCbor(Uint8Array.from(request.Call.call));
      this.calls.push({ install_id: request.Call.install_id, call: call.ok ? call.value : 'undecodable' });
      return { CallReply: { reply: Array.from(encodeCbor({ ok: { value: Uint8Array.from([7]) } })) } };
    }
    return { Refused: 'ServerFeatureUnavailable' };
  }
}

export const quietAgent: AgentLink = { send: async (): Promise<void> => undefined, listen: () => (): void => undefined, newRequestId: () => 'r' };

export interface Rig {
  runtime: AppZoneRuntime;
  spawned: () => number;
  close: () => void;
  watch: FakeWatchers;
  terminated: () => number;
  /** Every message the page posted to an instance's worker, in order. */
  sent: ToWorker[];
  audits: ZoneAudit[];
  reports: string[];
  /** A server push, as the page's transport delivers one, to every port listening. */
  push: (answer: unknown) => void;
}

export function rig(kernel: FakeRuntimeKernel, over: Partial<ZoneRuntimeDeps> = {}, verifier: ArtifactVerifierPort = fakeVerifier): Rig {
  const worker: InProcess = inProcess();
  let spawned: number = 0;
  let instances: number = 0;
  const watch: FakeWatchers = fakeWatchers();
  const audits: ZoneAudit[] = [];
  const sent: ToWorker[] = [];
  const reports: string[] = [];
  const listeners: Set<(answer: unknown) => void> = new Set<(answer: unknown) => void>();
  const runtime: AppZoneRuntime = createAppZoneRuntime({
    watch, newInstanceId: (): string => `zone-${++instances}`,
    audit: (line: ZoneAudit): void => { audits.push(line); },
    report: (what: string): void => { reports.push(what); },
    transport: kernel, verifier, policy: STANDARD_HOST_POLICY, slots: new InstanceSlots(8), clock: realClock,
    spawn: (): HostChannel => {
      spawned++;
      const channel: HostChannel = worker.spawn();
      return {
        postMessage: (m: ToWorker, transfer: Transferable[]): void => { sent.push(m); channel.postMessage(m, transfer); },
        addEventListener: (type: 'message', listener: (event: MessageEvent<unknown>) => void): void => channel.addEventListener(type, listener),
        terminate: (): void => channel.terminate(),
      };
    },
    frames: () => (): void => undefined,
    // The in-process worker draws nothing (its surfaceOf answers null), so any clonable stands in for the bitmap.
    offscreen: (): OffscreenCanvas => ({}) as OffscreenCanvas,
    portWorld: async () => ({
      transport: kernel, agent: quietAgent, agentSession: null, log: { LogWrite: () => ({ ok: null }) },
      pushes: (l: (answer: unknown) => void) => { listeners.add(l); return (): void => { listeners.delete(l); }; }, sha256Hex: async (b: Uint8Array): Promise<string> => sha256Hex(b),
      nowMs: (): number => Date.now(), every: () => (): void => undefined,
      // agentSession is null, so the peer plane is absent; these are never asked.
      peerCid: () => null, peerForMe: () => null, topicRecord: { group: () => undefined, request: () => undefined }, report: (what: string): void => { reports.push(what); },
    }),
    pageUrl: (): string => 'https://work.example/workspace', locale: (): string => 'en', dpr: (): number => 2, theme: () => ({}),
    ...over,
  });
  const push = (answer: unknown): void => [...listeners].forEach((l: (answer: unknown) => void) => l(answer));
  return { runtime, spawned: () => spawned, close: () => worker.close(), watch, terminated: () => worker.terminated(), sent, audits, reports, push };
}

export function zoneOf(r: Release): AppZoneMount {
  const reading: ManifestReading = readManifestBytes(Uint8Array.from(r.listing.manifest_bytes));
  if (!reading.ok) throw new Error(`the rig's manifest does not read: ${reading.field}`);
  return { install: r.install, manifest: reading.manifest, zoneId: 'board', nodeId: 'n-1', me: 'alice', height: 240 };
}

/** The release as an app tab: the tab its node names it by, on node n-1, for alice. */
export function tabOf(r: Release): AppTabMount {
  const { install, manifest, nodeId, me } = zoneOf(r);
  return { install, manifest, tabId: 'calendar', nodeId, me };
}

/**
 * A host element `width` by `height` CSS px (jsdom lays nothing out). A zone's tests give only the
 * width: its height is the author's 240, which is what the zone's host is laid out at.
 */
export function hostOf(width: number, height: number = 240): HTMLDivElement {
  const host: HTMLDivElement = document.createElement('div');
  host.getBoundingClientRect = (): DOMRect => ({ x: 0, y: 0, left: 0, top: 0, right: width, bottom: height, width, height, toJSON: () => ({}) });
  document.body.append(host);
  return host;
}

/** The zone's two slots, as AppZone.tsx renders them: the toolbar's, then the canvas host. */
export function slotsOf(host: HTMLDivElement): ZoneHost {
  const toolbar: HTMLDivElement = document.createElement('div');
  host.before(toolbar);
  return { canvas: host, toolbar };
}
