/**
 * Compute Pool between two real members (p2p-demo-design §4, §5).
 *
 * A and B are two browser CONTEXTS, so each has its own agent socket; A is the first member and
 * so the workspace's Admin. The app is signed with a key made for this run (apps-signing.ts) and
 * installed for the whole workspace through the page's apps transport (apps.ts says why).
 *
 *   1. A installs it; A and B each allow serve, call and topics in Apps -> Installed (each plane's
 *      data-allowed turns "true"), and both open the office whose page holds its zone.
 *   2. P2P: A's job gets B's answer via p2p, verified; A's socket sent an agent IhttpSend to B and
 *      B's socket received IhttpFrameNotifications for B: the frames took the direct path.
 *   3. Relay forced: B's answer via relay, verified, and A sent no agent IhttpSend for it (step 2
 *      proved the same counter does count, so its standing still is evidence).
 *   4. Denials: B revokes serve -> A's P2P call is refused; P2P-then-relay falls back and B answers
 *      via relay; B allows serve again but blocks A -> B is out of A's reach entirely: a block
 *      refuses every direction, the pool's topic too, so B never hears the job, never claims it and
 *      is never called, and A's job is done without B; B unblocks A -> B answers via p2p again.
 *   5. Revocation while running: A starts a SHA job and B revokes serve; B's answer comes within
 *      60 s, and A's next call is refused.
 *   6. Uninstall while running: both zones report that the app closed.
 *   7. Reinstalled without the relay pair, with B's serve revoked: P2P-then-relay may not fall
 *      back, so the call answers Unavailable("p2p").
 *   8. Two members in two tabs of one browser (apps-two-tabs.ts): each tab's app is handed its own
 *      session's frames only.
 *
 * Server and agent logs are NOT judged: the kernel logs commands at debug and the stack runs at
 * info, so "no IhttpSend in the server log" would hold whatever happened. The page's socket is
 * judged instead (apps-zone.ts).
 */
import { TestHarness, runTestMain, sleep, waitForP2PChannelReady } from '../lib/index.js';
import { openMultiWindowWorld, makePeers, type MultiWindowWorld, type PeersReady } from '../lib/multi-window-setup.js';
import { signComputePool, COMPUTE_POOL_ID, type SignedApp } from '../lib/apps-signing.js';
import { blockPeer, consentPeer, installSignedApp, readZoneLog, revokePeer, uninstallApp, type Plane, type ZoneLog } from '../lib/apps.js';
import { answered, openPoolZone, placePoolZone, pressAppAction, runJob, runJobWithout, sessionCid, watchIhttpWire, type JobRun, type WireCount } from '../lib/apps-zone.js';
import { runTwoTabVariant, type TwoTabResults } from '../lib/apps-two-tabs.js';

const stamp: number = Date.now();
const A: string = `pool_a_${stamp}`;
const B: string = `pool_b_${stamp}`;
const X: string = `pool_x_${stamp}`;
const Y: string = `pool_y_${stamp}`;
const OFFICE: string = `Compute Pool ${stamp}`;
const ALL: Plane[] = ['serve', 'call', 'topics'];
const RELAY_PAIR: string[] = ['ihttp.serve', 'ihttp.call'];
const JOB_MS: number = 60_000;
/** Design §5 step 5: a revocation ends a running stream within the 60 s authorisation cache. */
const REVOKE_MS: number = 60_000;
const REFUSED: string = 'Unavailable("refused")';
const say = (step: string): void => console.log(`\n${'─'.repeat(50)}\n${step}\n${'─'.repeat(50)}`);

interface Results {
  peers: PeersReady; channelReady: boolean; installed: boolean; consented: boolean; mounted: boolean;
  p2pJob: boolean; p2pOnTheWire: boolean;
  relayJob: boolean; relayOffTheP2pWire: boolean;
  revokedServeRefused: boolean; fallsBackToRelay: boolean; blockedOutOfReach: boolean; unblockedReaches: boolean;
  revokeEndsWithin60s: boolean; nextCallRefused: boolean;
  uninstallClosesBothZones: boolean;
  noRelayNoFallback: boolean;
  twoTabs: TwoTabResults | null;
}

