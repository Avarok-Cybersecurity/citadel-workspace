/**
 * Opening a file in its registered app, measured (scenarios-file-openers.jsx): the file manager's
 * menu and inspector name the app with its icon, a chat file's menu is reached from the keyboard
 * through a 44px button, offers Open only where an app opens the file and Download always, its
 * entries are 44px targets on screen, and axe finds nothing serious with it open.
 */
import { strict as assert } from 'node:assert';
import { AxeBuilder } from '@axe-core/playwright';
import { settled } from './checks-controls.mjs';

const MIN_TARGET = 44;
const show = (b) => `${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.width)}x${Math.round(b.height)}`;
const onScreen = (b, v) => b.x >= -0.5 && b.y >= -0.5 && b.x + b.width <= v.width + 0.5 && b.y + b.height <= v.height + 0.5;

async function open(page, url, scenario, ready) {
  await page.goto(url(scenario));
  await page.locator(ready).waitFor({ state: 'visible' });
  await settled(page);
}

const menuLabels = (page) => page.getByRole('menuitem').evaluateAll((items) => items.map((i) => i.textContent.trim()));

async function hasIcon(locator, label) {
  assert.equal(await locator.locator('svg').count(), 1, `${label} shows no app icon`);
}

async function fileManagerMenu({ page, url, viewport }) {
  await open(page, url, 'file-open-menu', '[data-testid="fm-target"]');
  await page.locator('[data-testid="fm-target"]').click({ button: 'right' });
  const entry = page.getByRole('menuitem', { name: 'Open in Citadel Docs' });
  await entry.waitFor({ state: 'visible' });
  // Measured once the menu's zoom-in has finished and Radix has placed it, not mid-flight.
  await settled(page);
  await hasIcon(entry, 'Open in Citadel Docs');
  const labels = await menuLabels(page);
  assert.ok(labels.some((l) => l.startsWith('Download')), `no Download in ${labels.join(' | ')}`);
  assert.ok(!labels.includes('Open with…'), 'Open with… is offered with one app');
  const box = await page.getByRole('menu').boundingBox();
  assert.ok(onScreen(box, viewport), `the menu ${show(box)} leaves the screen`);
  for (const item of await page.getByRole('menuitem').all()) {
    const b = await item.boundingBox();
    assert.ok(b.height >= MIN_TARGET, `the menu entry "${(await item.textContent()).trim()}" is ${show(b)}, under ${MIN_TARGET}px tall`);
  }
}

async function fileManagerInspector({ page, url, viewport }) {
  await open(page, url, 'file-open-inspector', '[data-testid="vfs-inspector-open-in-app"]');
  const button = page.getByTestId('vfs-inspector-open-in-app');
  assert.equal((await button.textContent()).trim(), 'Open in Citadel Docs');
  await hasIcon(button, 'the inspector\'s Open');
  const box = await button.boundingBox();
  assert.ok(box.height >= MIN_TARGET, `the inspector's Open is ${show(box)}, under ${MIN_TARGET}px tall`);
  assert.ok(onScreen(box, viewport), `the inspector's Open ${show(box)} leaves the screen`);
}

