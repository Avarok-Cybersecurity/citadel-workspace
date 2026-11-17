/**
 * The Compute Pool on a page, and what can be seen of its traffic.
 *
 * WHAT THE APP MUST LOG. The spec judges jobs by two `LogWrite` lines (info level) that the app
 * prints for each worker's outcome and for each finished job; ANSWER and JOB below are the one
 * statement of their shape. The via is the transport the answer actually came over, lower case,
 * and the note is `<n> chunk(s)` for an answer or the refusal's Debug form (`Unavailable("refused")`).
 *
 * WHAT THE WIRE SHOWS. A P2P frame leaves the page as the agent request `IhttpSend {cid, peer_cid,
 * frame}` and arrives as `IhttpFrameNotification {cid, peer_cid, ...}`; a relayed one travels inside
 * a workspace-protocol message and is neither. Counting both on the page's socket separates the
 * two planes without trusting the app's word for which it used.
 */
import type { Page, WebSocket } from 'playwright';
import { expect } from '@playwright/test';
import { createNodeViaProtocol, updateNodeViaProtocol, WORKSPACE_ROOT_SENTINEL, type CreateNodeResult, type DomainNode } from './tree-helpers.js';
import { revealNode } from './focused-tree.js';
import { COMPUTE_POOL_ID } from './apps-signing.js';
import type { ZoneLog } from './apps.js';

export const ANSWER: RegExp = /^\[app info\] answer from (\S+) via (p2p|relay): (.+)$/;
export const JOB: RegExp = /^\[app info\] job ([0-9a-f]+) done in (\d+) ms: (verified|wrong answer)$/;
export type Via = 'p2p' | 'relay';
export type AppAction = 'run-primes' | 'run-sha' | 'mode-prefer' | 'mode-p2p' | 'mode-relay';

const ZONE: string = 'pool';
const MOUNT_MS: number = 90_000;

/** An office whose page holds the pool's zone, created by `page`'s user (it needs EditTreeStructure and EditMdx). */
export async function placePoolZone(page: Page, office: string): Promise<string> {
  const made: CreateNodeResult = await createNodeViaProtocol(page, WORKSPACE_ROOT_SENTINEL, { Child: 'Office' }, office, 'Compute Pool spec');
  if (!made.success || made.nodeId === undefined) throw new Error(`office ${office} was not created: ${String(made.error)}`);
  const mdx: string = `# ${office}\n\n<AppZone app="${COMPUTE_POOL_ID}" zone="${ZONE}" height={360} />\n`;
  const node: DomainNode | null = await updateNodeViaProtocol(page, made.nodeId, { mdx_content: mdx });
  if (node === null) throw new Error(`office ${office} did not take its zone`);
  return made.nodeId;
}

/** Open the office and wait until the app runs in its zone (zone-surface.ts `data-app-state`). */
export async function openPoolZone(page: Page, office: string): Promise<void> {
  if ((await revealNode(page, office, 30_000)) === null) throw new Error(`office ${office} is not in this member's tree`);
  await expect(page.getByTestId('app-zone-host')).toHaveAttribute('data-app-state', 'running', { timeout: MOUNT_MS });
}

/**
 * Press one of the app's toolbar items (`ui::set_toolbar` in the app): the host draws each as a
 * button `[data-testid="app-toolbar-item"][data-item-id=<id>]` in the toolbar slot above the zone
 * (runtime/zone-toolbar.ts). The page holds the one zone, so its toolbar is the page's only one.
 */
export async function pressAppAction(page: Page, id: AppAction): Promise<void> {
  const item = page.getByTestId('app-zone-toolbar').locator(`[data-testid="app-toolbar-item"][data-item-id="${id}"]`);
  await expect(item).toBeVisible({ timeout: 30_000 });
  await item.click();
}

export interface Answer { readonly from: string; readonly via: Via; readonly note: string }
export interface JobRun { readonly answer: Answer | null; readonly verified: boolean | null }

/** A note that says the worker answered: `<n> chunk(s)` with n at least one. */
export const answered = (a: Answer | null): boolean => a !== null && /^[1-9]\d* chunk\(s\)$/.test(a.note);

/** Press `action` and read the answer from `peer`, then the job's end, as the app logs them. */
export async function runJob(page: Page, log: ZoneLog, action: 'run-primes' | 'run-sha', peer: string, timeoutMs: number): Promise<JobRun> {
  const from: number = log.lines.length;
  await pressAppAction(page, action);
  const peerAnswer: RegExp = new RegExp(`^\\[app info\\] answer from ${peer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} via (p2p|relay): (.+)$`);
  const a: RegExpExecArray | null = await log.find(peerAnswer, from, timeoutMs);
  const j: RegExpExecArray | null = await log.find(JOB, from, timeoutMs);
  return {
    answer: a === null ? null : { from: peer, via: a[1] as Via, note: a[2] },
    verified: j === null ? null : j[3] === 'verified',
  };
}

