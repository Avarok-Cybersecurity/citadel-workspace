import { strict as assert } from 'node:assert';
import { MEMBERS_FILTER_CHECKS } from './checks-members-filter.mjs';

/**
 * Every person is drawn the same way: the shared avatar, with the roster's picture when there is one,
 * and a presence dot that is not cut in half by the avatar's own clip.
 */
async function everyPersonKeepsTheirPicture({ page, url }) {
  await page.goto(url('people'));
  const avatars = page.locator('[data-avatar]');
  await avatars.first().waitFor({ state: 'visible' });
  const count = await avatars.count();
  assert.ok(count >= 4, `the scenario draws four views of Ada, found ${count} avatars`);
  for (let i = 0; i < count; i += 1) {
    const avatar = avatars.nth(i);
    const id = await avatar.getAttribute('data-testid');
    assert.equal(id, 'member-avatar-ada', `avatar ${i} was not drawn by MemberAvatar (${id})`);
    const picture = avatar.locator('img');
    await picture.waitFor({ state: 'visible', timeout: 5000 });
    assert.ok(await picture.evaluate((img) => img.complete && img.naturalWidth > 0), `avatar ${i} did not load Ada's picture`);
  }
}

/**
 * The online dot sits on the avatar's corner, outside its circular clip. A dot drawn INSIDE the clip
 * hit-tests as whatever is behind it, because the part outside the circle is not there to be hit.
 */
async function thePresenceDotIsWhole({ page, url }) {
  await page.goto(url('people'));
  const dots = page.locator('[data-testid="member-presence-ada"]');
  await dots.first().waitFor({ state: 'visible' });
  const count = await dots.count();
  assert.ok(count >= 3, `three views mark Ada online, found ${count} dots`);
  for (let i = 0; i < count; i += 1) {
    const box = await dots.nth(i).boundingBox();
    // Inside the dot's own circle, toward the corner that points away from its avatar: the first part a clip removes.
    const probe = [box.x + box.width * 0.8, box.y + box.height * 0.8];
    const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.getAttribute('data-testid'), probe);
    assert.equal(hit, 'member-presence-ada', `dot ${i} is cut off at its outer corner (hit ${hit})`);
  }
}

export const PEOPLE_CHECKS = { everyPersonKeepsTheirPicture, thePresenceDotIsWhole, ...MEMBERS_FILTER_CHECKS };
