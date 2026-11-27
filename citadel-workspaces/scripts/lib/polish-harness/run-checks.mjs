/**
 * Runs a set of geometry checks over the harness: every engine, viewport and theme, one fresh page each.
 * The engines come from POLISH_ENGINES (CI installs Chromium only; a machine with WebKit leaves it unset).
 */
import { chromium, webkit } from 'playwright';
import { serveHarness } from './serve.mjs';
import { assertParity, newParityContext, pagesMadeBy } from '../ci-parity.mjs';

const AVAILABLE = { chromium, webkit };
// CI installs Chromium only; a machine with WebKit sets POLISH_ENGINES=chromium,webkit (the default).
export const ENGINES = Object.fromEntries(
  (process.env.POLISH_ENGINES ?? 'chromium,webkit').split(',').map((name) => {
    if (!AVAILABLE[name]) throw new Error(`POLISH_ENGINES names an engine this gate cannot drive: ${name}`);
    return [name, AVAILABLE[name]];
  }),
);
const VIEWPORTS = [{ width: 1280, height: 800 }, { width: 390, height: 844 }];
const THEMES = ['light', 'dark'];
/** Reduced motion only: what every geometry gate measured before motions were a dimension. */
const REDUCED_ONLY = [{ name: 'reduced', reducedMotion: 'reduce', tier: 'full' }];

export function runChecks(CHECKS) {
  return runMatrix(CHECKS, { viewports: VIEWPORTS, motions: REDUCED_ONLY });
}

/**
 * WebKit's build for this Playwright (2272) stops answering a page's close at about the 64th page one browser
 * has made, and every later call on that browser then waits for ever at no CPU. Each axe scan makes and closes
 * a page, so the 64th fell wherever the scan count put it (theCalendarTabSaysWhyAndWhatToDo in the full sweep).
 * A browser is relaunched before it has made this many pages, in any context a check gives it (ci-parity.mjs
 * counts them); one rule for every engine keeps the runs alike.
 */
const PAGES_PER_BROWSER = 48;

/**
 * The same run over chosen viewports and motions. A motion is the media preference the context
 * reports and the app's own tier (`lite` sets the class the app's Lite motion sets).
 */
export async function runMatrix(CHECKS, { viewports, motions }) {
  assertParity();
  const harness = await serveHarness();
  let failures = 0;
  try {
    for (const [engineName, engine] of Object.entries(ENGINES)) {
      let browser = await engine.launch();
      for (const viewport of viewports) {
        for (const theme of THEMES) for (const motion of motions) {
          const newContext = () => newParityContext(browser, { viewport, reducedMotion: motion.reducedMotion });
          let context = await newContext();
          const origin = (scenario) => `${harness.origin}/?s=${scenario}&theme=${theme}&motion=${motion.tier}`;
          const open = async () => {
            const page = await context.newPage();
            // The dev server transforms modules on first request, and WebKit waits on all of them before `load`.
            page.setDefaultNavigationTimeout(90_000);
            page.problems = [];
            page.on('pageerror', (e) => {
              // The whole chat is mounted with no agent behind it, so its own leader probe rejects. That is the
              // absence this scenario is built on, not a defect; any other uncaught error still fails the run.
              if (!e.message.includes('The leader could not say what the agent hosts')) page.problems.push(`pageerror: ${e.message}`);
            });
            return page;
          };
          const attempt = async (page, check) => {
            page.problems.length = 0;
            try { await check({ page, url: origin, viewport }); } catch (error) { return error.message; }
            return page.problems[0] ?? null;
          };
          let page = await open();
          for (const [name, check] of Object.entries(CHECKS)) {
            if (pagesMadeBy(browser) >= PAGES_PER_BROWSER) {
              await page.close();
              await context.close();
              await browser.close();
              browser = await engine.launch();
              context = await newContext();
              page = await open();
            }
            const label = `${name} [${engineName} ${viewport.width}px ${theme}${motions === REDUCED_ONLY ? '' : ` ${motion.name}`}]`;
            const problem = await attempt(page, check);
            if (problem === null) console.log(`  ok    ${label}`);
            else { failures += 1; console.error(`  FAIL  ${label}\n        ${problem}`); }
          }
          await page.close();
          await context.close();
        }
      }
      await browser.close();
    }
  } finally {
    await harness.close();
  }
  // A check may judge the whole run once it is over (a rate across every leg), as `afterAll` returning problems.
  for (const [name, check] of Object.entries(CHECKS)) {
    for (const problem of check.afterAll?.() ?? []) { failures += 1; console.error(`  FAIL  ${name} [whole run]\n        ${problem}`); }
  }
  return failures === 0 ? 0 : 1;
}
