import { strict as assert } from 'node:assert';
import { settled } from './checks-controls.mjs';
import { clippedUnder } from './overflow-probe.mjs';
import { scenarioNames } from './checks-dialog-footers.mjs';

/**
 * Nothing any scenario draws clips content it cannot show (overflow-probe.mjs, `clippedUnder`),
 * measured at rest on the page as the scenario first draws it, dialogs included.
 *
 * The mechanism, not one surface: the owner's report was the Calendar cut off inside its tab, and
 * the same mechanism also cut a member row's second line (a fixed-height sidebar button) and the
 * file manager's list (an overflow-hidden flex child shrinking under its scroller). A surface the
 * harness draws is measured here without anyone writing a check for it.
 */
async function nothingAnyScenarioDrawsIsClipped({ page, url }) {
  const failures = [];
  const names = await scenarioNames(page, url);
  // 93 when this was written; far fewer means the page stopped listing them, not that they went.
  assert.ok(names.length >= 90, `the harness lists only ${names.length} scenarios`);
  for (const scenario of names) {
    await page.goto(url(scenario));
    await page.waitForFunction(() => document.getElementById('root')?.childElementCount > 0 || document.querySelector('[role="dialog"]') !== null);
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
    await settled(page);
    failures.push(...(await page.evaluate(clippedUnder, 'body')).map((f) => `${scenario}: ${f}`));
  }
  assert.deepEqual(failures, []);
}

export const CLIPPING_CHECKS = { nothingAnyScenarioDrawsIsClipped };
