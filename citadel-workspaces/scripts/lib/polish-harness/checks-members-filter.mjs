import { strict as assert } from 'node:assert';

const within = (inner, outer) => inner.x >= outer.x - 0.5 && inner.x + inner.width <= outer.x + outer.width + 0.5;
const overlap = (a, b) => a.x < b.x + b.width - 0.5 && b.x < a.x + a.width - 0.5 && a.y < b.y + b.height - 0.5 && b.y < a.y + a.height - 0.5;

/**
 * The Members filter at 375px and on a desktop: both choices are 44px targets side by side inside
 * the panel, the page never scrolls sideways, and a guest's mark sits inside their row without
 * covering their long, unbroken handle. Each shown in both states.
 */
const theMembersFilterFits = (scenario) => async ({ page, url, viewport }) => {
  const width = viewport.width < 600 ? 375 : viewport.width;
  await page.setViewportSize({ width, height: viewport.height });
  try {
    await page.goto(url(scenario));
    const frame = await page.getByTestId('members-filter-frame').boundingBox();
    const everyone = await page.getByTestId('members-filter-everyone').boundingBox();
    const guests = await page.getByTestId('members-filter-guests').boundingBox();
    assert.ok(frame && everyone && guests, 'the filter is drawn');
    for (const [name, b] of [['Everyone', everyone], ['Guests', guests]]) {
      assert.ok(b.height >= 44 && b.width >= 44, `${name} is a ${b.width}x${b.height} target`);
      assert.ok(within(b, frame), `${name} ${JSON.stringify(b)} leaves the panel ${JSON.stringify(frame)}`);
    }
    assert.ok(!overlap(everyone, guests), 'the two choices overlap');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 0, `the page scrolls sideways by ${overflow}px`);
    const row = await page.getByTestId('member-row-gus').boundingBox();
    const mark = await page.getByTestId('member-guest-gus').boundingBox();
    const handle = await page.getByTestId('member-row-gus').getByText('bartholomew.longname.booking-guest-from-outside').boundingBox();
    assert.ok(row && mark && handle, 'the guest row, its mark and handle are drawn');
    assert.ok(within(mark, row) && within(handle, row), `the mark ${JSON.stringify(mark)} or handle ${JSON.stringify(handle)} leaves the row`);
    assert.ok(!overlap(mark, handle), `the mark ${JSON.stringify(mark)} covers the handle ${JSON.stringify(handle)}`);
  } finally {
    await page.setViewportSize(viewport);
  }
};

export const MEMBERS_FILTER_CHECKS = {
  theMembersFilterFitsShowingEveryone: theMembersFilterFits('members-filter-everyone'),
  theMembersFilterFitsShowingGuests: theMembersFilterFits('members-filter-guests'),
};