/**
 * Press `action` and wait for the job's end; whether `peer` answered any part of it. A member who
 * blocked this one hears none of its topic messages (kernel peer_rules.rs: a block refuses every
 * direction, topics too), so they never claim and are never called: the job is done without them.
 */
export async function runJobWithout(page: Page, log: ZoneLog, action: 'run-primes' | 'run-sha', peer: string, timeoutMs: number): Promise<{ readonly done: boolean; readonly peerAnswered: boolean }> {
  const from: number = log.lines.length;
  await pressAppAction(page, action);
  const j: RegExpExecArray | null = await log.find(JOB, from, timeoutMs);
  const prefix: string = `[app info] answer from ${peer} via `;
  return { done: j !== null && j[3] === 'verified', peerAnswered: log.lines.slice(from).some((l: string) => l.startsWith(prefix)) };
}

export interface WireCount {
  /** Agent `IhttpSend` requests this page sent to `peerCid`. */
  readonly sentTo: (peerCid: string) => number;
  /** `IhttpFrameNotification`s this page's socket received for the session `cid`. */
  readonly receivedFor: (cid: string) => number;
}

/** Count the P2P plane's frames on every socket this page opens, from now on. */
export function watchIhttpWire(page: Page): WireCount {
  const sent: string[] = [];
  const received: string[] = [];
  const text = (payload: string | Buffer): string => (typeof payload === 'string' ? payload : payload.toString('utf8'));
  page.on('websocket', (ws: WebSocket) => {
    // By regex: JSON.parse would round a u64 CID to the nearest double. A frame's bytes are a number list, so no braces inside.
    ws.on('framesent', ({ payload }: { payload: string | Buffer }) => {
      for (const m of text(payload).matchAll(/"IhttpSend":\{[^{}]*?"peer_cid":(\d+)/g)) sent.push(m[1]);
    });
    ws.on('framereceived', ({ payload }: { payload: string | Buffer }) => {
      for (const m of text(payload).matchAll(/"IhttpFrameNotification":\{[^{}]*?"cid":(\d+)/g)) received.push(m[1]);
    });
  });
  return {
    sentTo: (peerCid: string): number => sent.filter((c: string) => c === peerCid).length,
    receivedFor: (cid: string): number => received.filter((c: string) => c === cid).length,
  };
}

/** This tab's session CID, from the connection manager main.tsx exposes in development. */
export async function sessionCid(page: Page): Promise<string> {
  const cid: string | null = await page.evaluate(async (): Promise<string | null> => {
    const cm = (window as unknown as { __connectionManager?: { getTabSelectedSession: () => Promise<{ cid?: bigint } | null> } }).__connectionManager;
    const session: { cid?: bigint } | null = cm === undefined ? null : await cm.getTabSelectedSession();
    return session?.cid === undefined ? null : session.cid.toString();
  });
  if (cid === null) throw new Error('this tab has no selected session');
  return cid;
}

/**
 * Record, inside the tab, the recipient CID of every `IhttpFrameNotification` the tab's own event
 * bus delivers: what the multi-tab router handed THIS tab, after routing, as the p2p port hears it.
 */
export async function watchDeliveredFrames(page: Page): Promise<void> {
  await page.evaluate(async (): Promise<void> => {
    type Emitter = { on: (event: string, h: (m: unknown) => void) => () => void };
    const load = (url: string): Promise<unknown> => import(url);
    const { eventEmitter } = (await load('/src/lib/event-emitter.ts')) as { eventEmitter: Emitter };
    const seen: string[] = [];
    (window as unknown as { __appsSpecDelivered: string[] }).__appsSpecDelivered = seen;
    eventEmitter.on('websocket-message', (m: unknown): void => {
      const o: Record<string, unknown> | null = typeof m === 'object' && m !== null ? (m as Record<string, unknown>) : null;
      const inner: unknown = o === null ? null : (typeof o.Response === 'object' && o.Response !== null ? (o.Response as Record<string, unknown>) : o).IhttpFrameNotification;
      if (typeof inner === 'object' && inner !== null) seen.push(String((inner as { cid: unknown }).cid));
    });
  });
}

export async function deliveredFrames(page: Page): Promise<string[]> {
  return page.evaluate((): string[] => [...((window as unknown as { __appsSpecDelivered?: string[] }).__appsSpecDelivered ?? [])]);
}
