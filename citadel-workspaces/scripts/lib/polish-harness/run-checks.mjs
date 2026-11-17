/**
 * Runs a set of geometry checks over the harness: every engine, viewport and theme, one fresh page each.
 * The engines come from POLISH_ENGINES (CI installs Chromium only; a machine with WebKit leaves it unset).
 */
import { chromium, webkit } from 'playwright';
import { serveHarness } from './serve.mjs';
import { assertParity, newParityContext } from '../ci-parity.mjs';

const AVAILABLE = { chromium, webkit };
// CI installs Chromium only; a machine with WebKit sets POLISH_ENGINES=chromium,webkit (the default).
const ENGINES = Object.fromEntries(
  (process.env.POLISH_ENGINES ?? 'chromium,webkit').split(',').map((name) => {
    if (!AVAILABLE[name]) throw new Error(`POLISH_ENGINES names an engine this gate cannot drive: ${name}`);
    return [name, AVAILABLE[name]];
  }),
);
const VIEWPORTS = [{ width: 1280, height: 800 }, { width: 390, height: 844 }];
const THEMES = ['light', 'dark'];
/** Reduced motion only: what every geometry gate measured before motions were a dimension. */
const REDUCED_ONLY = [{ name: 'reduced', reducedMotion: 'reduce', tier: 'full' }];

export function runChecks(CHECKS, port) {
  return runMatrix(CHECKS, port, { viewports: VIEWPORTS, motions: REDUCED_ONLY });
}

/**
 * The same run over chosen viewports and motions. A motion is the media preference the context
 * reports and the app's own tier (`lite` sets the class the app's Lite motion sets).
 */
export async function runMatrix(CHECKS, port, { viewports, motions }) {
  assertParity();
  const harness = await serveHarness(port);
  let failures = 0;
  try {
    for (const [engineName, engine] of Object.entries(ENGINES)) {
      const browser = await engine.launch();
      for (const viewport of viewports) {
        for (const theme of THEMES) for (const motion of motions) {
          const context = await newParityContext(browser, { viewport, reducedMotion: motion.reducedMotion });
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
  return failures === 0 ? 0 : 1;
}
