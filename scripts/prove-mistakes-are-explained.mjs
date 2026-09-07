#!/usr/bin/env node
/**
 * The states a stranger actually lands in, and whether they are told anything
 * useful. Runs against a REAL deployment, like prove-users-can-talk.mjs.
 *
 *   node scripts/prove-mistakes-are-explained.mjs --origin https://work.avarok.net \
 *                                                 --server citadel.avarok.net:12400
 *
 * NOT a gate, and deliberately not named `check-*` — it needs a live server, a
 * running agent and sole use of that backend, and it creates real accounts. See
 * prove-users-can-talk.mjs for the same reasoning.
 *
 * WHY THIS EXISTS. Three user-facing defects in one session, all the same
 * shape: a mapping in error-messages.ts that reads plausibly and does not match
 * the string the other side actually sends.
 *
 *   - a missing LOCAL account reported as "No account found ... on this server",
 *     advising a re-registration that mints a second identity (round 689);
 *   - a mistyped address answered with `failed to lookup address information:
 *     nodename nor servname provided, or not known` (round 690);
 *   - and the product's most common error of all, a wrong password, answered
 *     with "Something went wrong: Invalid username or password" (round 691).
 *
 * Every one was found by MAKING the mistake. None could be found by reading the
 * mapping, because reading the mapping is what wrote them — and a unit test
 * over invented strings has the same blind spot, since the string it invents is
 * the one the author expected rather than the one the SDK sends.
 *
 * A MECHANICAL GATE WAS CONSIDERED AND REJECTED. The agent's own error literals
 * are enumerable from its Rust source (11 of them), so a gate could require each
 * to map to something friendly. It would not have caught two of the three above:
 * "Invalid username or password" and "Client does not exist" come from the SDK,
 * not from this repository, and cannot be enumerated here. A gate that covers a
 * third of the surface while reporting that errors are handled is worse than
 * knowing they are not — so this asks the running system instead.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:net';

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};
const ORIGIN = arg('origin');
const SERVER = arg('server');
const RESOLVER = process.env.HOST_RESOLVER_RULES;
if (!ORIGIN || !SERVER) {
  console.error('usage: prove-mistakes-are-explained.mjs --origin <url> --server <host:port>');
  process.exit(2);
}

const PASSWORD = 'Test12345!aA';
const results = [];
const record = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n        ${detail}` : ''}`);
};

/**
 * The two things a message must not be. "Something went wrong" is the generic
 * fallback — its presence means no branch matched. The rest are raw system text
 * that has reached users before.
 */
