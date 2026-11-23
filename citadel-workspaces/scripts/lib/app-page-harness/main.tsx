/**
 * An installed synchronized.work app as a node's page, on a bare page: the shipped AppPagePane
 * mounted through the real runtime (zone-runtime.ts `mountPage`, placement `{kind:'page'}`) with
 * the real worker, the committed module (apps/first-party/synchronized-work/wasm) and its committed
 * manifest's exact bytes; the real session port (agent-session-port.ts) over a scripted agent that
 * plays the transcript recorded from the real synchronized.work node (scripted-agent.ts); and the
 * real notify path (badgedNotifyPort, app-notices.ts `pageAppNotices`, the notification service,
 * its cards and opener: notices.tsx). Not part of the app: serve.mjs builds it on its own.
 *
 * Stood in, as app-zone-harness does and for its reasons: the server's answers (apps-server.ts)
 * and the ML-DSA-65 check (a SHA-256 over the same fields). The node is the transcript's: the app
 * is mounted with exactly its acting username, install id, node id and app id, because the
 * receipt that links it is the SHA3-256 of the bytes the app sends.
 *
 * `window.__page` is what check-app-page.mjs reads and drives: the agent's and the server's
 * records, the notifications, `remount()` (the tab reloaded: the pane goes and comes back while
 * the agent and the server keep what they hold) and `playTail(n)`.
 */
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import '@/index.css';
import type { AppInstall, AppListing } from 'citadel-workspace-client-ts';
import wasmUrl from '../../../../apps/first-party/synchronized-work/wasm/synchronized-work.wasm?url';
import manifestText from '../../../../apps/first-party/synchronized-work/manifest.json?raw';
import transcriptJson from './fixtures/joined.json';
import { AppPagePane } from '@/components/office/app-zone/AppPagePane';
import { AppZoneContext, zoneClaims, type AppZoneEnvironment } from '@/components/office/app-zone/app-zone-environment';
import { ConfirmDialogProvider } from '@/components/shared/confirm-dialog';
import { listedApps } from '@/lib/citadel-apps/listing-model';
import { pageAppNotices } from '@/lib/citadel-apps/app-notices';
import type { ConsentChoice } from '@/lib/citadel-apps/member-consent-types';
import { InstanceSlots } from '@/lib/citadel-apps/host/instance-slots';
import { STANDARD_HOST_POLICY } from '@/lib/citadel-apps/host/limits';
import { createAppZoneRuntime } from '@/lib/citadel-apps/runtime/zone-runtime';
import { OpenedFiles } from '@/lib/citadel-apps/runtime/opened-files';
import { animationFrames } from '@/lib/citadel-apps/runtime/zone-input';
import { pageZoneWatchers } from '@/lib/citadel-apps/runtime/zone-watchers';
import { pageArtifactVerifier, type AppSignatureCheck } from '@/lib/citadel-apps/runtime/verifier';
import { instanceManager } from '@/lib/multi-instance';
import { eventEmitter } from '@/lib/event-emitter';
import { harnessServer, type HarnessServer } from './apps-server';
import { scriptedAgent, type AgentRecord, type ScriptedAgent, type Transcript } from './scripted-agent';
import { NoticeList, NoticeOpener, type NoticeProbe } from './notices';
import { watchedSpawn, type WorkerProbe } from './worker-probe';

const transcript: Transcript = transcriptJson as Transcript;
const { acting_username: ME, install_id: INSTALL_ID, node_id: NODE_ID, app_id: APP_ID } = transcript.context;
/** The member's workspace session (`cid` on every AppSession* request): any signed-in session's; not the server's 7000. */
const MEMBER_CID: bigint = 11n;
/** Granted as an admin installing it would: what it requires, and its optional `notifications`. */
const GRANTED: AppInstall['granted'] = ['canvas', 'citadel.session', 'storage.user', 'notifications'];

const hex = (b: ArrayBuffer): string => Array.from(new Uint8Array(b), (x: number) => x.toString(16).padStart(2, '0')).join('');
const sha = async (b: Uint8Array): Promise<string> => hex(await crypto.subtle.digest('SHA-256', new Uint8Array(b)));

interface PageProbe {
  agent: AgentRecord;
  server: HarnessServer['record'];
  notices: NoticeProbe;
  worker: WorkerProbe;
  /** Each `apps:open-node` a card asked for, by node id. */
  openNode: string[];
  remount: () => void;
  playTail: (notifyTimes: number) => void;
}