const p2pOk = (run: JobRun): boolean => answered(run.answer) && run.answer?.via === 'p2p' && run.verified === true;
const relayOk = (run: JobRun): boolean => answered(run.answer) && run.answer?.via === 'relay' && run.verified === true;
const refusedOverP2p = (run: JobRun, note: string): boolean => run.answer?.via === 'p2p' && run.answer.note === note;

/** Both zones say the app closed for install `installId` (page-runtime.ts `audit`). */
async function bothZonesClosed(logs: readonly ZoneLog[], marks: readonly number[], installId: string): Promise<boolean> {
  const closed: RegExp = new RegExp(`^\\[apps\\] ${COMPUTE_POOL_ID.replace(/\./g, '\\.')} \\(install ${installId}, zone [^)]+\\) closed: `);
  const seen: Array<RegExpExecArray | null> = await Promise.all(logs.map((log: ZoneLog, i: number) => log.find(closed, marks[i], REVOKE_MS)));
  return seen.every((m: RegExpExecArray | null) => m !== null);
}

async function runTest(): Promise<boolean> {
  const harness: TestHarness = await TestHarness.create({
    testName: 'Compute Pool P2P Test', reportFileName: 'APPS_COMPUTE_POOL_TEST_REPORT.json',
    metadata: { a: A, b: B, x: X, y: Y, office: OFFICE }, restartBackend: true,
  });
  const world: MultiWindowWorld = await openMultiWindowWorld();
  const { a1: a, b } = world;
  // Before the first navigation, so every socket and every app line is seen.
  const aLog: ZoneLog = readZoneLog(a, 'A');
  const bLog: ZoneLog = readZoneLog(b, 'B');
  const aWire: WireCount = watchIhttpWire(a);
  const bWire: WireCount = watchIhttpWire(b);
  const r: Results = {
    peers: { accounts: false, registered: false, conversations: false, talking: false }, channelReady: false, installed: false, consented: false, mounted: false,
    p2pJob: false, p2pOnTheWire: false, relayJob: false, relayOffTheP2pWire: false,
    revokedServeRefused: false, fallsBackToRelay: false, blockedOutOfReach: false, unblockedReaches: false,
    revokeEndsWithin60s: false, nextCallRefused: false, uninstallClosesBothZones: false, noRelayNoFallback: false, twoTabs: null,
  };
  try {
    say('STEP 1: A installs the Compute Pool; A and B allow it and open its zone');
    r.peers = await makePeers(world, A, B, harness.uxTracker);
    if (!Object.values(r.peers).every(Boolean)) throw new Error(`setup did not complete: ${JSON.stringify(r.peers)}`);
    r.channelReady = (await waitForP2PChannelReady(a, A, B, 60_000)) && (await waitForP2PChannelReady(b, B, A, 60_000));
    const app: SignedApp = await signComputePool();
    const installId: string = await installSignedApp(a, app, []);
    r.installed = true;
    await placePoolZone(a, OFFICE);
    await consentPeer(a, installId, ALL);
    await consentPeer(b, installId, ALL);
    r.consented = true;
    await openPoolZone(a, OFFICE);
    await openPoolZone(b, OFFICE);
    r.mounted = true;
    const bCid: string = await sessionCid(b);

    say('STEP 2: a job over P2P');
    const [sent2, recv2] = [aWire.sentTo(bCid), bWire.receivedFor(bCid)];
    r.p2pJob = p2pOk(await runJob(a, aLog, 'run-primes', B, JOB_MS));
    r.p2pOnTheWire = aWire.sentTo(bCid) > sent2 && bWire.receivedFor(bCid) > recv2;

    say('STEP 3: the relay, forced');
    await pressAppAction(a, 'mode-relay');
    const sent3: number = aWire.sentTo(bCid);
    r.relayJob = relayOk(await runJob(a, aLog, 'run-primes', B, JOB_MS));
    r.relayOffTheP2pWire = r.p2pOnTheWire && aWire.sentTo(bCid) === sent3;

    say('STEP 4: B revokes serve, then blocks A, then unblocks A');
    await revokePeer(b, installId, 'serve');
    await pressAppAction(a, 'mode-p2p');
    const revoked: JobRun = await runJob(a, aLog, 'run-primes', B, JOB_MS);
    r.revokedServeRefused = refusedOverP2p(revoked, REFUSED);
    await pressAppAction(a, 'mode-prefer');
    r.fallsBackToRelay = relayOk(await runJob(a, aLog, 'run-primes', B, JOB_MS));
    await consentPeer(b, installId, ['serve']);
    await blockPeer(b, installId, A, true);
    await pressAppAction(a, 'mode-p2p');
    // Not a refusal from B: a block refuses the topic too (kernel peer_rules.rs), so B never claims.
    const blocked: { done: boolean; peerAnswered: boolean } = await runJobWithout(a, aLog, 'run-primes', B, JOB_MS);
    r.blockedOutOfReach = blocked.done && !blocked.peerAnswered;
    await blockPeer(b, installId, A, false);
    r.unblockedReaches = p2pOk(await runJob(a, aLog, 'run-primes', B, JOB_MS));

    say('STEP 5: B revokes serve while a SHA job runs');
    const mark5: number = aLog.lines.length;
    await pressAppAction(a, 'run-sha');
    await revokePeer(b, installId, 'serve');
    const ended: RegExpExecArray | null = await aLog.find(new RegExp(`^\\[app info\\] answer from ${B} via p2p: (.+)$`), mark5, REVOKE_MS);
    console.log(`  B's answer to the running job: ${ended?.[1] ?? 'none within 60 s'}`);
    r.revokeEndsWithin60s = ended !== null;
    r.nextCallRefused = refusedOverP2p(await runJob(a, aLog, 'run-primes', B, JOB_MS), REFUSED);

    say('STEP 6: A uninstalls while a job runs; both zones close');
    await consentPeer(b, installId, ['serve']);
    const marks6: number[] = [aLog.lines.length, bLog.lines.length];
    await pressAppAction(a, 'run-sha');
    await uninstallApp(a, installId);
    r.uninstallClosesBothZones = await bothZonesClosed([aLog, bLog], marks6, installId);

    say('STEP 7: reinstalled without the relay pair; P2P-then-relay cannot fall back');
    const noRelay: string = await installSignedApp(a, app, RELAY_PAIR);
    await consentPeer(a, noRelay, ALL);
    await consentPeer(b, noRelay, ALL);
    await openPoolZone(a, OFFICE);
    await openPoolZone(b, OFFICE);
    await revokePeer(b, noRelay, 'serve');
    await pressAppAction(a, 'mode-prefer');
    r.noRelayNoFallback = refusedOverP2p(await runJob(a, aLog, 'run-primes', B, JOB_MS), 'Unavailable("p2p")');

    say('STEP 8: two members, two tabs, one agent socket');
    r.twoTabs = await runTwoTabVariant(world.browser, noRelay, OFFICE, X, Y, harness.uxTracker);

    console.log(`\n${'='.repeat(60)}\nRESULTS\n${'='.repeat(60)}`);
    for (const [name, value] of Object.entries(r)) console.log(`  ${name.padEnd(26)} ${typeof value === 'boolean' ? (value ? 'PASS' : 'FAIL') : JSON.stringify(value)}`);
    const nested = (v: unknown): boolean => (typeof v === 'boolean' ? v : v !== null && typeof v === 'object' && Object.values(v).every(nested));
    const passed: boolean = Object.values(r).every(nested);
    harness.finalize(passed, r as unknown as Record<string, unknown>);
    return passed;
  } finally {
    await sleep(500);
    await world.browser.close();
  }
}

runTestMain(runTest);