/** Reached by Tab and Enter alone: no hover, no right-click. */
async function openChatMenuByKeyboard(page, name) {
  const button = page.getByRole('button', { name: `Actions for ${name}` });
  const box = await button.boundingBox();
  assert.ok(box.width >= MIN_TARGET && box.height >= MIN_TARGET, `the menu button for ${name} is ${show(box)}, under ${MIN_TARGET}px`);
  await button.focus();
  await page.keyboard.press('Enter');
  await page.getByRole('menu').waitFor({ state: 'visible' });
  // Its entries are measured once the menu's zoom-in has finished, not mid-scale.
  await settled(page);
  return box;
}

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'];
async function axeClean(page, scope, label) {
  const { violations } = await new AxeBuilder({ page }).include(scope).withTags(WCAG).analyze();
  const serious = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes[0]?.target}`);
  assert.deepEqual(serious, [], `axe, ${label}`);
}

async function chatFileMenu({ page, url, viewport }) {
  await open(page, url, 'chat-file-open-menu', '[data-testid="chat-files"]');
  await axeClean(page, '[data-testid="chat-files"]', 'over the chat files');
  const button = await openChatMenuByKeyboard(page, 'Quarterly-plan.docx');
  assert.ok(onScreen(button, viewport), `the menu button ${show(button)} leaves the screen`);
  assert.deepEqual(await menuLabels(page), ['Open in Citadel Docs', 'Download']);
  await hasIcon(page.getByRole('menuitem', { name: 'Open in Citadel Docs' }), 'the chat menu\'s Open');
  for (const item of await page.getByRole('menuitem').all()) {
    const box = await item.boundingBox();
    assert.ok(box.height >= MIN_TARGET && onScreen(box, viewport), `a chat menu entry is ${show(box)}: under ${MIN_TARGET}px or off screen`);
  }
  // Scoped to the menu: while a modal menu is open Radix hides the page behind it from assistive tech.
  await axeClean(page, '[role="menu"]', 'over the open chat file menu');
  await page.keyboard.press('Escape');
  await page.getByRole('menu').waitFor({ state: 'hidden' });
  await openChatMenuByKeyboard(page, 'archive.zip');
  assert.deepEqual(await menuLabels(page), ['Download']);
}

/** Two apps open a .md: Open names the first-party one, and the Open with… group lists both in the menu itself, 44px, on screen. */
async function fileManagerOpenWith({ page, url, viewport }) {
  await open(page, url, 'file-open-with-menu', '[data-testid="fm-target"]');
  await page.locator('[data-testid="fm-target"]').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Open in Citadel Docs' }).waitFor({ state: 'visible' });
  await settled(page);
  assert.equal(await page.getByRole('group', { name: 'Open with…' }).count(), 1, 'no Open with… group named for assistive tech');
  const apps = page.getByTestId('vfs-open-with-app');
  assert.deepEqual(await apps.evaluateAll((items) => items.map((i) => i.textContent.trim())), ['Citadel Docs', 'Notebook']);
  for (const item of await apps.all()) {
    const box = await item.boundingBox();
    assert.ok(box.height >= MIN_TARGET && onScreen(box, viewport), `an Open with… entry is ${show(box)}: under ${MIN_TARGET}px or off screen`);
  }
}

/** The opened .ics's review: its long title wraps, the list scrolls inside it, both buttons are 44px on screen, axe is clean. */
async function icsReview({ page, url, viewport }) {
  await open(page, url, 'ics-import-review', '[data-testid="ics-import-review"]');
  const dialog = page.getByTestId('ics-import-review');
  const box = await dialog.boundingBox();
  assert.ok(onScreen(box, viewport), `the review ${show(box)} leaves the screen`);
  assert.equal((await page.getByTestId('ics-import-count').textContent()).trim(), '3 events to add to your own calendar.');
  assert.deepEqual(await page.getByTestId('ics-import-event').evaluateAll((items) => items.map((i) => i.firstElementChild.textContent)), [
    'Boiler service with the contractor from the north depot, second visit of the quarter', 'Site visit', 'Untitled event',
  ]);
  for (const name of ['Cancel', 'Import 3 events']) {
    const b = await dialog.getByRole('button', { name }).boundingBox();
    assert.ok(b.height >= MIN_TARGET && onScreen(b, viewport), `${name} is ${show(b)}: under ${MIN_TARGET}px or off screen`);
  }
  const overflow = await dialog.evaluate((el) => el.scrollWidth - el.clientWidth);
  assert.ok(overflow <= 0, `the review overflows sideways by ${overflow}px`);
  await axeClean(page, '[data-testid="ics-import-review"]', 'over the review');
  await page.keyboard.press('Tab');
  assert.ok(await dialog.evaluate((el) => el.contains(document.activeElement)), 'focus leaves the review');
}

export const FILE_OPENER_CHECKS = {
  fileOpenerFileManagerMenu: fileManagerMenu,
  fileOpenerInspector: fileManagerInspector,
  fileOpenerChatMenu: chatFileMenu,
  fileOpenerOpenWith: fileManagerOpenWith,
  fileOpenerIcsReview: icsReview,
};
