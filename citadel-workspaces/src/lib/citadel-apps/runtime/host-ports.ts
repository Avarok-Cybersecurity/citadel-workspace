/**
 * The ports one running instance gets, bound to its install: server-side storage, blobs, files and
 * egress over `AppsRequest::Call`; `storage.local` and host egress through the local agent, only
 * when this tab's agent says it serves apps (`apps` in its greeting) and a session is signed in;
 * internal HTTP over the server relay and, with an agent session, over P2P (peer-ports.ts), with
 * the app's topics; `citadel.session` through the agent (agent-session-port.ts); the zone's own events and ui ports (zone-runtime.ts); the page log;
 * with `notifications` held, the page's notification list, opening the node the instance is on (first-party-ports.ts). A port left out answers
 * `{refused: {unavailable: <port>}}` (host/ports.ts), which is what "not here" means to an app.
 */
import type { AppInstall, AppLimits, AppManifest, Capability, CapabilityRequest } from 'citadel-workspace-client-ts';
import type { AppsResult } from '@/lib/workspace-service/apps-operations';
import { advertiseService, callHost, ihttpSend, withdrawService } from '@/lib/workspace-service/apps-runtime-operations';
import type { EventsPort, HostNetPort, HostPorts, LogPort, NotifyPort, StoragePort, UiPort } from '../host/ports';
import { badgedNotifyPort, type NoticeOrigin, type NoticeSink } from './first-party-ports';
import { onStorageChanged } from './storage-changed';
import { toldAuthors, type ToldAuthors } from './told-authors';
import { agentKvPort, splitStorage } from './agent-kv-port';
import { agentFetchPort } from './agent-fetch-port';
import { agentSessionPort, type OwnedSessionPort } from './agent-session-port';
import { relayIhttpPort, type RelayIhttpPort } from './ihttp-relay-port';
import { serverBlob, serverFiles, serverNet, serverStorage, type HostCaller } from './kernel-call-ports';
import type { PlaneSeat } from './install-plane-registry';
import { peerPorts, type PeerPorts, type PeerWorld } from './peer-ports';

/** The peer world (transport, agent and its session, pushes, clock, policy, ...) and the rest the ports need. */
export interface PortWorld extends PeerWorld {
  readonly every: (ms: number, fire: () => void) => () => void;
  readonly log: LogPort;
  /** Where a held `notifications` call lands: the page's list (app-notices.ts). */
  readonly notices: NoticeSink;
}

export interface BoundPorts {
  readonly ports: HostPorts;
  /** What the instance may do for this member: the install's grant less what they did not consent to. */
  readonly held: ReadonlySet<Capability>;
  /** Ends the instance's advertisement (ihttp-relay-port.ts); null when it never served. */
  readonly withdraw: () => Promise<AppsResult<number> | null>;
  /** Drops what the ports hold open (host egress streams, topics), settling once the agent let go. */
  readonly stop: () => Promise<void>;
}

/** The ports a zone owns: its input (zone-input.ts) and its toolbar (ui-port.ts). A glue tab has neither (null). */
export interface ZonePorts {
  readonly events: EventsPort;
  readonly ui: UiPort;
}

/**
 * What `citadel.session` needs beyond the install: the manifest's `servers` for it and who is
 * acting. Null for an app that does not ask for it, and for a glue tab, which is given none.
 */
export interface SessionBinding {
  readonly servers: readonly string[];
  readonly actingUsername: string;
}

/** The binding the manifest asks for: its `citadel.session` servers, acted on by `actingUsername`. */
export function sessionBindingOf(manifest: AppManifest, actingUsername: string): SessionBinding | null {
  const servers: string[] | undefined = manifest.capabilities.find((r: CapabilityRequest) => r.cap === 'citadel.session')?.servers;
  return servers === undefined ? null : { servers, actingUsername };
}

/** `instance`: this running instance's name, which its advertisement is held under; `seat`: its place on the page. */
/** `limits`: the release's manifest limits (its topics' sizes and rates, its sessions'); `origin`: the app and the node it is mounted on. */
export function hostPortsFor(install: AppInstall, limits: AppLimits, instance: string, scopeKey: string, zone: ZonePorts | null, seat: PlaneSeat, w: PortWorld, sessionBinding: SessionBinding | null, origin: NoticeOrigin): BoundPorts {
  const call: HostCaller = (bytes: Uint8Array) => callHost(w.transport, install.id, bytes);
  const agentSession: { readonly cid: bigint } | null = w.agentSession;
  const local: StoragePort | null = agentSession === null ? null : agentKvPort(w.agent, { cid: agentSession.cid, appId: install.app_id, scopeKey, timeoutMs: w.policy.portTimeoutMs });
  const hostNet: (HostNetPort & { readonly closeAll: () => void }) | null = agentSession === null ? null : agentFetchPort(w.agent, {
    cid: agentSession.cid, appId: install.app_id, installId: install.id, timeoutMs: w.policy.hostNetTimeoutMs,
    grant: { hosts: install.details.host_network_hosts, private: install.granted.includes('net.host.private') },
  });
  const session: OwnedSessionPort | null = agentSession === null || sessionBinding === null || limits.session === undefined || !install.granted.includes('citadel.session') ? null : agentSessionPort(w.agent, {
    cid: agentSession.cid, appId: install.app_id, installId: install.id, actingUsername: sessionBinding.actingUsername,
    grant: { servers: sessionBinding.servers, limits: limits.session }, timeoutMs: w.policy.hostNetTimeoutMs, nowMs: w.nowMs, report: w.report,
  });
  const ihttp: RelayIhttpPort = relayIhttpPort({
    installId: install.id, seat, pushes: w.pushes, sha256Hex: w.sha256Hex, nowMs: w.nowMs, every: w.every,
    send: (to, frame) => ihttpSend(w.transport, install.id, to, frame),
    advertise: (digest, untilMs) => advertiseService(w.transport, install.id, instance, digest, untilMs),
    withdraw: () => withdrawService(w.transport, install.id, instance),
  });
  const peer: PeerPorts = peerPorts(install, scopeKey, limits, ihttp, seat, w);
  const told: ToldAuthors | null = peer.held.has('notifications') ? toldAuthors() : null;
  const stopTold: () => void = told === null ? (): void => undefined : onStorageChanged(w.pushes, install.id, (event): void => {
    if (typeof event === 'object' && 'storage_changed' in event) told.heard(event.storage_changed.backend, event.storage_changed.key);
  });
  const notify: NotifyPort | null = told === null ? null : badgedNotifyPort(origin, w.notices, told.authorOf);
  const ports: HostPorts = {
    storage: splitStorage(serverStorage(call), local), blob: serverBlob(call), storeFiles: serverFiles(call),
    serverNet: serverNet(call), ihttp: peer.ihttp, log: w.log,
    ...(zone === null ? {} : { events: zone.events, ui: zone.ui }),
    ...(hostNet === null ? {} : { hostNet }), ...(peer.topic === null ? {} : { topic: peer.topic }),
    ...(session === null ? {} : { session }), ...(notify === null ? {} : { notify }),
  };
  return {
    ports,
    held: peer.held,
    withdraw: ihttp.withdraw,
    stop: async (): Promise<void> => {
      stopTold();
      hostNet?.closeAll();
      session?.closeAll();
      await peer.stop();
      seat.detach();
    },
  };
}
