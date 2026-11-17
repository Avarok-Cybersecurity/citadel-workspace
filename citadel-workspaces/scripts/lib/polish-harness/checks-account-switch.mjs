import { strict as assert } from 'node:assert';

const settled = (page) => page.waitForFunction(() => document.getAnimations().every((a) => a.playState === 'finished' || a.playState === 'idle'), undefined, { timeout: 5000 });
const inside = (inner, outer) => inner.x >= outer.x - 0.5 && inner.y >= outer.y - 0.5 && inner.x + inner.width <= outer.x + outer.width + 0.5 && inner.y + inner.height <= outer.y + outer.height + 0.5;

/**
 * A signed-out row is a 44px target inside the menu and the viewport; its "Signed out / Sign in"
 * tag is drawn (not hover-only), sits inside the row, and covers neither the name nor the avatar.
 */
async function aSignedOutRowSaysSo({ page, url, viewport }) {
  await page.goto(url('switcher-signed-out'));
  const item = page.getByTestId('switcher-account-signed-out');
  await item.waitFor({ state: 'visible' });
  await settled(page);
  const box = await item.boundingBox();
  assert.ok(box.height >= 44, `the signed-out row is ${box.height}px tall (needs 44)`);
  assert.ok(inside(box, { x: 0, y: 0, ...viewport }), `the row ${JSON.stringify(box)} leaves the ${viewport.width}px viewport`);
  assert.ok(inside(box, await page.getByRole('menu').boundingBox()), 'the row leaves its menu');
  const tag = item.getByText('Sign in', { exact: true });
  const tagBox = await tag.boundingBox();
  assert.ok(inside(tagBox, box), `the Sign in tag ${JSON.stringify(tagBox)} leaves its row ${JSON.stringify(box)}`);
  assert.ok(Number(await tag.evaluate((el) => getComputedStyle(el).opacity)) > 0.9, 'the Sign in tag is not drawn at rest');
  // Both text lines end before the tag's column starts: a long name or handle truncates, never runs into it.
  const column = await item.getByTestId('switcher-account-signed-out-tag').boundingBox();
  for (const [what, locator] of [['name', item.getByText(/Margaret Hamilton/)], ['handle', item.getByTestId('switcher-account-handle')]]) {
    const line = await locator.boundingBox();
    assert.ok(line.x + line.width <= column.x + 0.5, `the ${what} ${JSON.stringify(line)} runs into the tag ${JSON.stringify(column)}`);
  }
  assert.equal(await item.getAttribute('aria-label'), 'Sign in to margaret.hamilton.apollo on bench.work.avarok.net (signed out)');
}

/**
 * The sign-in a signed-out row opens fits the screen, says why inside its card, starts in the
 * empty password field with the username filled, has a 44px submit, and closes on Escape.
 */
async function theSignInSaysWhy({ page, url, viewport }) {
  await page.goto(url('sign-in-signed-out'));
  const notice = page.getByTestId('login-notice');
  await notice.waitFor({ state: 'visible' });
  await settled(page);
  const dialog = await page.getByRole('dialog', { name: 'Sign in' }).boundingBox();
  const card = await page.locator('form').boundingBox();
  assert.ok(inside(dialog, { x: 0, y: 0, ...viewport }), `the sign-in ${JSON.stringify(dialog)} leaves the ${viewport.width}px viewport`);
  assert.ok((await notice.boundingBox()).x + (await notice.boundingBox()).width <= viewport.width, 'the reason runs off the screen');
  assert.match(await notice.textContent(), /margaret\.hamilton\.apollo on bench\.work\.avarok\.net is signed out/);
  assert.equal(await page.locator('#username').inputValue(), 'margaret.hamilton.apollo');
  assert.equal(await page.locator('#password').inputValue(), '');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'password', 'the cursor is not in the password field');
  const submit = await page.getByTestId('login-submit').boundingBox();
  assert.ok(submit.height >= 44 && inside(submit, card), `the submit ${JSON.stringify(submit)} is not a 44px target inside the form`);
  await page.keyboard.press('Escape');
  await page.getByTestId('sign-in-closed').waitFor({ timeout: 3000 });
}

const within = (inner, outer, what) => assert.ok(inside(inner, outer), `${what} ${JSON.stringify(inner)} leaves ${JSON.stringify(outer)}`);
const ACME = 'acme-research-and-development-laboratories.work.avarok.net';

/** The scope line sits inside the form above the username, which it describes. */
async function aScopedSignInSaysWhere({ page, url, viewport }) {
  await page.goto(url('sign-in-scoped'));
  const scope = page.getByTestId('login-scope');
  await scope.waitFor({ state: 'visible' });
  await settled(page);
  const form = await page.locator('form').boundingBox();
  within(await scope.boundingBox(), form, 'the scope line');
  within(form, { x: 0, y: 0, ...viewport }, 'the form');
  assert.match(await scope.textContent(), /Signing in to bench\.work\.avarok\.net/);
  assert.ok((await scope.boundingBox()).y < (await page.locator('#username').boundingBox()).y, 'the scope line is not above the username');
  assert.match(await page.locator('#username').getAttribute('aria-describedby'), /login-scope/);
}

