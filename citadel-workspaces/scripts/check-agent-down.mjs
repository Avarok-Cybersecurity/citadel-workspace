/**
 * What a first-run user sees before they have started the agent.
 *
 * The most common state a new user is in — the app installed, the agent not
 * running yet — and nothing tested it. `vite preview` proxies `/ws` to
 * `AGENT_PORT`, so pointing that at a dead port reproduces it exactly, with no
 * stack and no account.
 *
 * The first attempt at this investigation measured a machine that HAD an agent
 * running and concluded the banner could never fire (see round 202). So this
 * script proves its own premise first: if anything answers on the port it is
 * pointed at, it fails rather than reporting on a state it is not in.
 *
 * What is asserted is the recovery path, not the failure:
 *   - the user is told, in the banner, in words about the agent;
 *   - the dialog offers the thing they need, which is how to start it;
 *   - the dialog can be put away and STAYS away, because the client retries
 *     while the agent is down and every dismissal used to be undone within a
 *     second or two, indefinitely;
 *   - the rest of the app still works, so they can read Settings or the
 *     download hint rather than staring at a modal.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { createConnection } from 'node:net';
import { chromium } from 'playwright';
import { AxeBuilder } from '@axe-core/playwright';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.AGENT_DOWN_PORT ?? 4203);
const DEAD_AGENT_PORT = Number(process.env.AGENT_DOWN_AGENT_PORT ?? 12399);
const ORIGIN = `http://localhost:${PORT}`;
// These checks drive the production bundle, where first-run onboarding is ON
// (isOnboardingEnabled in src/lib/debug-config.ts). They exercise the
// registration wizard but are not testing onboarding, so they opt out with the
// explicit off-switch -- the same one a production Playwright run uses for its
// fixture accounts. Without it the intent dialog intercepts the click on
// create-account and #serverAddress never appears, which is exactly how
// check:mobile failed when onboarding landed.
const APP = `${ORIGIN}/?onboarding=0`;

const results = [];
const record = (name, ok, detail = '') => results.push({ name, ok, detail });

async function waitForServer() {
  for (let i = 0; i < 80; i += 1) {
    try {
      if ((await fetch(`${ORIGIN}/`)).ok) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

/** Whether anything is listening. The premise this whole check rests on. */
function portIsDead(port) {
  return new Promise((resolveDead) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    const done = (dead) => { socket.destroy(); resolveDead(dead); };
    socket.setTimeout(1500);
    socket.on('connect', () => done(false));
    socket.on('error', () => done(true));
    socket.on('timeout', () => done(true));
  });
}

