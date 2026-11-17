/**
 * The file manager's geometry, in every state the redesign draws (scenarios-file-manager.jsx):
 * nothing collides or sticks out, every control is a 24px target, the address bar fits its row with the
 * current folder still named, the inspector sits beside the list on a wide screen (a sheet on a phone),
 * the context menu stays on screen, and nothing runs past the window's sides or scrolls sideways.
 */
import { strict as assert } from 'node:assert';
import { AxeBuilder } from '@axe-core/playwright';
import { checkScenario, collisions, MIN_SIBLING_GAP } from './checks-spacing.mjs';
import { settled, targetsAreBigEnough } from './checks-controls.mjs';

const READY = '[data-testid="fm-screen"]';
const SCENES = [
  'file-manager', 'file-manager-grid', 'file-manager-inspector', 'file-manager-bulk',
  'file-manager-transfers', 'file-manager-empty', 'file-manager-no-matches', 'file-manager-deep',
];
/** Where the inspector stops being a column and becomes a sheet (useIsMobile). */
const SHEET_BELOW = 768;

const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const inside = (inner, outer) => inner.x >= outer.x - 1 && inner.y >= outer.y - 1
  && inner.x + inner.width <= outer.x + outer.width + 1 && inner.y + inner.height <= outer.y + outer.height + 1;

async function openScene(page, url, scene) {
  await page.goto(url(scene));
  await page.locator(READY).waitFor({ state: 'visible' });
  await settled(page);
}

/**
 * Nothing runs past the sides of the window, and nothing scrolls sideways inside it. The page itself cannot
 * scroll (the body clips), so a document-width check passes whatever overflows: content past the edge is
 * simply cut off, and a list wider than its scroller scrolls sideways under a thumb. Both are measured.
 */
const noSidewaysOverflow = (scene) => async ({ page, url }) => {
  await openScene(page, url, scene);
  const { off, scrollers } = await page.locator(READY).evaluate((root) => {
    const W = window.innerWidth;
    const name = (el) => `${el.tagName.toLowerCase()}${el.dataset.testid ? `[${el.dataset.testid}]` : ''}${el.getAttribute('aria-label') ? `[${el.getAttribute('aria-label')}]` : ''}`;
    const all = [root, ...root.querySelectorAll('*')];
    return {
      off: all.map((el) => ({ el, r: el.getBoundingClientRect() }))
        .filter(({ r }) => r.width > 0 && r.height > 0 && (r.right > W + 1 || r.left < -1))
        .map(({ el, r }) => `${name(el)} ${Math.round(r.left)}..${Math.round(r.right)}`),
      scrollers: all.filter((el) => /auto|scroll/.test(getComputedStyle(el).overflowX) && el.scrollWidth > el.clientWidth + 1)
        .map((el) => `${name(el)} scrolls ${el.scrollWidth}px in ${el.clientWidth}px`),
    };
  });
  assert.deepEqual(off, [], `${scene}: past the window's sides: ${off.slice(0, 4).join(' | ')}`);
  assert.deepEqual(scrollers, [], `${scene}: scrolls sideways: ${scrollers.slice(0, 4).join(' | ')}`);
};

/**
 * The address bar fits: its row is on screen, every control in it is inside it, the crumbs do not run
 * under their own edge, and the folder you are in is still named -- collapsing the middle crumbs on a
 * phone must leave the current one readable.
 */
async function addressBarFits({ page, url, viewport }) {
  await openScene(page, url, 'file-manager-deep');
  const bar = page.getByTestId('vfs-address-bar');
  const box = await bar.boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= viewport.width + 1, `the address bar spans ${Math.round(box.x)}..${Math.round(box.x + box.width)} in ${viewport.width}px`);
  const outside = await bar.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return [...el.querySelectorAll('button, nav, [role="group"], [data-testid="vfs-folder-count"]')]
      .map((c) => ({ c, b: c.getBoundingClientRect() }))
      .filter(({ b }) => b.width > 0 && (b.left < r.left - 1 || b.right > r.right + 1 || b.top < r.top - 1 || b.bottom > r.bottom + 1))
      .map(({ c, b }) => `${c.getAttribute('aria-label') ?? c.dataset.testid ?? c.tagName} ${Math.round(b.left)}..${Math.round(b.right)}`);
  });
  assert.deepEqual(outside, [], `controls outside the address bar: ${outside.join(' | ')}`);
  const crumbs = await page.locator('[data-testid="vfs-address-bar"] nav').evaluate((nav) => ({ scroll: nav.scrollWidth, client: nav.clientWidth }));
  assert.ok(crumbs.scroll <= crumbs.client + 1, `the crumbs are ${crumbs.scroll}px in a ${crumbs.client}px field: they run under its edge`);
  const current = await page.locator('[data-testid="vfs-address-bar"] [aria-current="page"]').boundingBox();
  assert.ok(current !== null && current.width >= 48, `the current folder's crumb is ${current ? Math.round(current.width) : 0}px wide: its name cannot be read`);
}

