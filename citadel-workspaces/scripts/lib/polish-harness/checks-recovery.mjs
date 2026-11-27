import { strict as assert } from 'node:assert';
import { AxeBuilder } from '@axe-core/playwright';

/**
 * Account recovery, measured in a real engine at desktop and 390px (components/recovery): the card
 * inside the viewport with no sideways scroll; every control inside the card, at least WCAG 2.2's
 * 24px, and the primary actions 44px; the 24 phrase words drawn in order, two columns at 390px,
 * none clipped and none overlapping; the recover form's 24 boxes the same, and its mistyped word
 * marked; the human check a workspace asks for drawn inside the recover form, above its button; the
 * console's three-step indicator inside its header; no serious or critical axe finding.
 */
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const PHRASE = ['abandon', 'ability', 'able', 'about', 'above', 'absent', 'absorb', 'abstract', 'absurd', 'abuse', 'access', 'accident',
  'account', 'accuse', 'achieve', 'acid', 'acoustic', 'acquire', 'across', 'act', 'action', 'actor', 'actress', 'zoo'];
const inside = (inner, outer) => inner.x >= outer.x - 0.5 && inner.y >= outer.y - 0.5
  && inner.x + inner.width <= outer.x + outer.width + 0.5 && inner.y + inner.height <= outer.y + outer.height + 0.5;
const overlaps = (a, b) => a.x < b.x + b.width - 0.5 && b.x < a.x + a.width - 0.5 && a.y < b.y + b.height - 0.5 && b.y < a.y + a.height - 0.5;

async function open(page, url, scenario, ready) {
  await page.goto(url(scenario));
  await page.getByTestId(ready).waitFor({ state: 'visible' });
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))));
}

/** The card in the viewport, no sideways scroll, every visible control inside the card and a real target. */
async function fits(page, viewport, primary) {
  const card = await page.getByTestId('recovery-card').boundingBox();
  assert.ok(inside(card, { x: 0, y: 0, ...viewport }), `the card ${JSON.stringify(card)} leaves the ${viewport.width}px viewport`);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 0, `the page scrolls sideways by ${overflow}px`);
  const controls = await page.getByTestId('recovery-card').locator('button, input').evaluateAll((nodes) => nodes
    .filter((n) => n.getClientRects().length > 0 && !n.closest('.sr-only'))
    .map((n) => { n.scrollIntoView({ block: 'nearest' }); return { id: n.dataset.testid ?? n.id ?? n.getAttribute('aria-label') ?? n.tagName, ...n.getBoundingClientRect().toJSON() }; }));
  assert.ok(controls.length > 0, 'the card draws no controls');
  const cardNow = await page.getByTestId('recovery-card').boundingBox();
  for (const c of controls) {
    assert.ok(c.x >= cardNow.x - 0.5 && c.x + c.width <= cardNow.x + cardNow.width + 0.5, `${c.id} ${JSON.stringify(c)} overhangs the card ${JSON.stringify(cardNow)}`);
    assert.ok(c.width >= 24 && c.height >= 24, `${c.id} is a ${c.width}x${c.height} target, under 24px`);
  }
  for (const id of primary) {
    const box = await page.getByTestId(id).boundingBox();
    assert.ok(box.height >= 44, `${id} is ${box.height}px tall, under 44px`);
  }
}

/** A grid of `cells` in order, `columns` across at 390px, none clipped and none overlapping another. */
async function grid(page, viewport, cells, expect) {
  const drawn = await page.getByTestId(cells).evaluateAll((items) => items.map((li) => ({
    text: li.textContent, clipped: [...li.querySelectorAll('span, input')].some((e) => e.scrollWidth > e.clientWidth + 1), ...li.getBoundingClientRect().toJSON(),
  })));
  assert.equal(drawn.length, 24, `${cells}: ${drawn.length} drawn, not 24`);
  if (expect) assert.deepEqual(drawn.map((d) => d.text.replace(/^\d+/, '')), expect, 'the words are not drawn in order');
  for (const d of drawn) assert.ok(!d.clipped, `${cells} "${d.text}" is clipped`);
  for (let i = 0; i < drawn.length; i += 1) for (let j = i + 1; j < drawn.length; j += 1) {
    assert.ok(!overlaps(drawn[i], drawn[j]), `${cells} ${i + 1} ${JSON.stringify(drawn[i])} overlaps ${j + 1} ${JSON.stringify(drawn[j])}`);
  }
  if (viewport.width <= 390) {
    const columns = new Set(drawn.map((d) => Math.round(d.x))).size;
    assert.equal(columns, 2, `${cells} lays out in ${columns} columns at ${viewport.width}px, not 2`);
  }
}

