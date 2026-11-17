/**
 * "Create new workspace", walked end to end in a real browser, in light and
 * dark, at 360 px and at desktop width -- with a screenshot of every screen,
 * an overflow measurement and an axe scan on each.
 *
 * AGAINST A MOCK CONTROL PLANE, and that is a limitation, not a feature. The
 * real one (the tenant Worker's `control/`) is being built concurrently and
 * cannot be called; this answers the agreed contract instead:
 *
 *   GET  /api/slug/:slug                      -> { available, reason? }
 *   POST /api/tenants                         -> free { claim_code, workspace_host } | paid { checkout_url }
 *   GET  /api/tenants/:slug/status?session_id -> { status, claim_code? (once), workspace_host? }
 *   POST /api/coupons/preview                 -> see lib/coupon-walkthrough.mjs
 *
 * Two third parties are stubbed for the same reason -- they cannot be used from
 * here -- and both at the network, so the page's own code runs unmodified:
 *
 *   - Turnstile: a headless browser cannot pass a real challenge. The stub
 *     answers the script URL with a `window.turnstile` that issues numbered
 *     tokens, which the mock control plane then insists on.
 *   - Stripe Checkout: no Stripe call is allowed from this work. The stub
 *     answers checkout.stripe.com with a page offering "Pay" and "Cancel",
 *     which return to the success and cancel URLs the contract names.
 *
 * The page is served by `vite preview` from the production build, with the
 * agent port closed -- a hosted visitor who has not installed the agent. The
 * `<meta name="citadel-control-plane">` is filled in on the way to the browser,
 * as the hosted deployment does. CSP is bypassed ONLY because production's
 * policy does not yet allow challenges.cloudflare.com; that is a recorded
 * follow-up in the parent repository's nginx template, and until it lands the
 * widget shows its "could not be loaded -- Try again" state instead.
 *
 * Usage (after `npx vite build`):
 *   node scripts/create-workspace-walkthrough.mjs <screenshot-dir>
 */
import { mkdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { AxeBuilder } from '@axe-core/playwright';
import { spawnPreview, dismissConnectionFailure } from './lib/preview-world.mjs';
import { mockControlPlane } from './lib/create-control-plane-mock.mjs';
import { walkCoupons } from './lib/coupon-walkthrough.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.WALKTHROUGH_PORT ?? 4191);
const ORIGIN = `http://localhost:${PORT}`;
const OUT = resolve(process.argv[2] ?? join(APP_ROOT, 'walkthrough-shots'));
const VIEWPORTS = [
  { name: 'mobile360', width: 360, height: 780 },
  { name: 'desktop', width: 1280, height: 900 },
];
const THEMES = ['light', 'dark'];

const results = [];
const record = (name, ok, detail = '') => results.push({ name, ok, detail });

const TURNSTILE_STUB = `
  (function () {
    var n = 0; var widgets = {};
    function issue(id) { setTimeout(function () { widgets[id].cb('stub-token-' + (++n)); widgets[id].el.querySelector('span').textContent = 'Verified (stub widget)'; }, 250); }
    window.turnstile = {
      render: function (el, o) {
        var id = 'w' + (++n);
        el.innerHTML = '<div style="display:flex;align-items:center;gap:8px;width:300px;height:65px;border:1px solid #888;border-radius:6px;padding:0 12px;font:14px sans-serif"><b>&#10003;</b><span>Verifying\\u2026</span></div>';
        widgets[id] = { el: el, cb: o.callback }; issue(id); return id;
      },
      reset: function (id) { issue(id); },
      remove: function (id) { if (widgets[id]) widgets[id].el.innerHTML = ''; delete widgets[id]; }
    };
  })();`;

function stripeStub(route) {
  const slug = new URL(route.request().url()).pathname.split('cs_test_')[1];
  const done = `${ORIGIN}/create/done?tenant=${slug}`;
  const back = `${ORIGIN}/create?tenant=${slug}`;
  return route.fulfill({
    contentType: 'text/html',
    body: `<!doctype html><title>Stripe Checkout (stub)</title><body style="font:16px sans-serif;padding:40px">
      <h1>Stripe Checkout (stub)</h1><p>No Stripe call is made. Choose an outcome.</p>
      <a id="pay" href="${done}&session_id=cs_test_${slug}">Pay</a> &nbsp; <a id="cancel" href="${back}&canceled=1">Cancel</a></body>`,
  });
}

async function withMeta(route) {
  const response = await route.fetch();
  const html = (await response.text()).replace(
    'name="citadel-control-plane" content=""',
    'name="citadel-control-plane" content="/api"',
  );
  return route.fulfill({ response, body: html });
}

async function inspect(page, label) {
  // Finite animations only: the spinners run forever and would never settle.
  await page.evaluate(() => Promise.all(document.getAnimations()
    .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
    .map((a) => a.finished.catch(() => {}))));
  await page.screenshot({ path: join(OUT, `${label}.png`), fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  record(`${label}: no horizontal overflow`, overflow <= 0, `overflow ${overflow}px`);
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  record(`${label}: axe`, axe.violations.length === 0, axe.violations.map((v) => `${v.id}(${v.nodes.length})`).join(' '));
  const retry = await page.getByTestId('connection-retry-modal').isVisible();
  const banner = await page.getByTestId('agent-down-banner').isVisible();
  if (page.url().includes('/create')) record(`${label}: no agent dialog or banner over /create`, !retry && !banner);
}

async function run(browser, theme, vp) {
  // Service workers blocked: the PWA's worker answers later navigations from
  // its precache, which would skip the meta fill-in below and the mocks.
  const context = await browser.newContext({ viewport: vp, colorScheme: theme, bypassCSP: true, serviceWorkers: 'block' });
  await context.addInitScript((t) => { try { localStorage.setItem('citadel:theme', t); } catch { /* storage refused */ } }, theme);
  await context.route(/challenges\.cloudflare\.com\/turnstile/, (r) => r.fulfill({ contentType: 'text/javascript', body: TURNSTILE_STUB }));
  await context.route(/checkout\.stripe\.com/, stripeStub);
  await context.route(`${ORIGIN}/api/**`, mockControlPlane());
  await context.route((url) => url.origin === ORIGIN && ['/', '/create', '/create/done'].includes(url.pathname), withMeta);
  const page = await context.newPage();
  const tag = (s) => `${theme}-${vp.name}-${s}`;
  try {
    await walk(page, tag, `${theme} ${vp.name}`);
  } catch (error) {
    await page.screenshot({ path: join(OUT, `${tag('FAILED')}.png`), fullPage: true }).catch(() => {});
    console.error(`${tag('FAILED')} at ${page.url()}:`, (await page.locator('body').innerText().catch(() => '')).slice(0, 600));
    throw error;
  } finally {
    await context.close();
  }
}

/** Create, through the Customer Terms the button now puts up first. */
async function submitWithTerms(page) {
  await page.getByTestId('create-submit').click();
  await page.getByTestId('terms-agree').click();
  await page.getByTestId('terms-accept').click();
}

async function walk(page, tag, variant) {

  // Free: from the landing page, without the agent.
  await page.goto(`${ORIGIN}/?onboarding=1`);
  await dismissConnectionFailure(page);
  const cta = page.getByTestId('create-workspace-link');
  record(tag('landing link shown where a control plane is published'), await cta.isVisible());
  await inspect(page, tag('00-landing'));
  await cta.click();
  await page.getByTestId('create-display-name').fill('Acme');
  await page.getByTestId('create-slug-status').filter({ hasText: 'already taken' }).waitFor();
  record(tag('taken slug blocks Continue'), await page.getByTestId('create-name-continue').isDisabled());
  await inspect(page, tag('01a-name-taken'));
  await page.getByTestId('create-display-name').fill('Acme Robotics');
  await page.getByTestId('create-slug-status').filter({ hasText: 'Available' }).waitFor();
  await inspect(page, tag('01b-name-available'));
  await page.getByTestId('create-name-continue').click();
  await inspect(page, tag('02a-plan-free'));
  await page.getByTestId('plan-team').click();
  await page.getByTestId('interval-year').click();
  await page.getByTestId('plan-seats-increase').click();
  await page.getByTestId('plan-seats-increase').click();
  await page.getByTestId('plan-storage-increase').click();
  const teamTotal = await page.getByTestId('plan-total-amount').innerText();
  record(tag('team yearly 5 seats + 10 GB = $320 / year'), teamTotal === '$320 / year', teamTotal);
  await inspect(page, tag('02b-plan-team-yearly'));
  await page.getByTestId('plan-free').click();
  await page.getByTestId('create-plan-continue').click();
  await page.getByTestId('create-submit').and(page.locator(':enabled')).waitFor();
  await inspect(page, tag('03-review-free'));
  await submitWithTerms(page);
  const code = await page.getByTestId('claim-code').innerText();
  record(tag('claim code shown'), /^[0-9a-f]{8}( [0-9a-f]{8}){7}$/.test(code), code);
  await inspect(page, tag('04a-claim-code'));
  await page.getByTestId('claim-stored').click();
  await page.getByTestId('claim-continue').click();
  record(tag('claim code gone after acknowledging'), (await page.getByTestId('claim-code').count()) === 0
    && !(await page.content()).includes(code));
  await inspect(page, tag('04b-claim-next'));
  await page.getByTestId('claim-open-workspace').click();
  const address = page.getByTestId('server-address-input');
  await address.waitFor({ timeout: 30_000 });
  const prefilled = await address.inputValue();
  // A hosted workspace host is port-less: the agent dials wss://<host>/ on 443, and a :12400 here
  // would send it to a port nothing answers on (src/lib/workspace-address.ts, isTenantHost).
  record(tag('join wizard prefilled with the new host'), prefilled === 'acme-robotics.work.avarok.net', prefilled);
  await page.screenshot({ path: join(OUT, `${tag('05-join-prefilled')}.png`) });

  // Paid: out to Checkout and back.
  await page.goto(`${ORIGIN}/create`);
  await page.getByTestId('create-display-name').fill(`Globex ${variant}`);
  await page.getByTestId('create-slug-status').filter({ hasText: 'Available' }).waitFor();
  const slug = await page.getByTestId('create-slug').inputValue();
  await page.getByTestId('create-name-continue').click();
  await page.getByTestId('plan-business').click();
  await page.getByTestId('plan-seats').fill('5');
  await page.getByTestId('plan-seats').blur();
  await walkCoupons(page, tag, inspect, record);
  await inspect(page, tag('06-review-business'));
  await submitWithTerms(page);
  await page.waitForURL(/checkout\.stripe\.com/);
  record(tag('paid signup redirected to Checkout'), page.url().includes(`cs_test_${slug}`), page.url());
  await page.click('#cancel');
  await page.getByTestId('checkout-cancelled').waitFor();
  await inspect(page, tag('07-cancelled'));
  await page.getByTestId('cancelled-back-to-plans').click();
  record(tag('cancel restores the plan'), (await page.getByTestId('plan-seats').inputValue()) === '5');
  record(tag('cancel restores the code'), (await page.getByTestId('coupon-field').getAttribute('data-state')) === 'applied');
  await page.getByTestId('create-plan-continue').click();
  await page.getByTestId('create-submit').and(page.locator(':enabled')).waitFor();
  await submitWithTerms(page);
  await page.waitForURL(/checkout\.stripe\.com/);
  await page.click('#pay');
  await page.getByTestId('provisioning').waitFor();
  await inspect(page, tag('08-provisioning'));
  await page.getByTestId('claim-code').waitFor({ timeout: 20_000 });
  await inspect(page, tag('09-claim-paid'));

  // Return with a session the control plane does not know.
  await page.goto(`${ORIGIN}/create/done?tenant=nobody-here&session_id=cs_test_unknown`);
  await page.getByTestId('provisioning-failed').waitFor({ timeout: 20_000 });
  await inspect(page, tag('10-provisioning-failed'));

  // The control plane not configured yet.
  await page.goto(`${ORIGIN}/create`);
  await page.getByTestId('create-slug').fill('offline');
  await page.getByTestId('create-slug-status').filter({ hasText: 'not available yet' }).waitFor();
  await inspect(page, tag('11-not-configured'));
}

mkdirSync(OUT, { recursive: true });
const preview = spawnPreview(APP_ROOT, PORT);
let failed = false;
try {
  for (let i = 0; i < 80; i += 1) {
    try { if ((await fetch(`${ORIGIN}/`)).ok) break; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  const browser = await chromium.launch();
  try {
    for (const theme of THEMES) for (const vp of VIEWPORTS) await run(browser, theme, vp);
  } finally {
    await browser.close();
  }
} catch (error) {
  failed = true;
  console.error(error);
} finally {
  preview.kill();
}

for (const r of results) console.log(`  ${r.ok ? 'ok  ' : 'FAIL'} ${r.name}${r.detail ? `  -- ${r.detail}` : ''}`);
const bad = results.filter((r) => !r.ok).length;
console.log(`\n  ${results.length - bad}/${results.length} checks passed; screenshots in ${OUT}`);
process.exit(failed || bad > 0 ? 1 : 0);
