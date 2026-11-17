/**
 * The page's app-zone runtime: createAppZoneRuntime with this tab's real dependencies. Loaded
 * lazily, with the first zone that has an app to run (app-zone/lazy-runtime.ts), so the sandbox
 * host and its worker never reach the landing page or a page without an app.
 *
 * The ML-DSA-65 check is the wasm client's (verifier.ts), loaded with the first app to verify.
 * Unwired, stated rather than defaulted: theme tokens beyond the few below.
 */
import { loadWasmModule } from 'citadel-workspace-client-ts';
import { eventEmitter } from '@/lib/event-emitter';
import { websocketService } from '@/lib/websocket-service';
import { agentCapabilities, type AgentCapabilities } from '@/lib/agent-conversations/capabilities';
import { getCurrentCid } from '@/lib/p2p/current-cid';
import type { AppsFailure } from '@/lib/workspace-service/apps-operations';
import { sessionAppsTransport } from '../apps-api';
import { InstanceSlots } from '../host/instance-slots';
import { STANDARD_HOST_POLICY, validateHostPolicy, type HostPolicy } from '../host/limits';
import type { DispatchClock } from '../host/dispatch';
import type { LogPort } from '../host/ports';
import { spawnAppWorker } from '../host/spawn-app-worker';
import type { ArtifactVerifierPort } from '../host/verify-artifact';
import type { AppZoneRuntime } from '@/components/office/app-zone/app-zone-environment';
import type { AgentLink } from './agent-link';
import type { PortWorld } from './host-ports';
import { pageArtifactVerifier, wasmAppSignatureCheck } from './verifier';
import type { ZoneAudit } from './zone-close';
import { animationFrames } from './zone-input';
import { createAppZoneRuntime } from './zone-runtime';
import { peerForMe } from '../peer-for-me';
import { markTopicGroup, markTopicRequest } from '@/lib/group-conversations/app-topic-groups';
import { p2pRegistrationService } from '@/lib/p2p-registration-service';
import { pageZoneWatchers } from './zone-watchers';

const policy: HostPolicy = validateHostPolicy(STANDARD_HOST_POLICY);
const verifier: ArtifactVerifierPort = pageArtifactVerifier(crypto.subtle, wasmAppSignatureCheck(loadWasmModule));

const clock: DispatchClock = {
  now: (): number => performance.now(),
  after: (ms: number, fire: () => void): (() => void) => {
    const id: ReturnType<typeof setTimeout> = setTimeout(fire, ms);
    return (): void => clearTimeout(id);
  },
};

const agent: AgentLink = {
  send: (request: Record<string, unknown>): Promise<void> => websocketService.sendMessage(request),
  listen: (handler: (message: unknown) => void): (() => void) => eventEmitter.on('websocket-message', handler),
  newRequestId: (): string => crypto.randomUUID(),
};

const log: LogPort = {
  LogWrite: ({ level, message }) => {
    console.info(`[app ${level}] ${message}`);
    return { ok: null };
  },
};

/** The session the agent ports act for: only when the agent says it serves apps and someone is signed in. */
async function agentSession(): Promise<{ readonly cid: bigint } | null> {
  const caps: AgentCapabilities | null = await agentCapabilities().catch((): null => null);
  if (caps === null || !caps.servesApps) return null;
  const cid: bigint | null = await getCurrentCid();
  return cid === null ? null : { cid };
}

const refusalName = (r: AppsFailure): string => (typeof r === 'string' ? r : Object.keys(r).join(','));

/**
 * The audit line of a zone that closed: which app, why, how it ended, and what its withdrawal
 * ended. A close that settled is routine (console.info, which production builds strip, see
 * vite.config.ts `pure`); one that had to be cut short or trapped is a warning, kept in production.
 */
function audit(line: ZoneAudit): void {
  const withdrawal: string = typeof line.withdrawal === 'string' ? line.withdrawal : 'ended' in line.withdrawal ? `${line.withdrawal.ended} stream(s) ended` : `refused (${refusalName(line.withdrawal.refused)})`;
  const text: string = `[apps] ${line.appId} (install ${line.installId}, zone ${line.zoneId}) closed: ${line.reason}, ${line.ending} in ${Math.round(line.ms)} ms, close result ${String(line.closeResult)}, service ${withdrawal}`;
  if (line.ending === 'grace-expired' || line.ending === 'trapped') console.warn(text);
  else console.info(text);
}

const THEME_TOKENS: readonly string[] = ['background', 'foreground', 'primary', 'primary-foreground', 'muted', 'muted-foreground', 'border', 'destructive'];

function theme(): Readonly<Record<string, string>> {
  const style: CSSStyleDeclaration = getComputedStyle(document.documentElement);
  const out: Record<string, string> = {};
  for (const token of THEME_TOKENS) {
    const value: string = style.getPropertyValue(`--${token}`).trim();
    if (value !== '') out[token] = `hsl(${value})`;
  }
  return out;
}

export const pageAppZoneRuntime: AppZoneRuntime = createAppZoneRuntime({
  transport: sessionAppsTransport, verifier, policy, clock,
  slots: new InstanceSlots(policy.maxLiveInstancesPerPage),
  spawn: spawnAppWorker,
  frames: animationFrames,
  watch: pageZoneWatchers,
  newInstanceId: (): string => crypto.randomUUID(),
  audit,
  report: (what: string, detail: unknown): void => console.error(what, detail),
  offscreen: (canvas: HTMLCanvasElement): OffscreenCanvas => canvas.transferControlToOffscreen(),
  portWorld: async (): Promise<Omit<PortWorld, 'policy'>> => ({
    transport: sessionAppsTransport, agent, agentSession: await agentSession(), log,
    pushes: (listener: (answer: unknown) => void): (() => void) => eventEmitter.on('workspace:apps', (event: { answer: unknown } | undefined): void => {
      if (event !== undefined) listener(event.answer);
    }),
    sha256Hex: verifier.sha256Hex,
    nowMs: (): number => Date.now(),
    peerCid: (username: string): bigint | null => p2pRegistrationService.getPeers().registeredPeers.find((p: { username: string }) => p.username === username)?.cid ?? null,
    peerForMe,
    topicRecord: { group: markTopicGroup, request: markTopicRequest },
    report: (what: string, detail: unknown): void => console.warn(what, detail),
    every: (ms: number, fire: () => void): (() => void) => {
      const id: ReturnType<typeof setInterval> = setInterval(fire, ms);
      return (): void => clearInterval(id);
    },
  }),
  pageUrl: (): string => window.location.href,
  locale: (): string => navigator.language,
  dpr: (): number => window.devicePixelRatio,
  theme,
});