async function axe(page) {
  const { violations } = await new AxeBuilder({ page }).include('[role="dialog"]').withTags(WCAG).analyze();
  const blocking = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  assert.equal(blocking.length, 0, blocking.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`).join('; '));
}

async function thePhraseFits({ page, url, viewport }) {
  await open(page, url, 'recovery-phrase', 'recovery-phrase');
  await fits(page, viewport, ['recovery-phrase-written', 'recovery-phrase-copy', 'recovery-phrase-download']);
  await grid(page, viewport, 'recovery-phrase-word', PHRASE);
  await axe(page);
}

async function thePhraseCheckFits({ page, url, viewport }) {
  await open(page, url, 'recovery-phrase-check', 'recovery-phrase-check');
  assert.equal(await page.getByTestId('recovery-phrase-check-word').count(), 3, 'the check does not ask for three words');
  await fits(page, viewport, ['recovery-phrase-confirm', 'recovery-phrase-show-again', 'recovery-phrase-skip']);
  await statedBeside(page, 'recovery-phrase-skip', 'recovery-phrase-skip-note');
  await axe(page);
}

async function theRecoverFormFits({ page, url, viewport }) {
  await open(page, url, 'recover-account', 'recover-account');
  await page.locator('[data-testid="recover-scenario"][data-ready="true"]').waitFor();
  await fits(page, viewport, ['recover-submit']);
  await grid(page, viewport, 'recover-phrase-word', null);
  assert.equal(await page.locator('#recovery-word-4').getAttribute('aria-invalid'), 'true', 'the mistyped fifth word is not marked');
  assert.equal(await page.locator('#recovery-word-0').getAttribute('aria-invalid'), null, 'an empty box is marked as wrong');
  await axe(page);
}

async function theRecoverFormCheckFits({ page, url, viewport }) {
  await open(page, url, 'recover-account-check', 'turnstile-frame');
  await fits(page, viewport, ['recover-submit']);
  const form = await page.getByTestId('recover-account').boundingBox();
  for (const id of ['admission-check', 'turnstile-frame', 'admission-message']) {
    const box = await page.getByTestId(id).boundingBox();
    assert.ok(box.x >= form.x - 0.5 && box.x + box.width <= form.x + form.width + 0.5, `${id} ${JSON.stringify(box)} overhangs the form ${JSON.stringify(form)}`);
  }
  const frame = await page.getByTestId('turnstile-frame').boundingBox();
  const submit = await page.getByTestId('recover-submit').boundingBox();
  assert.ok(frame.y + frame.height <= submit.y + 0.5, `the check ${JSON.stringify(frame)} is not above the Recover button ${JSON.stringify(submit)}`);
  await axe(page);
}

/** `line` is drawn whole inside the card, right below `control`, which it describes. */
async function statedBeside(page, control, line) {
  const card = await page.getByTestId('recovery-card').boundingBox();
  const c = await page.getByTestId(control).boundingBox();
  const l = await page.getByTestId(line).boundingBox();
  assert.ok(inside(l, card), `${line} ${JSON.stringify(l)} leaves the card ${JSON.stringify(card)}`);
  assert.ok(l.y >= c.y + c.height - 0.5 && l.y - (c.y + c.height) <= 24, `${line} ${JSON.stringify(l)} is not right below ${control} ${JSON.stringify(c)}`);
  const clipped = await page.getByTestId(line).evaluate((e) => e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1);
  assert.ok(!clipped, `${line} is clipped`);
}

async function theUncheckedReminderFits({ page, url, viewport }) {
  await open(page, url, 'settings-phrase-unchecked', 'recovery-phrase-unchecked');
  await fits(page, viewport, ['recovery-phrase-unchecked-fix']);
  const card = await page.getByTestId('recovery-card').boundingBox();
  const notice = await page.getByTestId('recovery-phrase-unchecked').boundingBox();
  const fix = await page.getByTestId('recovery-phrase-unchecked-fix').boundingBox();
  assert.ok(inside(notice, card), `the reminder ${JSON.stringify(notice)} leaves the card ${JSON.stringify(card)}`);
  assert.ok(inside(fix, notice), `its fix ${JSON.stringify(fix)} leaves the reminder ${JSON.stringify(notice)}`);
  const clipped = await page.getByTestId('recovery-phrase-unchecked').locator('p').evaluate((e) => e.scrollWidth > e.clientWidth + 1);
  assert.ok(!clipped, 'the reminder sentence is clipped');
  await axe(page);
}

const theConsoleFits = (scenario, view, primary) => async ({ page, url, viewport }) => {
  await open(page, url, scenario, 'recovery-console');
  await page.locator(`[data-testid="recovery-console"][data-view="${view}"]`).waitFor();
  await fits(page, viewport, primary);
  const header = await page.getByTestId('recovery-console').locator('header').boundingBox();
  const steps = await page.getByRole('list', { name: 'Recovery steps' }).locator('li').evaluateAll((items) => items.map((li) => li.getBoundingClientRect().toJSON()));
  assert.equal(steps.length, 3, 'the step indicator does not show three steps');
  for (const s of steps) assert.ok(inside(s, header), `a step ${JSON.stringify(s)} leaves the header ${JSON.stringify(header)}`);
  for (let i = 1; i < steps.length; i += 1) assert.ok(!overlaps(steps[i - 1], steps[i]), 'two steps overlap');
  await axe(page);
};

export const RECOVERY_CHECKS = {
  theRecoveryPhraseFits: thePhraseFits,
  theRecoveryPhraseCheckFits: thePhraseCheckFits,
  theUncheckedPhraseReminderFits: theUncheckedReminderFits,
  theRecoverAccountFormFits: theRecoverFormFits,
  theRecoverAccountFormCheckFits: theRecoverFormCheckFits,
  theRecoveryConsoleWelcomeFits: theConsoleFits('recovery-console-welcome', 'welcome', ['recovery-console-begin', 'recovery-console-sign-out']),
  theRecoveryConsoleTasksFit: theConsoleFits('recovery-console-tasks', 'tasks', ['recovery-task-password', 'recovery-task-phrase', 'recovery-console-done']),
  theRecoveryConsolePasswordFits: theConsoleFits('recovery-console-password', 'password', ['console-password-save', 'recovery-console-back']),
};
