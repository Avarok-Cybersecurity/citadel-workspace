/**
 * A hosted page reaches the agent on the visitor's own machine.
 *
 * The page is served from a NON-loopback host (work.test, which Chromium is told resolves to
 * 127.0.0.1); the agent listens on wss://local.test:PORT with a certificate for that name
 * (self-signed here, so the browser is told to accept it). What is asserted is what the
 * browser DID: which WebSocket it opened, and that frames came back over it -- so the meta the
 * image renders, the CSP it serves, the resolver's choice, the agent's TLS and its Origin and
 * Host checks are all on the line at once. A unit test of any one of them cannot see the
 * others disagreeing.
 *
 * The second test is the control for the first: the same image, opened from a loopback host,
 * must NOT dial the published origin -- a locally-served page reaches its agent through the
 * same-origin /ws proxy, which is where that proxy is safe.
 *
 * Driven by scripts/test-hosted-ui-loopback.sh in the parent repository, which starts the
 * pieces and sets HOSTED_UI_URL, LOCAL_UI_URL and LOOPBACK_AGENT_URL. Without them there is
 * nothing to test against; the spec says so rather than passing vacuously.
 */
import { test, expect, chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { formatConsoleLine } from '../lib/console-line.js';

const HOSTED_UI_URL: string | undefined = process.env.HOSTED_UI_URL;
const LOCAL_UI_URL: string | undefined = process.env.LOCAL_UI_URL;
const LOOPBACK_AGENT_URL: string | undefined = process.env.LOOPBACK_AGENT_URL;

interface Observed {
  urls: string[];
  framesFrom: Set<string>;
  errors: string[];
  /** The page's own account of itself: console errors and warnings, for the failure message. */
  console: string[];
}

/**
 * Record every WebSocket the page opens, what it received, and what failed. Playwright reports
 * a socket whose upgrade was answered (even 403), but NOT one whose TCP connection was refused
 * -- measured -- so an empty list means "no upgrade request reached anything", and the console
 * is the next place to look.
 */
function observeSockets(page: Page): Observed {
  const seen: Observed = { urls: [], framesFrom: new Set(), errors: [], console: [] };
  page.on('websocket', (ws) => {
    seen.urls.push(ws.url());
    ws.on('framereceived', () => { seen.framesFrom.add(ws.url()); });
    ws.on('socketerror', (err: string) => { seen.errors.push(`${ws.url()}: ${err}`); });
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') seen.console.push(`${msg.type()}: ${formatConsoleLine(msg.text())}`);
  });
  page.on('pageerror', (err) => { seen.console.push(`pageerror: ${formatConsoleLine(String(err))}`); });
  return seen;
}

async function waitUntil(page: Page, done: () => boolean, timeoutMs: number): Promise<void> {
  const deadline: number = Date.now() + timeoutMs;
  while (!done() && Date.now() < deadline) await page.waitForTimeout(250);
}

function describe(seen: Observed): string {
  return `sockets opened: ${JSON.stringify(seen.urls)}; socket errors: ${JSON.stringify(seen.errors)}; console (last 6): ${JSON.stringify(seen.console.slice(-6))}`;
}

test.describe('hosted UI → loopback agent', () => {
  test.skip(!HOSTED_UI_URL || !LOCAL_UI_URL || !LOOPBACK_AGENT_URL,
    'HOSTED_UI_URL, LOCAL_UI_URL and LOOPBACK_AGENT_URL are set by scripts/test-hosted-ui-loopback.sh');

  let browser: Browser;
  let context: BrowserContext;

  test.beforeAll(async () => {
    // work.test and local.test are not real names; the browser is told where they live. This
    // is what makes the page NON-loopback by host while everything runs on this machine.
    browser = await chromium.launch({
      args: ['--host-resolver-rules=MAP work.test 127.0.0.1, MAP local.test 127.0.0.1'],
    });
    // The agent's certificate is self-signed for this run; a real deployment's is issued.
    context = await browser.newContext({ ignoreHTTPSErrors: true });
  });
  test.afterAll(async () => { await context?.close(); await browser?.close(); });

  test('a page on a non-loopback host dials the published loopback origin, and it answers', async () => {
    const page: Page = await context.newPage();
    const seen: Observed = observeSockets(page);
    await page.goto(HOSTED_UI_URL!, { waitUntil: 'commit', timeout: 60_000 });
    // The app dials the agent as soon as it is ready; frames prove the TLS handshake, the
    // Origin check and the Host check all let it through.
    // Not expect.poll: its `message` is a string built when the call is made, so it would
    // report the EMPTY initial state on failure. Wait, then assert with a message built after.
    await waitUntil(page, () => seen.framesFrom.has(LOOPBACK_AGENT_URL!), 30_000);
    expect(seen.framesFrom.has(LOOPBACK_AGENT_URL!), `expected frames over ${LOOPBACK_AGENT_URL}; ${describe(seen)}`).toBe(true);
    expect(seen.urls, 'the hosted page must not also try same-origin /ws').not.toContainEqual(expect.stringMatching(/\/ws$/));
    // The "don't have the agent running?" offer is for a page that could NOT reach one.
    await expect(page.getByText("Don't have the agent running?")).toHaveCount(0);
    await page.close();
  });

  test('control: the same image opened from a loopback host uses same-origin /ws, not the published origin', async () => {
    const page: Page = await context.newPage();
    const seen: Observed = observeSockets(page);
    await page.goto(LOCAL_UI_URL!, { waitUntil: 'commit', timeout: 60_000 });
    await waitUntil(page, () => seen.urls.length > 0, 30_000);
    expect(seen.urls.length > 0, `the app never opened a WebSocket; ${describe(seen)}`).toBe(true);
    const local: URL = new URL(LOCAL_UI_URL!);
    expect(seen.urls[0]).toBe(`ws://${local.host}/ws`);
    expect(seen.urls).not.toContain(LOOPBACK_AGENT_URL!);
    await page.close();
  });
});