async function start(): Promise<void> {
  const wasm: Uint8Array = new Uint8Array(await (await fetch(wasmUrl)).arrayBuffer());
  const manifestBytes: Uint8Array = new TextEncoder().encode(manifestText);
  const manifest: { version: string; publisher: { mldsa65_public_key: string } } = JSON.parse(manifestText) as { version: string; publisher: { mldsa65_public_key: string } };
  const key: string = manifest.publisher.mldsa65_public_key;
  const [mHash, wHash] = [await sha(manifestBytes), await sha(wasm)];
  const standIn = (m: string, w: string): Promise<string> => sha(new TextEncoder().encode(`${key}|${APP_ID}|${manifest.version}|${m}|${w}`));
  const check: AppSignatureCheck = async (i) => hex(i.signature.slice().buffer) === await standIn(i.manifestSha256Hex, i.wasmSha256Hex);
  const server: HarnessServer = harnessServer({ installId: INSTALL_ID, manifestBytes, signatureHex: await standIn(mHash, wHash), wasm });
  const agent: ScriptedAgent = scriptedAgent(transcript);
  const listing: AppListing = { source: { Global: { catalogue_version: 1n } }, manifest_bytes: Array.from(manifestBytes), signature: await standIn(mHash, wHash) };
  const install: AppInstall = {
    id: INSTALL_ID, app_id: APP_ID, version: manifest.version, manifest_sha256: mHash, artifact_sha256: wHash, pinned_publisher_key: key,
    scope: { Node: NODE_ID }, granted: GRANTED,
    details: { host_network_hosts: [], server_network_hosts: [], ihttp_routes: [], ihttp_call_targets: [], ihttp_p2p_routes: [], topics: [] },
    installed_by: ME, installed_at_ms: 1n, state: 'Active', previous: null, injected_header_into: [], source: { Global: { catalogue_version: 1n } },
  };
  const worker: WorkerProbe = { pendingEvents: 0, eventsDone: 0, notifyCalls: 0, frames: 0, fromWorker: {}, contexts: [] };
  // This tab acts as the member's session, as a sign-in sets it (getCurrentCid reads it first).
  instanceManager.setCid(MEMBER_CID);
  const verifier = pageArtifactVerifier(crypto.subtle, check);
  const runtime = createAppZoneRuntime({
    transport: server.transport, verifier, policy: STANDARD_HOST_POLICY, slots: new InstanceSlots(8),
    clock: { now: () => performance.now(), after: (ms: number, fire: () => void) => { const id: number = window.setTimeout(fire, ms); return () => window.clearTimeout(id); } },
    spawn: watchedSpawn(worker), frames: animationFrames, watch: pageZoneWatchers, newInstanceId: () => crypto.randomUUID(),
    audit: (): void => undefined, report: (what: string, detail: unknown): void => console.error(what, detail),
    offscreen: (c: HTMLCanvasElement) => c.transferControlToOffscreen(),
    portWorld: async () => ({
      transport: server.transport, agent: agent.link, agentSession: { cid: MEMBER_CID },
      log: { LogWrite: ({ level, message }) => { console.info(`[app ${level}] ${message}`); return { ok: null }; } },
      pushes: () => () => undefined, sha256Hex: verifier.sha256Hex, nowMs: () => Date.now(), every: () => () => undefined,
      // Nobody else is on this page's peer plane, and the install grants no P2P or topics.
      peerCid: () => null, peerForMe: () => null, topicRecord: { group: () => undefined, request: () => undefined },
      report: (what: string, detail: unknown): void => console.warn(what, detail), notices: pageAppNotices,
    }),
    pageUrl: () => window.location.href, locale: () => 'en', dpr: () => window.devicePixelRatio, theme: () => ({}),
    opened: new OpenedFiles(),
  });
  const env: AppZoneEnvironment = {
    nodeId: NODE_ID, me: ME, ancestors: [], mayInstall: 'yes', runtime,
    data: { listing: async () => ({ ok: true, value: listedApps([listing])[0] }), installs: async () => ({ ok: true, value: [install] }), setDisabledForMe: async (_i: string, d: boolean) => ({ ok: true, value: d }),
      // The install grants no P2P or topics, so nothing here is asked.
      setPeerConsentForMe: async (_i: string, c: ConsentChoice) => ({ ok: true, value: { ...c, at_ms: 1n } }) },
    // Nothing here presses "Try again": the data never fails to load.
    reload: (): void => undefined,
    openLink: () => undefined, linkUrl: () => '', copyText: async () => undefined, ...zoneClaims(),
  };

  const probe: PageProbe = {
    agent: agent.record, server: server.record, notices: { entries: [], location: '' }, worker, openNode: [],
    remount: () => undefined, playTail: agent.playTail,
  };
  (window as unknown as { __page: PageProbe }).__page = probe;
  eventEmitter.on<{ nodeId: string }>('apps:open-node', (t: { nodeId: string }): void => { probe.openNode.push(t.nodeId); });

  const root: HTMLElement | null = document.getElementById('root');
  if (root === null) throw new Error('the harness page has no #root');
  const page: Root = createRoot(root);
  const render = (mounted: boolean): void => page.render(
    <MemoryRouter initialEntries={['/workspace']}>
      <ConfirmDialogProvider>
        <NoticeOpener probe={probe.notices} />
        {/* Styled inline: Tailwind generates only the classes it finds under src/. The pane a node page fills (AppNodePage). */}
        <div data-testid="harness-node-pane" className="flex w-full flex-col overflow-hidden bg-background" style={{ height: '100dvh' }}>
          {mounted ? <AppZoneContext.Provider value={env}><AppPagePane page={{ app: APP_ID, installId: INSTALL_ID }} /></AppZoneContext.Provider> : null}
        </div>
        <NoticeList cid={MEMBER_CID.toString()} probe={probe.notices} />
      </ConfirmDialogProvider>
    </MemoryRouter>,
  );
  probe.remount = (): void => {
    render(false);
    // The next frame, as a reloaded page mounts its pane anew.
    requestAnimationFrame((): void => render(true));
  };
  render(true);
}

void start();
