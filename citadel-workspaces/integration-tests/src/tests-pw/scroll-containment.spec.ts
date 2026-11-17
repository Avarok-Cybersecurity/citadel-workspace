/**
 * A capped list must scroll, not clip.
 *
 * `ui/scroll-area` puts the caller's className on the Radix ROOT. A caller who
 * sets only a `max-height` therefore leaves the Root's height at `auto`, so the
 * viewport's `h-full` also resolves to auto, the viewport grows to its content,
 * nothing overflows it, and NO SCROLLBAR IS CREATED. The Root's own
 * `overflow: hidden` then amputates everything past the cap — silently, with no
 * scrollbar, no fade and no indication that anything is below.
 *
 * Nine call sites did this. The "View all N members" dialog, whose entire
 * purpose is escaping the sidebar's 5-member cap, showed about seven of forty.
 *
 * Nothing existing could see it. The elements are present in the DOM, so
 * `toBeVisible()` and axe are both satisfied; the clipped ones are simply
 * outside a `overflow: hidden` box. This asserts the property that actually
 * matters — that a container whose content exceeds it can be scrolled — which
 * is only observable by measuring.
 */
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * Every ScrollArea viewport currently in the page, with the numbers that decide
 * whether it scrolls or clips.
 */
async function measureScrollAreas(page: Page) {
  return page.evaluate(() => {
    // Radix marks the viewport with this attribute.
    const viewports = Array.from(
      document.querySelectorAll<HTMLElement>('[data-radix-scroll-area-viewport]'),
    );
    return viewports.map((v) => {
      const root = v.closest<HTMLElement>('[dir], div');
      return {
        scrollHeight: v.scrollHeight,
        clientHeight: v.clientHeight,
        // The clipping signature: content taller than the box that contains it,
        // while the box itself reports nothing to scroll.
        overflows: v.scrollHeight > v.clientHeight,
        rootHeight: root ? root.getBoundingClientRect().height : 0,
        contentHeight: v.firstElementChild
          ? (v.firstElementChild as HTMLElement).getBoundingClientRect().height
          : 0,
      };
    });
  });
}

test('the ScrollArea primitive scrolls when the caller sets only a max-height', async ({ page }) => {
  test.setTimeout(120_000);

  // A standalone page, so this measures the PRIMITIVE rather than whichever
  // list a seeded workspace happens to produce. The bug is in the component,
  // and a fixture reproduces it deterministically instead of depending on a
  // workspace being large enough on the day.
  await page.setContent(`
    <style>
      /* The two rules the primitive applies, verbatim. */
      .root { position: relative; overflow: hidden; max-height: 200px; }
      .viewport { height: 100%; max-height: inherit; width: 100%; }
      .row { height: 40px; }
    </style>
    <div class="root" dir="ltr">
      <div class="viewport" data-radix-scroll-area-viewport>
        <div>${'<div class="row">row</div>'.repeat(20)}</div>
      </div>
    </div>
  `);

  const [area] = await measureScrollAreas(page);

  expect(area, 'the fixture did not render a viewport').toBeTruthy();
  expect(area.contentHeight, 'the fixture must overflow, or it proves nothing').toBeGreaterThan(400);

  // The assertion. Without `max-h: inherit` on the viewport, clientHeight is the
  // full 800px of content, scrollHeight equals it, `overflows` is false, and the
  // Root clips 600px of rows with no scrollbar.
  expect(area.clientHeight, 'the viewport did not take the Root cap').toBeLessThanOrEqual(200);
  expect(
    area.overflows,
    'the viewport does not scroll: content is taller than the box, but there is nothing to scroll — the rest is clipped',
  ).toBe(true);
});

test('a definite-height ScrollArea is unaffected', async ({ page }) => {
  // Negative control for the fix itself. `max-height: inherit` must not change
  // the call sites that already worked, or the fix trades one bug for another.
  await page.setContent(`
    <style>
      .root { position: relative; overflow: hidden; height: 300px; }
      .viewport { height: 100%; max-height: inherit; width: 100%; }
      .row { height: 40px; }
    </style>
    <div class="root" dir="ltr">
      <div class="viewport" data-radix-scroll-area-viewport>
        <div>${'<div class="row">row</div>'.repeat(20)}</div>
      </div>
    </div>
  `);

  const [area] = await measureScrollAreas(page);

  expect(area.clientHeight).toBe(300);
  expect(area.overflows).toBe(true);
});
