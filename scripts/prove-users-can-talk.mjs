#!/usr/bin/env node
/**
 * Can strangers actually use this? Drives N real browsers through the whole
 * social path against a REAL deployment: create an account on the server,
 * request a peer, see the request, accept it, and talk both ways.
 *
 *   node scripts/check-two-users-can-talk.mjs --origin https://work.avarok.net \
 *                                             --server citadel.avarok.net:12400 [--users 3]
 *
 * NOT a gate, and deliberately not named `check-*` -- it needs a live Citadel
 * server and a local agent, it creates real accounts on that server, and the
 * integration suite already cannot run twice at once against a shared backend.
 * Naming it `check-*` would have put it in docs/GATES.md and in
 * check-every-gate-is-invoked's census, where the only way to satisfy the rule
 * is an entry on a skip list -- a gate counted as enforced because it was
 * excused. This is an operator's proof, run by hand before telling somebody the
 * deployment is ready; scripts/smoke-agent.sh has exactly that standing for the
 * released agent.
 *
 * EVERY ASSERTION LOOKS AT A RENDERED HANDLE, never at page text. The probe
 * this replaces asked
 *
 *     /pending|request|accept/i.test(document.body.innerText)
 *
 * and reported that the recipient never saw the request. The recipient's UI
 * announces it with `pending-requests-badge`, whose entire text is `1`. A
 * numeric badge contains none of those words, so that check returned false
 * against a working UI on every build it was ever run on, and sent a day of
 * debugging into the receiving path looking for a defect that was not there.
 * An assertion whose negative result is unconditional is worse than none.
 */
import { chromium } from 'playwright';

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};

const ORIGIN = arg('origin');
const SERVER = arg('server');
const USERS = Number(arg('users', '3'));
// Only needed when pointing at a locally-served bundle under a fake hostname.
const RESOLVER = process.env.HOST_RESOLVER_RULES;

if (!ORIGIN || !SERVER) {
  console.error('usage: check-two-users-can-talk.mjs --origin <url> --server <host:port> [--users N]');
  console.error('Both are required: guessing which deployment to create accounts on is not a default this may have.');
  process.exit(2);
}
if (!Number.isInteger(USERS) || USERS < 2) {
  console.error(`--users must be an integer >= 2 (got ${arg('users', '3')})`);
  process.exit(2);
}

