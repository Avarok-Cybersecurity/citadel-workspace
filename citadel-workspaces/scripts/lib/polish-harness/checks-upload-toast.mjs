import { strict as assert } from 'node:assert';

/**
 * The upload toast that says a push is waiting for the earlier transfer to finish, measured in a
 * real engine at desktop and phone widths: the whole toast is on screen, its words stay inside
 * it (a long unbroken file name wraps instead of running out of the box), and the page does not
 * scroll sideways.
 */
const WAITING = ': waiting for the earlier transfer to finish…';

async function theWaitingToastFitsTheScreen({ page, url, viewport }) {
  await page.goto(url('upload-waiting-toast'));
  const toast = page.locator('[data-sonner-toast]');
  await toast.waitFor({ state: 'visible' });
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))));
  const title = toast.locator('[data-title]');
  const text = await title.textContent();
  assert.ok(text.endsWith(WAITING), `the toast reads "${text}", not the waiting state`);
  const box = await toast.boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= viewport.width + 0.5, `the toast ${JSON.stringify(box)} leaves the ${viewport.width}px page`);
  assert.ok(box.y >= 0 && box.y + box.height <= viewport.height + 0.5, `the toast ${JSON.stringify(box)} leaves the ${viewport.height}px-high page`);
  const words = await title.boundingBox();
  assert.ok(words.x >= box.x - 0.5 && words.x + words.width <= box.x + box.width + 0.5, `the words ${JSON.stringify(words)} run out of the toast ${JSON.stringify(box)}`);
  const spill = await title.evaluate((el) => el.scrollWidth - el.clientWidth);
  assert.ok(spill <= 0, `the toast's words overflow their box by ${spill}px instead of wrapping`);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 0, `the page scrolls sideways by ${overflow}px`);
}

export const UPLOAD_TOAST_CHECKS = { theWaitingToastFitsTheScreen };
