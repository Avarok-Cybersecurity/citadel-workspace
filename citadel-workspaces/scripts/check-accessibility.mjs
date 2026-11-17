/**
 * axe against the screens a visitor meets before they have an account.
 *
 * There is already an accessibility spec — `integration-tests/src/tests-pw/
 * accessibility.spec.ts` — and it is better than this one: it signs in and
 * covers the workspace. It also needs a backend, an account and a completed
 * registration, so when registration breaks it stops running, and it stops
 * running silently.
 *
 * That is the shape round 188 recorded: `check-mobile-layout.mjs` spent weeks
 * timing out behind an earlier failure in the same job, and a dead check behind
 * a failing check is indistinguishable from a passing one. The pre-auth screens
 * need nothing but a served bundle, so their accessibility should not depend on
 * whether an account can be created.
 *
 * Includes `wcag22aa`, which the spec does not: WCAG 2.2 is where target size
 * lives, and three controls were found at 21px against its 24px floor.
 *
 * Gated on `serious` and `critical`, matching the spec — `minor` and `moderate`
 * are dominated by advice that would make this a running argument with the
 * designer rather than a defect gate.
 */
import { spawnPreview, dismissConnectionFailure } from './lib/preview-world.mjs';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { chromium } from 'playwright';
import { AxeBuilder } from '@axe-core/playwright';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.A11Y_PORT ?? 4186);
const ORIGIN = `http://localhost:${PORT}`;
// These checks drive the production bundle, where first-run onboarding is ON
// (isOnboardingEnabled in src/lib/debug-config.ts). They exercise the
// registration wizard but are not testing onboarding, so they opt out with the
// explicit off-switch -- the same one a production Playwright run uses for its
// fixture accounts. Without it the intent dialog intercepts the click on
// create-account and #serverAddress never appears, which is exactly how
// check:mobile failed when onboarding landed.
const APP = `${ORIGIN}/?onboarding=0`;
/**
 * The surface under test, installed into every page as `__a11yScope()`.
 *
 * The LAST dialog, not the first: dialogs stack, and the one on top is the one
 * the user is in. Taking the first in document order measured whatever was
 * underneath it. One definition, because three probes ask the same question and
 * two of them used to answer it differently.
 */
const INSTALL_SCOPE = () => {
  window.__a11yScope = () => {
    const dialogs = [...document.querySelectorAll('[role="dialog"]')];
    return dialogs[dialogs.length - 1] ?? document.body;
  };
};

/** WCAG 2.0, 2.1 and 2.2, A and AA. */
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const BLOCKING = new Set(['serious', 'critical']);

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