const PASSWORD = 'Test12345!aA';
const steps = [];
const record = (name, ok, detail = '') => {
  steps.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

/**
 * Create an account and land in the workspace. Resolves false on timeout.
 *
 * `branch` picks which onboarding door to walk. The first user takes the
 * ADMINISTRATOR branch and the rest take MEMBER, so a single run exercises both
 * against a real deployment at no extra cost. Until now every live proof took
 * the member door, and the administrator door was walked only against a locally
 * built image by check-production-image.mjs -- which is a different artefact
 * from the one people are handed.
 */
async function join(page, user, branch) {
  await page.goto(ORIGIN, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(9_000);
  await page.getByTestId('create-account-button').first().click();
  await page.waitForTimeout(2_500);
  // Onboarding is production-only, so this step is present in the deployed
  // build and absent on a dev server. Both are legitimate targets here.
  const intent = page.getByTestId(`onboarding-intent-${branch}`);
  if (await intent.count()) { await intent.first().click(); await page.waitForTimeout(2_500); }
  const dlg = page.locator('[role="dialog"]');
  await dlg.locator('#serverAddress').fill(SERVER);
  await dlg.getByRole('button', { name: /next/i }).first().click();
  await page.waitForTimeout(2_500);
  await dlg.getByRole('button', { name: /next|continue/i }).first().click();
  await page.waitForTimeout(2_500);
  await dlg.locator('#fullName').fill(user);
  await dlg.locator('#username').fill(user);
  await dlg.locator('#password').fill(PASSWORD);
  await dlg.locator('#confirmPassword').fill(PASSWORD);
  await dlg.getByTestId('join-submit').click();
  for (let i = 0; i < 24; i++) {
    await page.waitForTimeout(2_500);
    if (page.url().includes('/workspace')) return true;
  }
  return false;
}

const launchArgs = RESOLVER ? [`--host-resolver-rules=${RESOLVER}`] : [];
const browser = await chromium.launch({ args: launchArgs });

const stamp = Date.now();
const people = [];
for (let i = 0; i < USERS; i++) {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  await page.setViewportSize({ width: 1600, height: 1000 });
  people.push({ name: `u${i + 1}x${stamp}`, page });
}

for (const [index, person] of people.entries()) {
  // First user: the administrator door. Everyone after: the member door.
  const branch = index === 0 ? 'admin' : 'member';
  person.branch = branch;
  record(`${person.name} creates an account via the ${branch} door`,
    await join(person.page, person.name, branch));
  // An administrator is deliberately NOT excused the workspace-initialisation
  // prompt -- that is the difference the branches carry. If it appears, put it
  // away so it cannot block the peering steps below; its content is asserted by
  // check-production-image.mjs, not here.
  await person.page.keyboard.press('Escape').catch(() => {});
}
await people[0].page.waitForTimeout(9_000);

/** `from` asks `to` to connect; `to` accepts. */
async function connect(from, to) {
  await from.page.getByRole('button', { name: /find people already in this workspace/i })
    .first().click({ force: true });
  await from.page.waitForTimeout(8_000);
  const row = from.page.locator('[role="dialog"] div.justify-between').filter({ hasText: to.name });
  await row.getByTestId('peer-connect').first().click({ force: true });
  await from.page.keyboard.press('Escape').catch(() => {});

  const badge = to.page.getByTestId('pending-requests-badge');
  await badge.waitFor({ state: 'visible', timeout: 90_000 });
  record(`${to.name} is shown ${from.name}'s request`, true, `badge reads "${(await badge.textContent() || '').trim()}"`);

  await badge.click();
  await to.page.getByTestId('peer-accept').first().click({ timeout: 30_000 });
  // The badge clearing is the observable consequence of the accept. Asserting
  // the modal closed would also pass if the accept silently failed and the
  // dialog were dismissed.
  await badge.waitFor({ state: 'hidden', timeout: 60_000 });
  await to.page.keyboard.press('Escape').catch(() => {});
  record(`${to.name} accepts ${from.name}`, true);
}

/** `from` sends to `to`, and `to` must render it. */
async function say(from, to, text) {
  await from.page.getByTestId(`peer-row-${to.name}`).first().click();
  await from.page.waitForTimeout(4_000);
  const input = from.page.getByTestId('p2p-message-input');
  await input.waitFor({ state: 'visible', timeout: 30_000 });
  await input.fill(text);
  await input.press('Enter');

  await to.page.getByTestId(`peer-row-${from.name}`).first().click().catch(() => {});
  for (let i = 0; i < 24; i++) {
    await to.page.waitForTimeout(2_500);
    if (await to.page.getByText(text, { exact: false }).count()) {
      record(`${to.name} receives from ${from.name}`, true, text);
      return;
    }
  }
  record(`${to.name} receives from ${from.name}`, false, `never rendered "${text}"`);
}

// Every pair, both directions.
try {
  for (let i = 0; i < people.length; i++) {
    for (let j = i + 1; j < people.length; j++) {
      const a = people[i], b = people[j];
      await connect(a, b);
      await a.page.waitForTimeout(15_000);
      record(`${a.name} lists ${b.name}`, (await a.page.getByTestId(`peer-row-${b.name}`).count()) > 0);
      record(`${b.name} lists ${a.name}`, (await b.page.getByTestId(`peer-row-${a.name}`).count()) > 0);
      await say(a, b, `hello-${a.name}-to-${b.name}-${stamp}`);
      await say(b, a, `hello-${b.name}-to-${a.name}-${stamp}`);
    }
  }
} catch (error) {
  record('the run completed', false, String(error).split('\n')[0]);
}

await browser.close();

const passed = steps.filter((s) => s.ok).length;
console.log(`\n${passed}/${steps.length} steps passed against ${ORIGIN} (server ${SERVER}, ${USERS} users)`);
for (const s of steps.filter((s) => !s.ok)) console.log(`  FAILED: ${s.name} — ${s.detail}`);
process.exit(passed === steps.length ? 0 : 1);