/** With nothing saved for the server, the form says so inside itself and still takes a username. */
async function anEmptyScopeSaysSo({ page, url, viewport }) {
  await page.goto(url('sign-in-scope-empty'));
  const empty = page.getByTestId('login-scope-empty');
  await empty.waitFor({ state: 'visible' });
  await settled(page);
  const form = await page.locator('form').boundingBox();
  within(await empty.boundingBox(), form, 'the no-account note');
  within(form, { x: 0, y: 0, ...viewport }, 'the form');
  await page.locator('#username').fill('zed');
  assert.ok(await page.getByTestId('login-submit').isEnabled(), 'a username for that server cannot be submitted');
}

/**
 * Another server's username: the notice fits inside the form, its way out is a 44px target
 * inside it, Enter does not sign in but moves to that way out, and taking it rescopes.
 */
async function theWrongServerIsCaught({ page, url, viewport }) {
  await page.goto(url('sign-in-scoped'));
  await page.getByTestId('login-scope').waitFor({ state: 'visible' });
  await page.locator('#username').fill('bob');
  const notice = page.getByTestId('login-wrong-server');
  await notice.waitFor({ state: 'visible' });
  await settled(page);
  const box = await notice.boundingBox();
  within(box, await page.locator('form').boundingBox(), 'the wrong-server notice');
  within(box, { x: 0, y: 0, ...viewport }, 'the wrong-server notice');
  const go = page.getByTestId('login-switch-server');
  const goBox = await go.boundingBox();
  assert.ok(goBox.height >= 44, `the way to the other server is ${goBox.height}px tall`);
  within(goBox, box, 'its button');
  assert.ok(await go.evaluate((el) => el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= el.clientHeight + 1), 'the button\'s label runs out of it');
  assert.equal(await notice.getAttribute('role'), 'alert');
  assert.equal(await page.getByTestId('login-submit').getAttribute('aria-describedby'), 'login-wrong-server', 'Sign In does not point at the notice');
  await page.locator('#password').fill('pw');
  await page.locator('#password').press('Enter');
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.testid), 'login-switch-server', 'Enter did not move to the way out');
  await go.click();
  assert.match(await page.getByTestId('login-scope').textContent(), new RegExp(`Signing in to ${ACME.replace(/\./g, '\\.')}`));
  assert.equal(await notice.count(), 0, 'the notice stayed after rescoping');
}

/** Every row names its server inside itself; two accounts called alice read differently. */
async function everyRowNamesItsServer({ page, url }) {
  await page.goto(url('passkey-rows'));
  const rows = page.getByTestId('login-passkey-account');
  await rows.first().waitFor({ state: 'visible' });
  const servers = [];
  for (let i = 0; i < await rows.count(); i += 1) {
    const row = rows.nth(i);
    const box = await row.boundingBox();
    assert.ok(box.height >= 44, `row ${i} is ${box.height}px tall`);
    within(await row.getByTestId('login-passkey-server').boundingBox(), box, `row ${i}'s server`);
    within(await row.getByTestId('login-passkey-name').boundingBox(), box, `row ${i}'s name`);
    servers.push(await row.getByTestId('login-passkey-server').textContent());
  }
  assert.equal(new Set(servers).size, servers.length, `rows share a server label: ${servers}`);
}

/**
 * The join form's held-username message: on the username field at once, wrapped (never clipped
 * or scrolling sideways), inside the form and the viewport once scrolled to, clear of the next
 * field, and tied to the input it is about.
 */
async function aHeldUsernameIsSaidOnTheField({ page, url, viewport }) {
  await page.goto(url('join-held-username'));
  const message = page.locator('#username-error');
  await message.waitFor({ state: 'visible', timeout: 5000 });
  await settled(page);
  await message.scrollIntoViewIfNeeded();
  assert.match(await message.textContent(), new RegExp(`already has an account named margaret\\.hamilton\\.apollo on ${ACME.replace(/\./g, '\\.')}`));
  const box = await message.boundingBox();
  within(box, { x: 0, y: 0, ...viewport }, 'the message');
  within(box, await page.locator('form').boundingBox(), 'the message');
  const fits = await message.evaluate((el) => el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= el.clientHeight + 1);
  assert.ok(fits, 'the message is clipped or scrolls');
  const next = await page.locator('label[for="password"]').boundingBox();
  assert.ok(box.y + box.height <= next.y + 0.5, `the message ${JSON.stringify(box)} runs into the next field ${JSON.stringify(next)}`);
  const input = page.locator('#username');
  assert.equal(await input.getAttribute('aria-invalid'), 'true');
  assert.match(await input.getAttribute('aria-describedby') ?? '', /\busername-error\b/);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'the page scrolls sideways');
}

export const ACCOUNT_SWITCH_CHECKS = {
  aHeldUsernameIsSaidOnTheField, aSignedOutRowSaysSo, theSignInSaysWhy, aScopedSignInSaysWhere, anEmptyScopeSaysSo, theWrongServerIsCaught, everyRowNamesItsServer,
};