const RAW = /something went wrong|lookup address information|nodename nor servname|Err\(|panicked|unwrap|0x[0-9a-f]{6}/i;

const browser = await chromium.launch({ args: RESOLVER ? [`--host-resolver-rules=${RESOLVER}`] : [] });

/**
 * The precondition, checked first and named plainly.
 *
 * With no agent, the landing page puts a modal over everything and every click
 * below waits out its timeout against a backdrop. The first run of this script
 * did exactly that and reported a thirty-second Playwright stack trace naming
 * `create-account-button` — which says nothing about the actual problem, and
 * invites debugging the wrong thing. A tool that needs a running agent should
 * say so in one line.
 */
{
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  await page.goto(ORIGIN, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(9_000);
  const blocked = await page.getByTestId('connection-retry-modal').count();
  await context.close();
  if (blocked > 0) {
    console.error(`\nThe agent is not reachable from ${ORIGIN}, so every state below would time out`);
    console.error('against a connection dialog rather than being measured.');
    console.error('Start the agent for this origin, then run this again:');
    console.error('  ./citadel-agent --bind 127.0.0.1:12345 --backend filesystem \\');
    console.error(`      --allowed-origins ${ORIGIN}`);
    await browser.close();
    process.exit(2);
  }
}

/**
 * Returns `{ message, landed }` -- both, because SUCCESS ALSO TOASTS.
 *
 * This returned the first toast it saw and inferred success from the ABSENCE of
 * one. A correct registration shows "Registration Successful -- Your account has
 * been registered", so the control below reported failure against a perfectly
 * healthy system. A check that cannot pass is worse than one that cannot fail:
 * somebody eventually deletes it.
 *
 * Landing on /workspace is what actually distinguishes success, so that is what
 * is measured, and the message is carried alongside rather than standing in for
 * it.
 */
async function outcomeAfter(page, action) {
  await action();
  let message = '';
  for (let i = 0; i < 22; i++) {
    await page.waitForTimeout(2500);
    if (!message) {
      message = await page.evaluate(() =>
        [...document.querySelectorAll('[data-sonner-toast],[role="alert"]')]
          .map((e) => e.textContent).join(' | '));
    }
    if (page.url().includes('/workspace')) return { message, landed: true };
    // A message that is not a success notice ends the wait: the state is decided.
    if (message && !/registration successful/i.test(message)) return { message, landed: false };
  }
  return { message, landed: page.url().includes('/workspace') };
}

async function openJoin(page) {
  await page.goto(ORIGIN, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(9_000);
  await page.getByTestId('create-account-button').first().click();
  await page.waitForTimeout(2_500);
  const intent = page.getByTestId('onboarding-intent-member');
  if (await intent.count()) { await intent.first().click(); await page.waitForTimeout(2_500); }
  return page.locator('[role="dialog"]');
}

async function join(page, username, server) {
  const dlg = await openJoin(page);
  await dlg.locator('#serverAddress').fill(server);
  await dlg.getByRole('button', { name: /next/i }).first().click();
  await page.waitForTimeout(2_500);
  await dlg.getByRole('button', { name: /next|continue/i }).first().click();
  await page.waitForTimeout(2_500);
  await dlg.locator('#fullName').fill(username);
  await dlg.locator('#username').fill(username);
  await dlg.locator('#password').fill(PASSWORD);
  await dlg.locator('#confirmPassword').fill(PASSWORD);
  return outcomeAfter(page, () => dlg.getByTestId('join-submit').click());
}

const stamp = Date.now();
const user = `mx${stamp}`;

// 1. A server address that does not resolve — the likeliest first mistake.
{
  const page = await (await browser.newContext({ ignoreHTTPSErrors: true })).newPage();
  const { message } = await join(page, `${user}a`, 'no-such-host.invalid:12400');
  record('a mistyped server address is explained', Boolean(message) && !RAW.test(message), message);
}

// 2. A real account, so the next two have something to fail against.
{
  const page = await (await browser.newContext({ ignoreHTTPSErrors: true })).newPage();
  const { message, landed } = await join(page, user, SERVER);
  // Landing in the workspace, not the absence of a toast -- success toasts too.
  record('the control: a correct registration still succeeds', landed, message);
}

// 3. The same username again.
{
  const page = await (await browser.newContext({ ignoreHTTPSErrors: true })).newPage();
  const { message } = await join(page, user, SERVER);
  record('a taken username is explained', Boolean(message) && !RAW.test(message), message);
}

// 4. The wrong password — the most common failure there is.
{
  const page = await (await browser.newContext({ ignoreHTTPSErrors: true })).newPage();
  await page.goto(ORIGIN, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(9_000);
  await page.getByTestId('sign-in-button').first().click();
  await page.waitForTimeout(3_000);
  const dlg = page.locator('[role="dialog"]');
  await dlg.locator('#username').fill(user);
  await dlg.locator('#password').fill('DefinitelyWrong123!');
  const { message: msg } = await outcomeAfter(page, () => dlg.locator('button[type="submit"]').first().click());
  record('a wrong password is explained', Boolean(msg) && !RAW.test(msg), msg);
  // ...and does not say WHICH half was wrong: the SDK conflates them so that a
  // login form cannot be used to enumerate usernames.
  record('and does not reveal which half was wrong',
    Boolean(msg) && !/incorrect password|no account found/i.test(msg), msg);
}

// 5. A server that accepts the connection and then says nothing.
//
// The other address mistakes fail FAST -- a name that does not resolve, a port
// with nothing behind it. This is the slow one: the TCP connect succeeds, the
// protocol never starts, and thirty seconds later registration gives up. It is
// what a wrong-but-live port looks like, and what a hung or half-started server
// looks like.
//
// It earns its place because the message used to be "The connection request
// timed out. Please check your network and try again." The network is the one
// place the fault is not: the page reached the agent on this machine perfectly
// well, and it is the agent's connection to the WORKSPACE SERVER that timed
// out. work.avarok.net showed that sentence to every new user for weeks.
{
  const sink = createServer((socket) => { /* accept, then never speak */ socket.on('error', () => {}); });
  await new Promise((resolve) => sink.listen(0, '127.0.0.1', resolve));
  const port = sink.address().port;
  try {
    const page = await (await browser.newContext({ ignoreHTTPSErrors: true })).newPage();
    const { message } = await join(page, `${user}s`, `127.0.0.1:${port}`);
    record('a server that never answers is explained', Boolean(message) && !RAW.test(message), message);
    // NOT merely "does not say network". The raw SDK string
    // "Something went wrong: Socket deadline has elapsed" contains no such
    // word either, so that weaker form passed against a message that explained
    // nothing at all -- a check green for the wrong reason. Require it to NAME
    // the thing to go and look at.
    record('and points at the server address, the thing to check',
      Boolean(message) && /server did not answer/i.test(message)
        && /host name or IP address/i.test(message)
        && !/your network/i.test(message), message);
  } finally {
    sink.close();
  }
}

await browser.close();
const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} states explained against ${ORIGIN} (server ${SERVER})`);
process.exit(passed === results.length ? 0 : 1);
