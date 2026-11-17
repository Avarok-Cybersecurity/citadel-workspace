import { strict as assert } from 'node:assert';
import { settled, targetsAreBigEnough } from './checks-controls.mjs';

/** Half a CSS px: the most a centred glyph can be off once the browser has snapped it to the device grid. */
const TOLERANCE = 0.5;

/** A ticked checkbox: the bubble a check is drawn in. */
const TICKED_BOX = '[role="checkbox"][data-state="checked"]';
/** A cell's mark in a read-only column of the role editor (the Owner's always): a tick or a dash in its 24px frame. */
const ROLE_MARK = '[data-role-grant]';

/**
 * Every mark is drawn in the middle of its frame, both ways: a check in its bubble, a reference tick or dash in
 * its cell frame. Measured from the glyph's own box (the svg) to the frame's, so an icon larger than the box it
 * sits in, or a line box taller than the icon, shows up as a number instead of as "looks a bit off".
 */
export const checksAreCentred = (scenario, frames = TICKED_BOX) => async ({ page, url }) => {
  await page.goto(url(scenario));
  const boxes = page.locator(frames);
  await boxes.first().waitFor({ state: 'visible' });
  await settled(page);
  const offsets = await boxes.evaluateAll((all) => all.map((el) => {
    const bubble = el.getBoundingClientRect();
    const glyph = el.querySelector('svg')?.getBoundingClientRect();
    if (!glyph) return { name: el.getAttribute('aria-label') ?? el.dataset.testid, dx: Infinity, dy: Infinity };
    return {
      name: el.getAttribute('aria-label') ?? el.dataset.testid,
      dx: (glyph.left + glyph.width / 2) - (bubble.left + bubble.width / 2),
      dy: (glyph.top + glyph.height / 2) - (bubble.top + bubble.height / 2),
    };
  }));
  assert.ok(offsets.length > 0, `${scenario}: no mark to measure`);
  const off = offsets.filter(({ dx, dy }) => Math.abs(dx) > TOLERANCE || Math.abs(dy) > TOLERANCE);
  assert.equal(off.length, 0, `${scenario}: ${off.length}/${offsets.length} checks off-centre: ${off.slice(0, 4).map(({ name, dx, dy }) => `${name} dx=${dx.toFixed(2)} dy=${dy.toFixed(2)}`).join(' | ')}`);
};

/**
 * One member's editor stays inside the screen and scrolls only its list: the header that says who and
 * where, and the footer that says what Save will do, are on screen together.
 */
async function oneMemberFitsTheScreen({ page, url, viewport }) {
  await page.goto(url('member-permissions'));
  const dialog = page.getByTestId('member-permissions-dialog');
  await dialog.locator('[role="checkbox"]').first().waitFor({ state: 'visible' });
  await settled(page);
  const box = await dialog.boundingBox();
  assert.ok(box.x >= -1 && box.x + box.width <= viewport.width + 1, `the dialog spans ${box.x.toFixed(0)}..${(box.x + box.width).toFixed(0)} in ${viewport.width}px`);
  const sideways = await dialog.evaluate((el) => el.scrollWidth - el.clientWidth);
  assert.ok(sideways <= 1, `the dialog scrolls sideways by ${sideways}px`);
  for (const part of ['member-permissions-path', 'member-permissions-summary', 'member-permissions-save']) {
    const r = await page.getByTestId(part).boundingBox();
    assert.ok(r && r.y >= 0 && r.y + r.height <= viewport.height + 1, `${part} is off screen (${r ? `${r.y.toFixed(0)}..${(r.y + r.height).toFixed(0)}` : 'no box'} of ${viewport.height}px)`);
  }
}

/**
 * The role matrix, in its dialog, never scrolls the dialog sideways and keeps its label column on screen:
 * at 375px it once rendered wider than the viewport, centred, with the PERMISSION column off the left edge.
 * The table scrolls inside its own container; the dialog must not. (Moved here from
 * permission-matrix-phone.spec.ts when the member row's button stopped opening the matrix.)
 */
async function roleMatrixFitsThePhone({ page, url, viewport }) {
  await page.goto(url('role-permissions'));
  const label = page.getByTestId('permission-row-EditMdx');
  await label.waitFor({ state: 'attached' });
  await settled(page);
  const dialog = page.locator('[role="dialog"]').first();
  const sideways = await dialog.evaluate((el) => el.scrollWidth - el.clientWidth);
  assert.ok(sideways <= 1, `the role matrix's dialog scrolls sideways by ${sideways}px at ${viewport.width}px`);
  const box = await label.boundingBox();
  assert.ok(box && box.x >= -1 && box.x + box.width <= viewport.width + 1, `the permission label sits at ${box ? `${box.x.toFixed(0)}..${(box.x + box.width).toFixed(0)}` : 'nowhere'} in ${viewport.width}px`);
  // Every role column is reachable: the table fits, or the box that scrolls it does. A clipped table with
  // no scroller passes both checks above while the right-hand roles simply are not there.
  const reach = await page.locator('table').first().evaluate((table, width) => {
    if (table.getBoundingClientRect().right <= width + 1) return null;
    for (let el = table.parentElement; el; el = el.parentElement) {
      const scrolls = ['auto', 'scroll'].includes(getComputedStyle(el).overflowX) && el.scrollWidth > el.clientWidth + 1;
      if (scrolls) return el.getBoundingClientRect().right <= width + 1 ? null : `its scroller ends at ${el.getBoundingClientRect().right.toFixed(0)}px`;
    }
    return `the table ends at ${table.getBoundingClientRect().right.toFixed(0)}px and nothing scrolls it`;
  }, viewport.width);
  assert.equal(reach, null, `role columns are out of reach at ${viewport.width}px: ${reach}`);
}

