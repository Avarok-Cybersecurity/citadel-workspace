/**
 * The two-tab variant (p2p-demo-design F7): two members in two TABS of one browser, so both
 * sessions share the leader tab's one agent socket. An `IhttpFrameNotification` carries its
 * recipient in `cid`; routed by anything else, one tab's app would be handed the other session's
 * frames. Each tab records what its own event bus delivered, and each must hold frames for its
 * own session only -- and some, so an empty record cannot pass.
 */
import type { Browser, BrowserContext, Page } from 'playwright';
import { createIsolatedContexts } from './browser.js';
import { createAccount } from './account.js';
import { waitForWorkspaceLoaded } from './modals.js';
import { p2pRegister, acceptP2PRequest, openConversation, waitForP2PChannelReady } from './p2p.js';
import { sendAndVerifyMessage } from './messaging.js';
import { consentPeer, readZoneLog, type ZoneLog } from './apps.js';
import { answered, deliveredFrames, openPoolZone, pressAppAction, runJob, sessionCid, watchDeliveredFrames, type JobRun } from './apps-zone.js';
import type { UxIssueTracker } from './ux-tracker.js';

export interface TwoTabResults {
  peers: boolean; consented: boolean; mounted: boolean;
  xToY: boolean; yToX: boolean;
  xTabOnlyOwnFrames: boolean; yTabOnlyOwnFrames: boolean;
}

const JOB_MS: number = 60_000;

/** Every delivered frame is for `cid`, and there is at least one. */
const onlyOwn = (delivered: readonly string[], cid: string, label: string): boolean => {
  const foreign: string[] = delivered.filter((c: string) => c !== cid);
  console.log(`  ${label}: ${delivered.length} frame(s) delivered, ${foreign.length} for another session`);
  return delivered.length > 0 && foreign.length === 0;
};

async function peersInOneBrowser(context: BrowserContext, x: string, y: string, uxTracker: UxIssueTracker): Promise<{ tx: Page; ty: Page } | null> {
  const tx: Page = await context.newPage();
  const ty: Page = await context.newPage();
  const accounts: boolean = (await createAccount(tx, x, { isFirstUser: false, uxTracker })) && (await waitForWorkspaceLoaded(tx, 60_000))
    && (await createAccount(ty, y, { isFirstUser: false, uxTracker })) && (await waitForWorkspaceLoaded(ty, 60_000));
  if (!accounts) return null;
  const registered: boolean = (await p2pRegister(tx, x, y, { uxTracker })) && (await acceptP2PRequest(ty, y, uxTracker, x));
  const talking: boolean = registered && (await openConversation(tx, x, y, uxTracker)) && (await openConversation(ty, y, x, uxTracker))
    && (await sendAndVerifyMessage(tx, x, ty, y, `two-tab warm-up from ${x}`, { maxRetries: 3, verifyTimeout: 20_000, retryDelay: 3_000, uxTracker }))
    && (await sendAndVerifyMessage(ty, y, tx, x, `two-tab warm-up from ${y}`, { maxRetries: 3, verifyTimeout: 20_000, retryDelay: 3_000, uxTracker }))
    && (await waitForP2PChannelReady(tx, x, y, 60_000)) && (await waitForP2PChannelReady(ty, y, x, 60_000));
  return talking ? { tx, ty } : null;
}

export async function runTwoTabVariant(browser: Browser, installId: string, office: string, x: string, y: string, uxTracker: UxIssueTracker): Promise<TwoTabResults> {
  const r: TwoTabResults = { peers: false, consented: false, mounted: false, xToY: false, yToX: false, xTabOnlyOwnFrames: false, yTabOnlyOwnFrames: false };
  const [context] = await createIsolatedContexts(browser, 1);
  const pair: { tx: Page; ty: Page } | null = await peersInOneBrowser(context, x, y, uxTracker);
  if (pair === null) return r;
  r.peers = true;
  const { tx, ty } = pair;
  const [xCid, yCid] = [await sessionCid(tx), await sessionCid(ty)];
  if (xCid === yCid) throw new Error(`both tabs act for session ${xCid}: the variant needs two`);
  await consentPeer(tx, installId, ['serve', 'call', 'topics']);
  await consentPeer(ty, installId, ['serve', 'call', 'topics']);
  r.consented = true;
  await watchDeliveredFrames(tx);
  await watchDeliveredFrames(ty);
  const xLog: ZoneLog = readZoneLog(tx, 'X tab');
  const yLog: ZoneLog = readZoneLog(ty, 'Y tab');
  await openPoolZone(tx, office);
  await openPoolZone(ty, office);
  r.mounted = true;
  // P2P only, so a job that fell back to the relay cannot pass for one that crossed the shared socket.
  await pressAppAction(tx, 'mode-p2p');
  await pressAppAction(ty, 'mode-p2p');
  const xy: JobRun = await runJob(tx, xLog, 'run-primes', y, JOB_MS);
  r.xToY = answered(xy.answer) && xy.answer?.via === 'p2p' && xy.verified === true;
  const yx: JobRun = await runJob(ty, yLog, 'run-primes', x, JOB_MS);
  r.yToX = answered(yx.answer) && yx.answer?.via === 'p2p' && yx.verified === true;
  r.xTabOnlyOwnFrames = onlyOwn(await deliveredFrames(tx), xCid, 'X tab');
  r.yTabOnlyOwnFrames = onlyOwn(await deliveredFrames(ty), yCid, 'Y tab');
  await context.close();
  return r;
}