/** One item inspected: on a wide screen the inspector is a column beside the list, not over it; on a phone, a sheet. */
async function inspectorLeavesTheListVisible({ page, url, viewport }) {
  await openScene(page, url, 'file-manager-inspector');
  if (viewport.width < SHEET_BELOW) {
    const sheet = page.getByRole('dialog');
    await sheet.waitFor({ state: 'visible' });
    const box = await sheet.boundingBox();
    assert.ok(box.x >= -1 && box.x + box.width <= viewport.width + 1, `the inspector sheet spans ${Math.round(box.x)}..${Math.round(box.x + box.width)} in ${viewport.width}px`);
    return;
  }
  const inspector = await page.getByTestId('vfs-inspector').boundingBox();
  const list = await page.getByRole('group', { name: 'Items in this folder' }).boundingBox();
  assert.ok(inspector !== null && list !== null, 'the inspector or the list is not drawn');
  assert.ok(!overlaps(inspector, list), `the inspector ${JSON.stringify(inspector)} covers the list ${JSON.stringify(list)}`);
  assert.ok(inspector.x + inspector.width <= viewport.width + 1, `the inspector runs off the screen to ${Math.round(inspector.x + inspector.width)}px`);
  assert.ok(list.width >= 480, `the list is squeezed to ${Math.round(list.width)}px beside the inspector`);
}

/** A file's context menu opens on screen, every entry is a 24px target, and its labels and shortcut hints do not touch. */
async function contextMenuFits({ page, url, viewport }) {
  await openScene(page, url, 'file-manager');
  // A file, which has the longest menu; the click lands mid-row, as a long-press on a phone does.
  await page.getByTestId('vfs-item-budget.xlsx').click({ button: 'right' });
  const menu = page.getByRole('menu');
  await menu.waitFor({ state: 'visible' });
  await settled(page);
  const box = await menu.boundingBox();
  assert.ok(inside(box, { x: 0, y: 0, width: viewport.width, height: viewport.height }), `the context menu ${JSON.stringify(box)} leaves the ${viewport.width}x${viewport.height} screen`);
  const small = await menu.evaluate((el) => [...el.querySelectorAll('[role="menuitem"]')]
    .map((i) => ({ t: (i.textContent ?? '').trim(), r: i.getBoundingClientRect() }))
    .filter(({ r }) => r.height < 24).map(({ t, r }) => `${t} ${Math.round(r.height)}px`));
  assert.deepEqual(small, [], `context menu entries under 24px: ${small.join(' | ')}`);
  const found = await page.evaluate(collisions, { minGap: MIN_SIBLING_GAP });
  assert.deepEqual(found, [], `with the context menu open: ${found.slice(0, 5).join(' | ')}`);
}

/** No serious or critical WCAG 2.2 AA violation -- contrast of every badge and state among them -- in either theme. */
const axeClean = (scene) => async ({ page, url }) => {
  await openScene(page, url, scene);
  const { violations } = await new AxeBuilder({ page }).include(READY).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  const bad = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .flatMap((v) => v.nodes.slice(0, 2).map((n) => `${v.id} ${n.target.join(' ')}: ${(n.any[0] ?? n.all[0])?.message ?? ''}`));
  assert.deepEqual(bad, [], `${scene}: ${bad.slice(0, 4).join(' | ')}`);
};

export const FILE_MANAGER_CHECKS = {
  ...Object.fromEntries(SCENES.flatMap((scene) => [
    [`noCollisionsIn:${scene}`, checkScenario(scene, READY)],
    [`targetsIn:${scene}`, targetsAreBigEnough(scene, READY)],
    [`noSidewaysOverflowIn:${scene}`, noSidewaysOverflow(scene)],
    [`axeCleanIn:${scene}`, axeClean(scene)],
  ])),
  fileManagerAddressBarFits: addressBarFits,
  fileManagerInspectorLeavesTheListVisible: inspectorLeavesTheListVisible,
  fileManagerContextMenuFits: contextMenuFits,
};
