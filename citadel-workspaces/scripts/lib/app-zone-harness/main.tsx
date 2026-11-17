/**
 * The shipped app zone on a bare page: AppZone in the office's prose column, mounted through the
 * real runtime (zone-runtime.ts) with the real app worker, OffscreenCanvas and the SDK's real
 * `hello-canvas` fixture, which subscribes to pointer events, asks for frames and paints a blue
 * card inset 10 CSS px. Not part of the app: serve.mjs builds it on its own.
 *
 * Stood in, because a page has no workspace server here: the server's release and artifact
 * answers (from the fixture's bytes, through the production reader), and the ML-DSA-65 check,
 * which is the wasm client's and has no client to load here (a SHA-256 stand-in over the same
 * message fields).
 *
 * - `?mode=ok`: a release that verifies.
 * - `?mode=bad-signature`: the same release under a signature that does not.
 * - `?mode=unchecked`: the page's verifier when its check cannot load (wasmAppSignatureCheck).
 * - `?mode=lifecycle`: `ok`, with room below the zone to scroll it out of view, and `window.__zone`
 *   counting what the lifecycle must release: live workers (spawn wrapped), live frame loops and
 *   frames delivered (the frame loop wrapped), the audit lines, and an `unmount()` that removes
 *   the zone from the page as navigating away from it would.
 * - `?mode=tab`: the release, listing `node_tab`, as an app tab (AppTabPane, `mountPane`) in a
 *   panel 60% of the viewport tall, as a node pane's tab panel fills the pane.
 */
import { createRoot, type Root } from 'react-dom/client';
import '@/index.css';
import type { AppInstall, AppListing, AppsRequest } from 'citadel-workspace-client-ts';
import helloCanvasUrl from '../../../../apps/sdk-fixtures/wasm/hello-canvas.wasm?url';
import manifestCases from '../../../../apps/catalogue/fixtures/manifest-cases.json';
import { AppZone } from '@/components/office/app-zone/AppZone';
import { AppTabPane } from '@/components/office/app-zone/AppTabPane';
import { AppZoneContext, zoneClaims, type AppZoneEnvironment } from '@/components/office/app-zone/app-zone-environment';
import { listedApps } from '@/lib/citadel-apps/listing-model';
import { readAppsAnswer, type AppsAnswer } from '@/lib/citadel-apps/wire/apps-answer';
import type { AppsTransport } from '@/lib/workspace-service/apps-operations';
import { InstanceSlots } from '@/lib/citadel-apps/host/instance-slots';
import { STANDARD_HOST_POLICY } from '@/lib/citadel-apps/host/limits';
import { spawnAppWorker } from '@/lib/citadel-apps/host/spawn-app-worker';
import { createAppZoneRuntime } from '@/lib/citadel-apps/runtime/zone-runtime';
import { animationFrames, type FrameLoop } from '@/lib/citadel-apps/runtime/zone-input';
import { pageZoneWatchers } from '@/lib/citadel-apps/runtime/zone-watchers';
import type { ZoneAudit } from '@/lib/citadel-apps/runtime/zone-close';
import type { HostChannel } from '@/lib/citadel-apps/host/worker-protocol';
import { pageArtifactVerifier, wasmAppSignatureCheck, type AppSignatureCheck } from '@/lib/citadel-apps/runtime/verifier';

const mode: string = new URLSearchParams(window.location.search).get('mode') ?? 'ok';
const APP_ID: string = 'com.acme.kanban';
const VERSION: string = '1.4.0';
const hex = (b: ArrayBuffer): string => Array.from(new Uint8Array(b), (x: number) => x.toString(16).padStart(2, '0')).join('');
const sha = async (b: Uint8Array): Promise<string> => hex(await crypto.subtle.digest('SHA-256', new Uint8Array(b)));
const standIn = async (key: string, m: string, w: string): Promise<string> => sha(new TextEncoder().encode(`${key}|${APP_ID}|${VERSION}|${m}|${w}`));

/** What check-app-zone-geometry.mjs reads in `lifecycle` mode. */
interface ZoneProbe {
  workersLive: number;
  framesLive: number;
  frames: number;
  audits: ZoneAudit[];
  unmount: () => void;
}
const probe: ZoneProbe = { workersLive: 0, framesLive: 0, frames: 0, audits: [], unmount: () => undefined };
(window as unknown as { __zone: ZoneProbe }).__zone = probe;

const countedSpawn = (): HostChannel => {
  const worker: HostChannel = spawnAppWorker();
  probe.workersLive++;
  return {
    postMessage: (m, t) => worker.postMessage(m, t),
    addEventListener: (type, listener) => worker.addEventListener(type, listener),
    terminate: (): void => {
      probe.workersLive--;
      worker.terminate();
    },
  };
};
const countedFrames: FrameLoop = (tick) => {
  probe.framesLive++;
  const stop: () => void = animationFrames((dt: number): void => {
    probe.frames++;
    tick(dt);
  });
  return (): void => {
    probe.framesLive--;
    stop();
  };
};

const unloadable: AppSignatureCheck = wasmAppSignatureCheck(() => Promise.reject(new Error('the harness has no wasm client')));
const standInCheck: AppSignatureCheck = async (i) => hex(i.signature.slice().buffer) === await standIn(i.publicKeyHex, i.manifestSha256Hex, i.wasmSha256Hex);

