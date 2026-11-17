/**
 * The member-to-member planes of one running instance (p2p-demo-design §3, §7): what the install
 * holds for this member (granted, then their own consent), internal HTTP over P2P behind the
 * kernel's `AuthorizePeer`, routed with the relay by the transport router, and the app's topics.
 * Both P2P and topics need this tab's agent session; without one they are not here. The kernel's
 * held answers are dropped whenever an install or a member's answer changes.
 */
import type { AppInstall, AppLimits, Capability, PeerForMe } from 'citadel-workspace-client-ts';
import type { AppsTransport } from '@/lib/workspace-service/apps-operations';
import { authorizePeer, topicGroup } from '@/lib/workspace-service/apps-peer-operations';
import { readAppsAnswer, type AppsAnswer } from '../wire/apps-answer';
import { effectiveForMember } from '../consent-model';
import type { IhttpPort } from '../host/ports';
import type { HostPolicy } from '../host/limits';
import type { AgentLink } from './agent-link';
import { p2pIhttpPort } from './ihttp-p2p-port';
import { transportRouter } from './ihttp-transport-router';
import type { PlaneSeat } from './install-plane-registry';
import { PeerAuthority } from './peer-authority';
import { topicPort, type OwnedTopicPort } from './topic-port';

/** What the page tells the peer planes; page-runtime.ts gives the tab's own. */
export interface PeerWorld {
  readonly transport: AppsTransport;
  readonly agent: AgentLink;
  /** This tab's session CID and whether its agent serves apps; null when either is not so. */
  readonly agentSession: { readonly cid: bigint } | null;
  readonly pushes: (listener: (answer: unknown) => void) => () => void;
  readonly sha256Hex: (bytes: Uint8Array) => Promise<string>;
  readonly nowMs: () => number;
  readonly policy: HostPolicy;
  /** A registered peer's CID by username; null when this member has no P2P relationship with them. */
  readonly peerCid: (username: string) => bigint | null;
  /** This member's own answer for an install (ListInstalls `peer_for_me`); null: never answered. */
  readonly peerForMe: (installId: string) => PeerForMe | null;
  /** What the chat pipeline must skip (group-conversations/app-topic-groups.ts). */
  readonly topicRecord: { readonly group: (groupId: string) => void; readonly request: (requestId: string) => void };
  /** Something the page should hear about that no app call answers (a topic message the server refused). */
  readonly report: (what: string, detail: unknown) => void;
}

export interface PeerPorts {
  readonly held: ReadonlySet<Capability>;
  readonly ihttp: IhttpPort;
  readonly topic: OwnedTopicPort | null;
  /** Settles once what the instance held open with the agent is let go (topic-port.ts). */
  readonly stop: () => Promise<void>;
}

/**
 * A change that may move what the kernel would answer: drop every held answer. This member's own
 * answers arrive as themselves; another member's only as the server's content-free notices.
 */
const CHANGES: ReadonlySet<AppsAnswer['kind']> = new Set<AppsAnswer['kind']>([
  'installed', 'updated', 'uninstalled', 'consented', 'disabled-for-me', 'peer-consent', 'peer-blocked', 'installs-changed', 'peer-answers-changed',
]);

/** `scopeKey`: the scope key the install is addressed by, which every call's head names; `seat`: the instance's place on the page. */
export function peerPorts(install: AppInstall, scopeKey: string, limits: AppLimits, relay: IhttpPort, seat: PlaneSeat, w: PeerWorld): PeerPorts {
  const held: ReadonlySet<Capability> = new Set(effectiveForMember(install.granted, w.peerForMe(install.id)?.consent ?? null, false));
  const session: { readonly cid: bigint } | null = w.agentSession;
  if (session === null) return { held, ihttp: transportRouter({ relay, p2p: null, held, scopeKey }), topic: null, stop: async (): Promise<void> => undefined };
  const authority: PeerAuthority = new PeerAuthority((peerCid, direction) => authorizePeer(w.transport, install.id, peerCid, direction), w.nowMs, w.policy.peerAuthorizationsPerSecond);
  const stopEvicting: () => void = w.pushes((answer: unknown): void => { if (CHANGES.has(readAppsAnswer(answer).kind)) authority.evictAll(); });
  const p2p: IhttpPort = p2pIhttpPort({
    installId: install.id, seat, appId: install.app_id, cid: session.cid, agent: w.agent, peerCid: w.peerCid, authority, sha256Hex: w.sha256Hex,
    timeoutMs: w.policy.portTimeoutMs, p2pRoutes: install.details.ihttp_p2p_routes, maxRoutes: w.policy.ihttp.maxRoutes, maxPathBytes: w.policy.ihttp.maxPathBytes,
    noteRefusal: (peerCid: bigint, side: 'serve' | 'call', why: string): void =>
      w.report(`[apps] ${install.app_id} (install ${install.id}): refused to ${side === 'serve' ? 'serve peer' : 'call peer'} ${peerCid.toString()}`, why),
  });
  const topic: OwnedTopicPort | null = install.details.topics.length === 0 || limits.topics === undefined ? null : topicPort({
    cid: session.cid, seat, agent: w.agent, topics: install.details.topics, limits: limits.topics, authority, record: w.topicRecord,
    topicGroup: (name: string, claim: string | null) => topicGroup(w.transport, install.id, name, claim), timeoutMs: w.policy.portTimeoutMs,
    refused: (name: string, limit: string): void => w.report(`[apps] ${install.app_id} (install ${install.id}): the server refused a message to topic ${name}`, limit),
  });
  return {
    held, ihttp: transportRouter({ relay, p2p, held, scopeKey }), topic,
    stop: async (): Promise<void> => {
      stopEvicting();
      await topic?.closeAll();
    },
  };
}