/**
 * Under Lite motion a centred dialog stays on screen for every frame of its opening, not only once settled.
 * Lite once zeroed tailwindcss-animate's translate variables, and `enter` animates from that translate to the
 * element's own translate(-50%): every dialog slid in from mid-screen, and a 375px phone saw the member editor
 * 100px past its edge (permission-matrix-phone.spec.ts, on a 4-core CI runner where Auto picks Lite).
 */
async function aLiteDialogOpensInPlace({ page, url, viewport }) {
  // Before React draws anything, on the root as motion-state.ts sets it. An init script runs before <html> exists.
  await page.addInitScript(() => {
    const mark = () => document.documentElement?.classList.add('lite-motion');
    if (document.documentElement) mark();
    else new MutationObserver((_, watch) => { if (document.documentElement) { mark(); watch.disconnect(); } }).observe(document, { childList: true });
  });
  await page.goto(url('member-permissions'));
  const dialog = page.getByTestId('member-permissions-dialog');
  await dialog.waitFor({ state: 'visible' });
  // Sampling frames raced the 200 ms opening: it was often over before the first sample. So the opening is
  // replayed and held at its first frame, where a slide starts furthest out, and measured there.
  const first = await dialog.evaluate((el) => {
    el.style.animationName = 'none';
    void el.offsetWidth;
    el.style.animationName = '';
    const opening = el.getAnimations();
    for (const a of opening) { a.pause(); a.currentTime = 0; }
    const r = el.getBoundingClientRect();
    for (const a of opening) a.finish();
    return { left: r.left, right: r.right, animations: opening.length };
  });
  assert.ok(first.animations > 0, 'the dialog has no opening animation to measure');
  assert.ok(first.left >= -1 && first.right <= viewport.width + 1, `under Lite the dialog opens at ${first.left.toFixed(0)}..${first.right.toFixed(0)}, in ${viewport.width}px`);
}

/**
 * Tabbing through the role matrix never leaves the focused checkbox under its sticky permission
 * column or header (WCAG 2.4.11). Each Tab past a row's last column (Guest) lands on the next row's
 * Member with the table scrolled right; WebKit ignores the scroller's scroll-padding when focus
 * moves, and left all 52 Member checkboxes focused under the permission names until the matrix
 * scrolled them clear itself (PermissionMatrixTable keepFocusClear).
 */
async function aTabbedCheckboxIsNeverUnderTheStickyStrips({ page, url }) {
  await page.goto(url('role-permissions'));
  const boxes = page.locator('[role="dialog"] button[role="checkbox"]');
  await boxes.first().waitFor();
  await settled(page);
  const covered = [];
  let members = 0;
  const count = await boxes.count();
  // Safari's Tab skips buttons unless the person has turned on keyboard navigation; Option-Tab is
  // its Tab to every control, and the walk a keyboard user there makes.
  const tab = page.context().browser().browserType().name() === 'webkit' ? 'Alt+Tab' : 'Tab';
  await boxes.first().focus();
  for (let i = 0; i < count; i += 1) {
    if (i > 0) await page.keyboard.press(tab);
    const focused = await page.evaluate(async () => {
      const el = document.activeElement;
      const scroller = el.closest('.overflow-auto');
      // The matrix corrects a frame after focus moves, smoothly outside reduced motion: two frames
      // for it to start, then until the scroll has stopped.
      for (let still = 0, last = '', frames = 0; (frames < 2 || still < 2) && frames < 180; frames += 1) {
        await new Promise((done) => requestAnimationFrame(done));
        const now = `${scroller.scrollLeft},${scroller.scrollTop}`;
        still = now === last ? still + 1 : 0;
        last = now;
      }
      const box = el.getBoundingClientRect();
      return { label: el.getAttribute('aria-label') ?? '', reached: el.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)) };
    });
    if (focused.label.startsWith('Member:')) members += 1;
    if (!focused.reached) covered.push(focused.label);
  }
  assert.ok(members >= 10, `only ${members} Member checkboxes took focus: the Tab walk stopped short`);
  assert.deepEqual(covered, [], 'focused under the sticky permission column or header');
}

export const PERMISSION_CHECKS = {
  aTabbedCheckboxIsNeverUnderTheStickyStrips,
  aLiteDialogOpensInPlace,
  roleMatrixFitsThePhone,
  checksCentredInTheMatrix: checksAreCentred('role-permissions', ROLE_MARK),
  // The editable columns are checkboxes, and their ticks must sit centred too.
  checksCentredInTheRoleEditor: checksAreCentred('role-permissions'),
  checksCentredInTheBareBox: checksAreCentred('bare-checkbox'),
  checksCentredForOneMember: checksAreCentred('member-permissions'),
  targetsInTheMatrix: targetsAreBigEnough('role-permissions', ROLE_MARK),
  targetsForOneMember: targetsAreBigEnough('member-permissions', '[role="checkbox"]'),
  oneMemberFitsTheScreen,
};