async function start(): Promise<void> {
  const wasm: Uint8Array = new Uint8Array(await (await fetch(helloCanvasUrl)).arrayBuffer());
  const m: Record<string, unknown> = structuredClone((manifestCases as { base: Record<string, unknown> }).base);
  if (mode === 'tab') m.surfaces = ['node_tab'];
  m.capabilities = ['canvas', 'events', 'log'].map((cap: string) => ({ cap, why: `Needs ${cap}`, optional: false }));
  m.artifact = { ...(m.artifact as Record<string, unknown>), sha256: await sha(wasm), bytes: wasm.byteLength };
  const manifestBytes: Uint8Array = new TextEncoder().encode(JSON.stringify(m));
  const key: string = (m.publisher as { mldsa65_public_key: string }).mldsa65_public_key;
  const [mHash, wHash] = [await sha(manifestBytes), await sha(wasm)];
  const signature: string = mode === 'bad-signature' ? 'ab'.repeat(32) : await standIn(key, mHash, wHash);
  const listing: AppListing = { source: { Global: { catalogue_version: 1n } }, manifest_bytes: Array.from(manifestBytes), signature };
  const install: AppInstall = {
    id: 'inst-h', app_id: APP_ID, version: VERSION, manifest_sha256: mHash, artifact_sha256: wHash, pinned_publisher_key: key,
    scope: 'Workspace', granted: ['canvas', 'events', 'log'],
    details: { host_network_hosts: [], server_network_hosts: [], ihttp_routes: [], ihttp_call_targets: [], ihttp_p2p_routes: [], topics: [] },
    installed_by: 'alice', installed_at_ms: 1n, state: 'Active', previous: null, injected_header_into: [], source: { Global: { catalogue_version: 1n } },
  };
  const CHUNK: number = 64 * 1024;
  const server: AppsTransport = {
    request: async (r: AppsRequest, isOurs: (a: AppsAnswer) => boolean): Promise<AppsAnswer> => {
      const raw: unknown = typeof r === 'object' && 'GetRelease' in r ? { Release: { install_id: install.id, current: listing, waiting_on: null } }
        : typeof r === 'object' && 'FetchArtifact' in r
          ? { ArtifactChunk: { ...r.FetchArtifact, total_chunks: Math.ceil(wasm.byteLength / CHUNK), bytes: Array.from(wasm.slice(r.FetchArtifact.index * CHUNK, (r.FetchArtifact.index + 1) * CHUNK)) } }
          : { Refused: 'ServerFeatureUnavailable' };
      const a: AppsAnswer = readAppsAnswer(raw);
      if (!isOurs(a)) throw new Error(`the harness answer ${a.kind} was not taken`);
      return a;
    },
  };
  const verifier = pageArtifactVerifier(crypto.subtle, mode === 'unchecked' ? unloadable : standInCheck);
  const runtime = createAppZoneRuntime({
    transport: server, verifier, policy: STANDARD_HOST_POLICY, slots: new InstanceSlots(8),
    clock: { now: () => performance.now(), after: (ms: number, fire: () => void) => { const id: number = window.setTimeout(fire, ms); return () => window.clearTimeout(id); } },
    spawn: countedSpawn, frames: countedFrames, watch: pageZoneWatchers, newInstanceId: () => crypto.randomUUID(),
    audit: (line: ZoneAudit): void => { probe.audits.push(line); }, report: (what: string, detail: unknown): void => console.error(what, detail),
    offscreen: (c: HTMLCanvasElement) => c.transferControlToOffscreen(),
    portWorld: async () => ({
      transport: server, agent: { send: async () => undefined, listen: () => () => undefined, newRequestId: () => crypto.randomUUID() }, agentSession: null,
      log: { LogWrite: () => ({ ok: null }) }, pushes: () => () => undefined, sha256Hex: verifier.sha256Hex, nowMs: () => Date.now(), every: () => () => undefined,
      // No agent session here, so no peer plane: nobody to reach and no answer of one's own.
      peerCid: () => null, peerForMe: () => null, topicRecord: { group: () => undefined, request: () => undefined }, report: (what: string, detail: unknown): void => console.warn(what, detail),
    }),
    pageUrl: () => window.location.href, locale: () => 'en', dpr: () => window.devicePixelRatio, theme: () => ({}),
  });
  const env: AppZoneEnvironment = {
    nodeId: 'n-1', me: 'alice', ancestors: [], mayInstall: 'yes', runtime,
    data: { listing: async () => ({ ok: true, value: listedApps([listing])[0] }), installs: async () => ({ ok: true, value: [install] }), setDisabledForMe: async (_i: string, d: boolean) => ({ ok: true, value: d }) },
    openLink: () => undefined, linkUrl: () => '', copyText: async () => undefined, ...zoneClaims(),
  };
  const root: HTMLElement | null = document.getElementById('root');
  if (root === null) throw new Error('the harness page has no #root');
  const page: Root = createRoot(root);
  const render = (zone: boolean): void => page.render(mode === 'tab' ? (
    <AppZoneContext.Provider value={env}>
      <div data-testid="tab-panel" className="flex w-full flex-col" style={{ height: '60vh' }}>
        <AppTabPane appId={APP_ID} tabId="board" />
      </div>
    </AppZoneContext.Provider>
  ) : (
    <div className="px-6 lg:px-10 pt-8 pb-4 prose dark:prose-invert prose-sm md:prose-base lg:prose-lg max-w-4xl">
      <h1>Board</h1>
      {zone ? <AppZoneContext.Provider value={env}><AppZone app={APP_ID} zone="board" height={240} /></AppZoneContext.Provider> : null}
      {mode === 'lifecycle' ? <div data-testid="below-the-zone" style={{ height: '3000px' }} /> : null}
    </div>
  ));
  probe.unmount = (): void => render(false);
  render(true);
}

void start();
