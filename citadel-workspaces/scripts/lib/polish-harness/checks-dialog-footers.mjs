/**
 * Every answer in every dialog the harness opens can be clicked: inside its dialog, and the
 * element a click at its centre reaches.
 *
 * The box alone is not reach. A footer of right-aligned answers that outgrew its dialog sent the
 * overflow out of the dialog's left edge, where no scroll goes; the answer kept its box and a click
 * there landed on the overlay ("Always accept from file_alice_1794760367429", AlwaysAcceptDialog).
 * The shared footers wrap now (ui/footer-layout.ts); this measures the mechanism over every dialog
 * rather than the one dialog that showed it. Scenarios that show a name use a username-style one.
 */
import { strict as assert } from 'node:assert';
import { settled } from './checks-controls.mjs';

const DIALOGS = '[role="dialog"], [role="alertdialog"]';

async function scenarioNames(page, url) {
  await page.goto(url('').replace('s=&', ''));
  return page.evaluate(() => window.harnessScenarios);
}

/**
 * Every enabled button a dialog shows, footer or not: a dialog that lays out its own answers has the
 * same failure as the shared footer had. Scrolled into view first, as a person would, from BOTH ends
 * of every scroller it sits in: scrolling in from the far end stops it at the near edge, under any
 * sticky header or column there. Measured from wherever the previous button left the scroll, the
 * result hung on fonts: CI's wider ones left the role matrix scrolled far enough that its Member
 * checkboxes landed under the sticky permission column, and a dev Mac's did not. Skipped: a
 * disabled button (pointer-events none, so nothing reaches it by design) and a visually hidden one
 * (sr-only clips it to nothing, kept for the keyboard).
 */
function unreachableIn(scenario) {
  const failures = [];
  for (const dialog of document.querySelectorAll('[role="dialog"], [role="alertdialog"]')) {
    for (const button of dialog.querySelectorAll('button')) {
      const style = getComputedStyle(button);
      const first = button.getBoundingClientRect();
      if (button.disabled || button.getAttribute('aria-disabled') === 'true') continue;
      if (first.width < 2 || first.height < 2 || style.visibility === 'hidden' || style.clip === 'rect(0px, 0px, 0px, 0px)') continue;
      const label = `${scenario}: "${(button.innerText || button.getAttribute('aria-label') || '').trim().slice(0, 60)}"`;
      const scrollers = [];
      for (let el = button.parentElement; el !== null && el !== dialog.parentElement; el = el.parentElement) {
        if (el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight) scrollers.push(el);
      }
      for (const from of ['the far end', 'the start']) {
        for (const el of scrollers) {
          el.scrollLeft = from === 'the start' ? 0 : el.scrollWidth;
          el.scrollTop = from === 'the start' ? 0 : el.scrollHeight;
        }
        button.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        const box = button.getBoundingClientRect();
        const frame = dialog.getBoundingClientRect();
        const within = box.left >= frame.left - 0.5 && box.right <= frame.right + 0.5 && box.top >= frame.top - 0.5 && box.bottom <= frame.bottom + 0.5;
        if (!within) { failures.push(`${label} [${Math.round(box.left)}..${Math.round(box.right)}] leaves its dialog [${Math.round(frame.left)}..${Math.round(frame.right)}]`); break; }
        if (!button.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2))) { failures.push(`${label}: scrolled in from ${from}, a click at its centre does not reach it`); break; }
      }
    }
  }
  return failures;
}

/** Each answer in each dialog any scenario opens is inside the dialog and reachable. */
async function everyDialogAnswerIsReachable({ page, url }) {
  const failures = [];
  let measured = 0;
  for (const scenario of await scenarioNames(page, url)) {
    await page.goto(url(scenario));
    // Mounted, then two frames for effects that open a dialog once data arrives (role-permissions).
    await page.waitForFunction(() => document.getElementById('root')?.childElementCount > 0 || document.querySelector('[role="dialog"]') !== null);
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
    if (await page.locator(DIALOGS).count() === 0) continue;
    await settled(page);
    measured += 1;
    failures.push(...await page.evaluate(unreachableIn, scenario));
  }
  // Twelve scenarios open a dialog at 1280px, thirteen at 390px (where the file manager's inspector
  // opens as one); fewer means the wait above stopped seeing some of them.
  assert.ok(measured >= 12, `only ${measured} scenarios opened a dialog: the check stopped measuring some`);
  assert.deepEqual(failures, []);
}

export const DIALOG_FOOTER_CHECKS = { everyDialogAnswerIsReachable };
