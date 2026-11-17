import { strict as assert } from 'node:assert';
import { settled } from './checks-controls.mjs';

/**
 * The header's breadcrumbs fit their bar at every width: nothing scrolls sideways, the trail ends
 * before the actions begin, and every segment shown sits inside the trail (a truncated name is
 * clipped inside its own box, not drawn over a neighbour). On a phone the middle folds into "…";
 * at desktop width every level is shown.
 */
async function breadcrumbsFitTheHeader({ page, url, viewport }) {
  await page.goto(url('office-header'));
  const trail = page.getByTestId('hierarchy-breadcrumbs');
  await trail.waitFor({ state: 'visible' });
  await settled(page);
  const m = await page.evaluate(() => {
    const box = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, width: r.width }; };
    const nav = document.querySelector('[data-testid="hierarchy-breadcrumbs"]');
    const bar = nav.parentElement;
    const actions = [...bar.children].find((el) => el !== nav);
    const shown = (el) => el.getBoundingClientRect().width > 0;
    const segments = [...nav.querySelectorAll('[data-testid="breadcrumb-ancestor"], [data-testid="breadcrumb-collapsed"], [data-testid="breadcrumb-current"]')].filter(shown);
    return {
      pageScroll: document.documentElement.scrollWidth - window.innerWidth,
      barScroll: bar.scrollWidth - bar.clientWidth,
      nav: box(nav), actions: box(actions), bar: box(bar),
      segments: segments.map((el) => ({ id: el.dataset.testid, ...box(el) })),
      ancestors: [...nav.querySelectorAll('[data-testid="breadcrumb-ancestor"]')].filter(shown).length,
      collapsed: [...nav.querySelectorAll('[data-testid="breadcrumb-collapsed"]')].filter(shown).length,
    };
  });
  assert.ok(m.pageScroll <= 0, `the page scrolls sideways by ${m.pageScroll}px`);
  assert.ok(m.barScroll <= 0, `the header bar overflows by ${m.barScroll}px`);
  assert.ok(m.nav.right <= m.actions.left + 0.5, `the trail runs ${Math.round(m.nav.right - m.actions.left)}px under the actions`);
  for (const s of m.segments) assert.ok(s.left >= m.nav.left - 0.5 && s.right <= m.nav.right + 0.5, `${s.id} [${Math.round(s.left)}, ${Math.round(s.right)}] leaves the trail [${Math.round(m.nav.left)}, ${Math.round(m.nav.right)}]`);
  if (viewport.width < 768) assert.deepEqual([m.ancestors, m.collapsed], [1, 1], 'on a phone: the workspace, "…", and here');
  else assert.deepEqual([m.ancestors, m.collapsed], [3, 0], 'at desktop width every level is shown');
}

export const BREADCRUMB_CHECKS = { breadcrumbsFitTheHeader };