async function main() {
  if (!existsSync(join(APP_ROOT, 'dist', 'index.html'))) {
    console.error('\n  dist/ is missing — run `npm run build` first.\n');
    process.exit(1);
  }

  // The agent port pinned closed, from the one place that decides it.
  //
  // `vite preview` proxies `/ws` to the developer's live stack or, in CI, to
  // nothing — so an unpinned gate measures two different applications. That
  // difference produced a red CI leg here and the same latent bug in three other
  // gates; see lib/preview-world.mjs.
  const preview = spawnPreview(APP_ROOT, PORT);
  if (!(await waitForServer())) {
    preview.kill();
    console.error('\n  vite preview did not start.\n');
    process.exit(1);
  }

  const browser = await chromium.launch();
  // A throw part-way used to lose every result gathered before it: the run died
  // with a Playwright stack trace and printed no table, so a genuine failure
  // recorded earlier was invisible. A check that reports nothing when it breaks
  // has failures indistinguishable from its own infrastructure.
  let crashed = null;
  try {
    // A phone viewport, because that is where a layout runs out of room and
    // starts producing the overlaps and clipped labels axe can see.
    const context = await browser.newContext({ viewport: { width: 375, height: 667 } });
    await context.addInitScript(INSTALL_SCOPE);
    const page = await context.newPage();

    /** The wizard's second step, from a fresh load. Waits, never sleeps. */
    const toSecurityStep = async () => {
      await page.goto(APP, { waitUntil: 'domcontentloaded' });
      await page.getByTestId('create-account-button').click();
      await page.locator('#serverAddress').waitFor({ state: 'visible', timeout: 30_000 });
      await page.locator('#serverAddress').fill('127.0.0.1:12349');
      await page.locator('#password').fill('password123');
      await page.locator('button[type="submit"]').first().click();
      await page.getByRole('heading', { name: /Security/i }).waitFor({ state: 'visible', timeout: 30_000 });
    };

    /** The wizard's third step, from a fresh load. */
    const toProfileStep = async () => {
      await toSecurityStep();
      await page.locator('button').filter({ hasText: /^Next$/ }).last().click();
      await page.locator('#fullName').waitFor({ state: 'visible', timeout: 30_000 });
    };

    /**
     * The "Connection Failed" modal, dismissed.
     *
     * With no agent it opens over whatever the user is on, and it traps focus
     * -- correctly, that is what a modal is for. But it is not the surface
     * under test on twelve of these thirteen screens, and while it is open the
     * keyboard walk measures its buttons instead of theirs. `dismissed`
     * survives until the connection succeeds, so one dismissal per load holds.
     *
     * It is scanned on its own below rather than merely suppressed: with no
     * agent running it is the first screen a real user meets.
     */
    /** A surface that does not exist in this world. Its assertions are skipped. */
    const UNREACHABLE = Symbol('unreachable');

    /** The tab actually became the selected one. */
    const expectSelected = async (trigger, name) => {
      const selected = await trigger
        .getAttribute('aria-selected')
        .then((value) => value === 'true')
        .catch(() => false);
      record(`${name}: the tab it names is the one showing`, selected);
    };

    const screens = [
      ['landing', async () => { await page.goto(APP, { waitUntil: 'domcontentloaded' }); }],
      ['sign-in', async () => {
        await page.goto(APP, { waitUntil: 'domcontentloaded' });
        await page.getByTestId('sign-in-button').click();
      }],
      ['create-account', async () => {
        await page.goto(APP, { waitUntil: 'domcontentloaded' });
        await page.getByTestId('create-account-button').click();
      }],
      ['manage-accounts', async () => {
        await page.goto(APP, { waitUntil: 'domcontentloaded' });
        await page.getByTestId('manage-accounts-button').click();
      }],
      // Settings is reachable from the landing page with no account, and every
      // tab is its own surface. The Theme tab shipped a serious
      // `aria-input-field-name`: Radix puts `role="slider"` on the THUMB, so the
      // `<Label htmlFor>` beside it named nothing, and the Font Size control had
      // no accessible name at all. Four surfaces were being scanned while this
      // one sat one click away.
      // Four tabs of six: Security opens without a session, and says it needs one.
      //
      // Connect and Perms carry `disabled` with "Connect to a workspace first"
      // when there is no session. The click here used to be forced, so it went
      // through the disabled attribute, the tab never changed, and two of these
      // five surfaces were scanning whichever tab was already open under
      // somebody else's name. Their real contents are covered by the
      // authenticated Playwright spec, which has a session. What is asserted
      // here instead is the property that matters when they are out of reach:
      // that they say why.
      ...['General', 'Theme', 'Privacy', 'Security'].map((tab) => [
        `settings/${tab}`,
        async () => {
          // From a fresh load every time, and waiting rather than sleeping.
          // The conditional "only open Settings if a tab is not already
          // showing" version depended on the previous surface leaving the
          // modal open, which is the same hidden sequence that timed the
          // wizard steps out in CI.
          await page.goto(APP, { waitUntil: 'domcontentloaded' });
          await page.locator('button').filter({ hasText: /^Settings$/ }).first().click();
          const trigger = page.locator('[role="tab"]').filter({ hasText: tab }).first();
          await trigger.waitFor({ state: 'visible', timeout: 30_000 });
          // A DISABLED tab is not a surface, and pretending otherwise scanned
          // the wrong one.
          //
          // Settings > Connect carries `disabled` with the title "Connect to a
          // workspace first" when there is no session. The click used to be
          // forced, so it went through the disabled attribute, the tab never
          // changed, and the check scanned whatever tab was already open while
          // reporting it as `settings/Connect`. Recorded rather than skipped: a
          // surface that quietly drops off the list is how a list shrinks to
          // nothing.
          if (await trigger.isDisabled()) {
            record(`settings/${tab}: is reachable`, false,
              `the tab is disabled here: ${(await trigger.getAttribute('title')) ?? 'no reason given'}`);
            // UNREACHABLE, not merely unclicked: everything below would then be
            // measured against whichever tab is open and reported under this
            // one's name, which is exactly what the forced click was doing.
            return UNREACHABLE;
          }
          await trigger.click();
          // The click LANDED. Forced clicks made this unobservable.
          await expectSelected(trigger, `settings/${tab}`);
        },
      ]),
      // The two tabs a visitor cannot open, and the reason they give.
      //
      // A disabled control with no explanation is a dead end; one with a `title`
      // at least says why on a desktop. That `title` is invisible on a touch
      // screen -- recorded, not fixed here, because the fix is a visible reason
      // and that is a design decision rather than a defect to sneak in.
      ['settings/session-gated tabs', async () => {
        await page.goto(APP, { waitUntil: 'domcontentloaded' });
        await page.locator('button').filter({ hasText: /^Settings$/ }).first().click();
        for (const tab of ['Connect', 'Perms']) {
          const trigger = page.locator('[role="tab"]').filter({ hasText: tab }).first();
          await trigger.waitFor({ state: 'visible', timeout: 30_000 });
          const disabled = await trigger.isDisabled();
          const reason = (await trigger.getAttribute('title')) ?? '';
          record(`settings/${tab}: needs a session, and says so`, disabled && reason.length > 0,
            disabled ? reason : 'not disabled without a session');
        }
      }],
      // The wizard's later steps, which the four-surface list never reached.
      // Round 208's defect was on a surface exactly like these: reachable in
      // three clicks, scanned by nothing that runs without a backend, and
      // broken by a change made somewhere else entirely.
      // Each of these walks the wizard from the START.
      //
      // They used to chain -- `join/profile` clicked Next on whatever
      // `join/security` had left behind. That worked locally and timed out in
      // CI, waiting thirty seconds for `#fullName` on a step that was never
      // reached because the previous click had not landed yet on a slower
      // machine. A surface that depends on the previous surface's state is not
      // a check, it is a sequence, and it fails as one.
      ['join/security', async () => {
        await toSecurityStep();
      }],
      ['join/profile', async () => {
        await toProfileStep();
      }],
      // The ERROR state, not just the empty form. Field errors are where
      // `aria-invalid` and `aria-describedby` are either present or the user is
      // told nothing they can act on — and an empty form proves neither.
      ['join/profile with a validation error', async () => {
        await toProfileStep();
        await page.locator('#fullName').fill('Probe');
        await page.locator('#username').fill('probe1');
        await page.locator('#password').fill('password123');
        await page.locator('#confirmPassword').fill('different999');
        await page.locator('button').filter({ hasText: /^Join$/ }).last().click();
        await page.waitForTimeout(1_200);
      }],
      // The agent-down modal itself. This gate pins a closed agent port, so it
      // is deterministic here rather than appearing only on the machines where
      // nothing is running -- which is how it went unscanned while silently
      // corrupting the measurement of the screen underneath it.
      ['connection-failed', async () => {
        await page.goto(APP, { waitUntil: 'domcontentloaded' });
        await page.getByTestId('connection-retry-modal').waitFor({ state: 'visible', timeout: 60_000 });
      }],
      // Any unrouted path. Cheap, and it is the one screen a user reaches by
      // accident rather than on purpose.
      ['not-found', async () => {
        await page.goto(`${ORIGIN}/no-such-page`, { waitUntil: 'domcontentloaded' });
      }],
    ];

    /**
     * What each surface must turn out to BE.
     *
     * Reporting the measured scope was enough to reveal that six screens were
     * being scanned through the connection modal; it is not enough to keep them
     * from drifting back. Every assertion in this gate is only as good as the
     * element it ran against, so the element is asserted first.
     */
    const EXPECTED_SCOPE = {
      landing: 'document',
      // Both doors are AGENT-GATED and this world has no agent, so neither
      // dialog opens and the surface under scan is the landing document. That
      // is asserted rather than assumed: `sign-in: stays shut while the agent
      // is unreachable` below pins the gate itself, and this pins what is
      // actually being scanned in its place, so neither reads as coverage of a
      // dialog nobody opened. Their contents are covered by the authenticated
      // Playwright specs, which have an agent.
      'sign-in': 'document',
      'create-account': 'Create Account',
      'manage-accounts': 'Manage Accounts',
      'settings/General': 'Settings',
      'settings/Theme': 'Settings',
      'settings/Privacy': 'Settings',
      'settings/Security': 'Settings',
      'settings/session-gated tabs': 'Settings',
      'join/security': 'Security Settings',
      'join/profile': 'Create Your Profile',
      'join/profile with a validation error': 'Create Your Profile',
      'connection-failed': 'Connection Failed',
      'not-found': 'document',
    };
    record(
      'every screen has an expected scope',
      screens.every(([n]) => n in EXPECTED_SCOPE)
        && Object.keys(EXPECTED_SCOPE).length === screens.length,
      `${Object.keys(EXPECTED_SCOPE).length} expectations for ${screens.length} screens`,
    );

    // Stepping back and forward again must not discard what was typed.
    //
    // Measured: it did. The profile step unmounts when the user goes Back to
    // security, so its state died with it -- one step back to check a setting
    // cleared the name, the username and both passwords, with no warning and
    // nothing to recover them from. The address survived (it lives a step up)
    // and the security settings survived, which made the loss read as a glitch
    // rather than the rule.
    {
      await page.goto(APP, { waitUntil: 'domcontentloaded' });
      await dismissConnectionFailure(page);
      await toProfileStep();
      await page.locator('#fullName').fill('Ada Lovelace');
      await page.locator('#username').fill('ada');
      await page.locator('button').filter({ hasText: /^Back$/ }).last().click();
      await page.getByRole('heading', { name: /Security/i }).waitFor({ state: 'visible', timeout: 30_000 });
      await page.locator('button').filter({ hasText: /^Next$/ }).last().click();
      await page.locator('#fullName').waitFor({ state: 'visible', timeout: 30_000 });
      const kept = await page.evaluate(() => ({
        fullName: document.getElementById('fullName')?.value ?? '',
        username: document.getElementById('username')?.value ?? '',
      }));
      record(
        'the wizard keeps what was typed when you step back and forward',
        kept.fullName === 'Ada Lovelace' && kept.username === 'ada',
        JSON.stringify(kept),
      );
    }

    // Closing a dialog must put focus back where it came from.
    //
    // Measured on Manage Accounts: closing with Escape *or* with its Close
    // button left `document.activeElement` on `<body>`, so a keyboard user was
    // dropped at the top of the document and had to tab back down to where they
    // were. The other two dialogs on the same screen restored it. Nothing in a
    // static scan can see the difference -- the markup is identical either way,
    // and axe has no opinion about what happens after a dialog closes.
    // Sign-in and create-account are AGENT-GATED and this world has no agent.
    //
    // Both doors wait for the agent before they open anything — a deliberate
    // change, so that a first-run visitor is told to start the agent instead of
    // being dropped into a form that cannot submit. Their dialogs therefore
    // cannot open here, and this loop used to wait 30 seconds for one and fail
    // the whole check with "the check ran to completion".
    //
    // The gated behaviour is asserted instead of skipped: with no agent, the
    // door must not open the FORM. That is a real property — a regression that
    // let a login form open on a connection that cannot complete would fail
    // this. Focus management is then checked on the one dialog this world can
    // actually open. `check-agent-down.mjs` owns the rest of the agent-down
    // first run.
    //
    // This used to assert that NO dialog opened at all, which was true and is
    // no longer. After a visitor dismisses the connection dialog, the door had
    // nothing left to point at and answered a click with silence — no dialog,
    // no message, no navigation. It now reopens the dialog that explains the
    // state and carries the download link (round 678), so "no dialog" would
    // now fail against the better behaviour.
    //
    // What replaces it is narrower AND stronger: the form must not open, and
    // what opens instead must be the surface that says why. "Nothing happened"
    // and "the right thing happened" are no longer indistinguishable.
    for (const [name, testid] of [['sign-in', 'sign-in-button']]) {
      await page.goto(APP, { waitUntil: 'domcontentloaded' });
      await dismissConnectionFailure(page);
      const trigger = page.getByTestId(testid);
      await trigger.click();
      // 30s, not a token wait: measured, the form stays shut for the full
      // interval with no agent. A shorter timeout would assert the same thing
      // about a form that merely opens slowly, which is a different claim.
      const formOpened = await page
        .locator('#username')
        .waitFor({ state: 'visible', timeout: 30_000 })
        .then(() => true)
        .catch(() => false);
      record(`${name}: the login form stays shut while the agent is unreachable`, !formOpened);
      const explained = await page
        .getByTestId('connection-retry-modal')
        .waitFor({ state: 'visible', timeout: 15_000 })
        .then(() => true)
        .catch(() => false);
      record(`${name}: pressing it explains why, instead of doing nothing`, explained);
    }

    for (const [name, testid] of [
      ['manage-accounts', 'manage-accounts-button'],
    ]) {
      await page.goto(APP, { waitUntil: 'domcontentloaded' });
      await dismissConnectionFailure(page);
      const trigger = page.getByTestId(testid);
      await trigger.focus();
      await trigger.click();
      await page.locator('[role="dialog"]').first().waitFor({ state: 'visible', timeout: 30_000 });
      const movedIn = await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'));
      record(`${name}: opening moves focus into the dialog`, movedIn);
      // Closed by its own Close/Cancel control, not by Escape.
      //
      // Escape is measured separately below, because it turned out to be
      // intermittent here in a way this run could not pin down: the same
      // sequence closed the dialog on some runs and not others, with identical
      // storage and an identical layer stack (`data-scroll-locked`, two focus
      // guards, five aria-hidden roots on the way in; all gone on the way out).
      // Attributing that to the focus assertion would have made a real property
      // unmeasurable behind a flaky one.
      const closer = page
        .locator('[role="dialog"] button')
        .filter({ hasText: /^(Close|Cancel|Back)$/ })
        .last();
      if (await closer.isVisible().catch(() => false)) {
        await closer.click();
      } else {
        await page.keyboard.press('Escape');
      }
      const closed = await page
        .locator('[role="dialog"]')
        .first()
        .waitFor({ state: 'detached', timeout: 10_000 })
        .then(() => true)
        .catch(() => false);
      record(`${name}: it can be closed`, closed);

      // Polled, not sampled: the content stays mounted for its exit animation
      // and focus is restored when it finally goes, so a single read taken a
      // fixed moment after the close catches whichever side of that it lands on.
      let returned = false;
      for (let attempt = 0; attempt < 20 && !returned; attempt += 1) {
        returned = await page.evaluate(
          (id) => document.activeElement?.getAttribute('data-testid') === id,
          testid,
        );
        if (!returned) await page.waitForTimeout(200);
      }
      record(`${name}: closing returns focus to what opened it`, returned,
        returned ? '' : `left on ${await page.evaluate(() => `${document.activeElement?.tagName ?? 'nothing'} "${(document.activeElement?.textContent ?? '').trim().slice(0, 20)}"`)}`);
    }

    let scanned = 0;
    for (const [name, go] of screens) {
      if ((await go()) === UNREACHABLE) continue;
      // Animations move elements while axe measures them, and a colour read
      // mid-transition is fiction. Settle before scanning.
      await page.waitForTimeout(1_200);
      // After the settle, not before it. On the validation-error surface the
      // submit itself re-opens the modal a beat after `go()` returns, so a
      // dismissal placed earlier left it standing over the form -- and the
      // walk then measured its seven buttons and passed, which is exactly the
      // reading this gate is supposed to make impossible.
      if (name !== 'connection-failed') await dismissConnectionFailure(page);
      const { violations } = await new AxeBuilder({ page }).withTags(WCAG).analyze();
      scanned += 1;

      // axe does not check error ASSOCIATION.
      //
      // Dropping `aria-describedby` from an invalid field and orphaning its
      // message leaves the scan completely green -- measured, not assumed. A
      // screen-reader user then hears "invalid entry" with no idea what is
      // wrong. So the association is asserted directly, on the one surface that
      // has an error in it, rather than left to a scan that cannot see it.
      // Everything the user can act on must be reachable by Tab.
      //
      // axe does not traverse: it inspects a static tree, so a control that is
      // present, named and correctly roled but sits outside the tab order
      // passes every rule it has. That is the whole failure mode for a keyboard
      // user, and this repository has shipped it before -- the join form's
      // password toggle carried `tabIndex={-1}`, so nobody using a keyboard
      // could reveal what they had typed.
      //
      // Composite widgets are excluded deliberately, not overlooked. A Radix
      // TabsList uses roving tabindex: exactly one tab is tabbable and the
      // arrow keys move between them, which is the correct pattern and reads
      // as "unreachable" to a naive count. Expecting each tab to be a separate
      // Tab stop was this rule's first output, and it was wrong.
      const collectExpected = async () => page.evaluate(async () => {
        const scope = window.__a11yScope();
        const COMPOSITE = new Set(['tab', 'radio', 'menuitem', 'option', 'treeitem']);
        const describe = (el) =>
          `${el.tagName}:${(el.getAttribute('aria-label') || el.id || (el.textContent || '').trim()).slice(0, 24)}`;
        const expected = [...scope.querySelectorAll('button, a[href], input, select, textarea')]
          .filter((el) => el.offsetParent !== null && !el.disabled)
          // Radix mirrors a checkbox inside a <form> with a native input that
          // is aria-hidden, invisible and pointer-events:none: nobody, by any
          // means, can act on it. Only that combination is excluded -- an
          // aria-hidden control a pointer can still reach stays expected.
          .filter((el) => !(el.closest('[aria-hidden="true"]')
            && getComputedStyle(el).pointerEvents === 'none'
            && getComputedStyle(el).opacity === '0'))
          // NOT filtered on `tabindex="-1"`.
          //
          // That filter was here first, and it made the rule unable to fail:
          // marking a control `tabIndex={-1}` removed it from the expectations,
          // so the exact defect this exists for -- the join form's password
          // toggle, which shipped with `tabIndex={-1}` and could not be reached
          // by any keyboard user -- would have been excluded rather than
          // reported. Both negative controls passed, which is the only reason
          // it was noticed.
          //
          // `-1` is the defect, not an exemption. The legitimate uses of it are
          // composite-widget members, and those are excluded by role below.
          .filter((el) => !COMPOSITE.has(el.getAttribute('role') ?? ''))
          .filter((el) => !el.closest('[role="tablist"],[role="radiogroup"],[role="menu"],[role="listbox"]'));
        const heading = scope.querySelector('h1,h2,h3,[id$="-title"]');
        const identity = scope === document.body
          ? 'document'
          : `dialog "${(heading?.textContent ?? '').trim().slice(0, 28)}"`;
        return { expected: expected.map(describe), identity };
      });

      const unreachable = await collectExpected();

      const reached = new Set();
      for (let i = 0; i < unreachable.expected.length * 3 + 6; i += 1) {
        await page.keyboard.press('Tab');
        const focused = await page.evaluate(() => {
          const el = document.activeElement;
          if (!el || el === document.body) return null;
          return `${el.tagName}:${(el.getAttribute('aria-label') || el.id || (el.textContent || '').trim()).slice(0, 24)}`;
        });
        if (focused) reached.add(focused);
      }
      // A surface with nothing on it passes every assertion below without
      // examining anything. That is how the wrong-scope bug stayed green: the
      // probes ran against a dialog that was not the screen under test, and
      // "no two controls share a name" is trivially true of a set of one.
      record(
        `${name}: has controls to examine`,
        unreachable.expected.length > 0,
        `${unreachable.expected.length} control(s) in ${unreachable.identity}`,
      );
      record(
        `${name}: measured the intended surface`,
        unreachable.identity.includes(EXPECTED_SCOPE[name] ?? '\u0000'),
        unreachable.identity,
      );

      // Re-measured AFTER tabbing, and only controls present in BOTH readings
      // can fail.
      //
      // The expected set is a snapshot; the surface is live. The
      // connection-failed dialog runs an automatic retry countdown, and when it
      // fires mid-probe `Retry Now` becomes `disabled` — removed from the tab
      // order by the platform, exactly as it should be. It was captured while
      // enabled and judged while disabled, so the gate reported a control that
      // is reachable whenever it is reachable at all. CI failed on it; a local
      // run with different timing passed.
      //
      // This narrows the claim rather than weakening it: a control that stays
      // enabled and visible and is still never focused fails exactly as before.
      // A control that DISAPPEARED or disabled itself during the probe is a
      // different statement, and not one this rule is entitled to make.
      const stillExpected = new Set((await collectExpected()).expected);
      const missed = [...new Set(unreachable.expected.filter((e) => !reached.has(e)))]
        .filter((e) => stillExpected.has(e));
      record(`${name}: every control is reachable by keyboard`, missed.length === 0, missed.join(' | '));

      // A combobox must be named by its LABEL, not by its value.
      //
      // Radix renders a select trigger as `<button role="combobox">`, and
      // `htmlFor` labels only labelable elements -- so the conventional
      // `<Label htmlFor="x">` beside `<SelectTrigger id="x">` names nothing and
      // the accessible name falls back to the trigger's contents, which is the
      // current value. Measured on Settings: "Connections" and "Default".
      //
      // axe passes that, because a name computed from contents is still a name.
      // What it cannot see is that the name is the wrong THING, and that it
      // changes when the value does, so there is nothing stable to refer to.
      const unnamedSelects = await page.evaluate(() => {
        const scope = window.__a11yScope();
        return [...scope.querySelectorAll('[role="combobox"]')]
          .filter((el) => el.offsetParent !== null)
          .filter((el) => !el.getAttribute('aria-label') && !el.getAttribute('aria-labelledby'))
          .map((el) => `${el.id || '(no id)'}: "${(el.textContent || '').trim().slice(0, 24)}"`);
      });
      record(
        `${name}: every select is named by its label`,
        unnamedSelects.length === 0,
        unnamedSelects.join('; '),
      );

      // Two controls with the same accessible name, in the same view.
      //
      // axe does not report it: each button HAS a name, which is all
      // `button-name` asks. But the create-account form had two toggles both
      // called "Show password", one per password field, and a screen-reader
      // user tabbing through hears the same name twice with nothing to say
      // which field they are on. WCAG 4.1.2 wants the name to identify the
      // control, and an action alone does not when the action repeats.
      const duplicates = await page.evaluate(() => {
        const scope = window.__a11yScope();
        const names = [...scope.querySelectorAll('button')]
          .filter((b) => b.offsetParent !== null)
          // Buttons only, by ROLE. A `<button role="tab">` named "Connections"
          // beside a `<button role="combobox">` whose VALUE is "Connections"
          // is not a collision: a screen reader says "Connections, tab" and
          // "Connections, combobox", and the roles tell them apart. That pair
          // was the rule's first output and it was a false positive, which is
          // worth more than a green run -- a check that cries wolf gets muted.
          //
          // The combobox also shows why `textContent` is not a name in general:
          // on a Radix select trigger it is the current VALUE. Restricting to
          // plain buttons keeps the extraction honest.
          .filter((b) => !b.hasAttribute('role') || b.getAttribute('role') === 'button')
          .map((b) => (b.getAttribute('aria-label') || b.textContent || '').trim())
          .filter((n) => n.length > 0);
        return [...new Set(names.filter((n, i) => names.indexOf(n) !== i))];
      });
      record(
        `${name}: no two controls share a name`,
        duplicates.length === 0,
        duplicates.join('; '),
      );

      if (name.includes('validation error')) {
        const association = await page.evaluate(() => {
          const field = document.querySelector('[aria-invalid="true"]');
          if (!field) return { ok: false, why: 'nothing is marked invalid' };
          const id = field.getAttribute('aria-describedby');
          if (!id) return { ok: false, why: `${field.id} is invalid but describes nothing` };
          const message = document.getElementById(id);
          if (!message) return { ok: false, why: `${field.id} points at #${id}, which does not exist` };
          const text = (message.textContent ?? '').trim();
          return text.length > 0
            ? { ok: true, why: text.slice(0, 40) }
            : { ok: false, why: `#${id} is empty` };
        });
        record('the invalid field names its error', association.ok, association.why);
      }
      const blocking = violations.filter((v) => BLOCKING.has(v.impact));
      record(
        `${name}: no serious or critical violations`,
        blocking.length === 0,
        blocking.map((v) => `${v.id} x${v.nodes.length}`).join('; '),
      );
    }

    // A scan that reached no screen is a clean run over nothing.
    record('every screen was reached', scanned === screens.length, `${scanned}/${screens.length}`);

    await context.close();
  } catch (error) {
    // The first SIX lines, not one. Playwright's actionability messages put the
    // useful part -- which element, and what was in the way -- below the first
    // line, and a one-line crash report of "Timeout 30000ms exceeded" names
    // neither. Round 225's lesson, in this file's own error path.
    crashed = error instanceof Error
      ? error.message.split('\n').slice(0, 8).map((l) => l.trim()).filter(Boolean).join(' | ')
      : String(error);
  } finally {
    await browser.close();
    preview.kill();
  }

  if (crashed) {
    record('the check ran to completion', false, crashed);
  }


  const width = Math.max(...results.map((r) => r.name.length));
  console.log(`\n  Accessibility — ${ORIGIN} (production bundle, 375px)\n`);
  for (const { name, ok, detail } of results) {
    console.log(`  ${name.padEnd(width)}  ${ok ? 'ok  ' : 'FAIL'}${detail ? `  ${detail}` : ''}`);
  }
  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    console.error(`\n  ${failed.length} accessibility check(s) failed.\n`);
    process.exit(1);
  }
  console.log('\n  All accessibility checks passed.\n');
}

await main();