async function main() {
  if (!existsSync(join(APP_ROOT, 'dist', 'index.html'))) {
    console.error('\n  dist/ is missing — run `npm run build` first.\n');
    process.exit(1);
  }

  if (!(await portIsDead(DEAD_AGENT_PORT))) {
    console.error(
      `\n  Something is listening on ${DEAD_AGENT_PORT}, so this check would measure a\n` +
        '  CONNECTED app and report that the agent-down state works. Set\n' +
        '  AGENT_DOWN_AGENT_PORT to a port nothing uses.\n',
    );
    process.exit(1);
  }

  const preview = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: APP_ROOT,
    stdio: 'ignore',
    env: { ...process.env, AGENT_PORT: String(DEAD_AGENT_PORT) },
  });
  if (!(await waitForServer())) {
    preview.kill();
    console.error('\n  vite preview did not start.\n');
    process.exit(1);
  }

  const browser = await chromium.launch();
  // Everything below records into `results`, and a throw part-way used to lose
  // all of it: the run died with a Playwright stack trace and printed no table,
  // so a genuine failure recorded three assertions earlier was invisible. The
  // control for round 203 did exactly that -- it detected the defect and then
  // crashed on a later step, reporting neither.
  let crashed = null;
  try {
    const context = await browser.newContext({ viewport: { width: 375, height: 667 } });
    const page = await context.newPage();
    await page.goto(APP, { waitUntil: 'domcontentloaded' });

    const banner = await page
      .waitForSelector('[data-testid="agent-down-banner"]', { timeout: 30_000 })
      .then(() => true)
      .catch(() => false);
    record('the user is told the agent is unreachable', banner);

    if (banner) {
      const text = await page.textContent('[data-testid="agent-down-banner"]');
      // "Agent", not "connection lost": naming the local process the user can
      // restart is the difference between an actionable message and one that
      // sends them to check their wifi.
      record('the banner names the agent, not the network', /agent/i.test(text ?? ''), (text ?? '').trim().slice(0, 60));
    }

    const dialog = await page.waitForSelector('[role="dialog"]', { timeout: 20_000 })
      .then(() => true)
      .catch(() => false);
    record('a dialog offers a way forward', dialog);

    if (dialog) {
      const body = (await page.textContent('[role="dialog"]')) ?? '';
      record('it says how to start the agent', /run|command|download|install/i.test(body));

      // Scanned here because this modal is only reachable with the agent down,
      // and the backend-free accessibility gate cannot get to it: it visits
      // landing, sign-in, create-account and manage-accounts, all of which
      // exist with a healthy agent.
      //
      // It has already been worth it once. Raising `text-[11px]` to `text-xs`
      // for legibility made the run command wider than its box, turning it into
      // a horizontally scrollable region a keyboard user could not reach --
      // `scrollable-region-focusable`, serious. One accessibility fix created
      // another defect, and only a scan of THIS surface said so.
      await page.waitForTimeout(1_200);
      const { violations } = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      const blocking = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      record(
        'the dialog has no serious or critical accessibility violations',
        blocking.length === 0,
        blocking.map((v) => `${v.id} x${v.nodes.length}`).join('; '),
      );

      await page.locator('[role="dialog"] button').first().focus();
      await page.keyboard.press('Escape');
      // An OBSERVATION WINDOW, not a settle. You cannot wait for something not
      // to happen, so the only way to assert "it stays dismissed" is to watch
      // for a while and see. Eight seconds outlasts several retry cycles; the
      // defect this covers reopened the dialog within a second or two, for
      // ever. Every other pause in this file was a sleep standing in for a
      // condition and has been replaced; this one is the measurement.
      await page.waitForTimeout(8_000);
      const reopened = await page.evaluate(() => document.querySelectorAll('[role="dialog"]').length);
      record('dismissing it makes it stay dismissed', reopened === 0, `${reopened} dialog(s) after 8s`);

      const stillExplained = await page.evaluate(
        () => Boolean(document.querySelector('[data-testid="agent-down-banner"]')),
      );
      record('the banner still explains the state afterwards', stillExplained);

      // THE DISMISSED STATE, which is the one that was broken.
      //
      // This block used to assert that Sign In opens the login form. It does
      // not, and that is deliberate: use-agent-gate.ts refuses every door on
      // this screen while the agent is unreachable, because a login that cannot
      // reach the agent can only fail, and the retry dialog is the surface
      // carrying the download link and the command to run.
      //
      // The defect was what happened AFTER a dismissal. The dialog was gone,
      // the refusal had nothing left to point at, and the button answered a
      // click with nothing whatsoever -- no dialog, no message, no navigation.
      // So the assertion is not "the form opens" and not "nothing happens"; it
      // is that pressing the door leads somewhere that explains itself.
      await page.getByTestId('sign-in-button').click();
      const dialog = page.locator('[role="dialog"]');
      const cameBack = await dialog
        .waitFor({ state: 'visible', timeout: 20_000 })
        .then(() => true)
        .catch(() => false);
      record('pressing Sign In with no agent leads somewhere', cameBack);

      if (cameBack) {
        // Reaching a dialog is not the same as being told what is wrong. The
        // state this whole path exists to avoid is a modal that says the
        // connection failed without naming the thing the user has to install.
        const text = await dialog.first().innerText();
        record('and it names the agent', /agent/i.test(text), text.replace(/\s+/g, ' ').slice(0, 90));
      }

      // The path a NEW user actually takes. They have no account, so they press
      // Create Account, not Sign In -- and the two report failures through
      // different mechanisms, so covering one says nothing about the other.
      // Waits, not sleeps -- and no `.catch(() => {})` between the steps.
      //
      // This block was a chain of fixed 1200ms pauses with every click's
      // failure swallowed. The sibling accessibility gate had the same shape
      // and timed out in CI on a slower machine (round 218), reporting the
      // failure against a surface two steps past where it actually went wrong.
      // Swallowing is the worse half: a selector that stops matching reads as
      // "the app never reached the profile step", which is a defect report
      // about the product for a fault in the check.
      await page.goto(APP, { waitUntil: 'domcontentloaded' });
      // A fresh load brings the retry dialog back -- correctly, it is a new
      // failure -- and it would swallow the clicks below.
      await page.waitForSelector('[role="dialog"]', { timeout: 20_000 });
      await page.locator('[role="dialog"] button').first().focus();
      await page.keyboard.press('Escape');
      // Wait for the dialog to GO, not for a fixed interval. It is modal: while
      // it is up the landing buttons behind it are inert, and clicking one
      // silently does nothing. The previous version slept 1200ms and swallowed
      // the click's failure, so when the dismissal was slow the check reported
      // that the app never reached the profile step.
      await page.locator('[role="dialog"]').waitFor({ state: 'detached', timeout: 20_000 });
      await page.getByTestId('create-account-button').waitFor({ state: 'visible', timeout: 20_000 });
      await page.getByTestId('create-account-button').click();

      // The OTHER door, asserted the same way, because it was broken the same
      // way and the fix reached one of them first.
      //
      // This block used to walk the registration wizard to its profile step and
      // check that submitting produced a toast naming the agent. That premise
      // is wrong for this state: useOnboardingIntent refuses to open the wizard
      // at all while the agent is unreachable, deliberately -- a wizard opened
      // on a connection that cannot complete, stacked over the dialog saying
      // so, was three notices for one condition and two of them modal.
      //
      // What the wizard does with a real registration failure is worth testing,
      // but it is a test for a state where the agent is REACHABLE and the
      // server is not, and asserting it here only ever measured how far a
      // refused click could be dragged. Measured: with the agent down, pressing
      // Create Account produced zero dialogs and no navigation -- the wizard was
      // never opening, and the twenty-second wait for `#serverAddress` was
      // reporting that as a product defect at the wrong step entirely.
      const afterCreate = page.locator('[role="dialog"]');
      const createLeadsSomewhere = await afterCreate
        .waitFor({ state: 'visible', timeout: 20_000 })
        .then(() => true)
        .catch(() => false);
      record('pressing Create Account with no agent leads somewhere', createLeadsSomewhere);

      if (createLeadsSomewhere) {
        const text = await afterCreate.first().innerText();
        record('and that one names the agent too', /agent/i.test(text), text.replace(/\s+/g, ' ').slice(0, 90));
      }
    }

    await context.close();
  } catch (error) {
    crashed = error instanceof Error ? error.message.split('\n')[0] : String(error);
  } finally {
    await browser.close();
    preview.kill();
  }

  if (crashed) {
    record('the check ran to completion', false, crashed);
  }

  const width = Math.max(...results.map((r) => r.name.length));
  console.log(`\n  Agent down — ${ORIGIN} (production bundle, /ws → dead port ${DEAD_AGENT_PORT})\n`);
  for (const { name, ok, detail } of results) {
    console.log(`  ${name.padEnd(width)}  ${ok ? 'ok  ' : 'FAIL'}${detail ? `  ${detail}` : ''}`);
  }
  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    console.error(`\n  ${failed.length} agent-down check(s) failed.\n`);
    process.exit(1);
  }
  console.log('\n  All agent-down checks passed.\n');
}

await main();
