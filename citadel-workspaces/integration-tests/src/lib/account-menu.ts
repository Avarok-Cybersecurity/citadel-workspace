import { expect, type Locator, type Page } from '@playwright/test';

/**
 * What the page can tell us about why the account menu did not open.
 *
 * Exported so it can be exercised against a page where the avatar genuinely is
 * not present — a diagnostic nobody has ever seen produce output is a
 * diagnostic that might not work.
 */
export async function describeAccountMenu(page: Page): Promise<string> {
  return page.evaluate((): string => {
    const avatar: Element | null = document.querySelector('[data-testid="user-avatar-button"]');
    if (!avatar) return 'no [data-testid="user-avatar-button"] in the document at all';

    const box: DOMRect = avatar.getBoundingClientRect();
    const onScreen: boolean =
      box.width > 0 && box.height > 0 && box.top >= 0 && box.left >= 0 &&
      box.bottom <= window.innerHeight && box.right <= window.innerWidth;
    const covering: Element | null = document.elementFromPoint(
      box.left + box.width / 2,
      box.top + box.height / 2,
    );
    const covered: string =
      covering && covering !== avatar && !avatar.contains(covering)
        ? `${covering.tagName.toLowerCase()}${covering.className ? `.${String(covering.className).split(' ')[0]}` : ''}`
        : 'nothing';

    const menus: number = document.querySelectorAll('[role="menu"]').length;
    const items: string[] = Array.from(document.querySelectorAll('[role="menuitem"]')).map(
      (item) => item.getAttribute('data-testid') ?? `(untagged: ${item.textContent?.trim().slice(0, 20)})`,
    );

    return [
      `avatar ${Math.round(box.width)}x${Math.round(box.height)} at (${Math.round(box.left)},${Math.round(box.top)})`,
      `viewport ${window.innerWidth}x${window.innerHeight}`,
      onScreen ? 'on screen' : 'OFF SCREEN',
      `covered by ${covered}`,
      `${menus} open menu(s)`,
      `items: ${items.length > 0 ? items.join(', ') : 'none'}`,
    ].join(' | ');
  });
}

/**
 * Open the account menu and press one of its items.
 *
 * Two things make this harder than one click, and both were solved once and
 * then not propagated.
 *
 * **The menu closes under you.** The workspace keeps streaming data in for a
 * while after it first renders, and a re-render dismisses an open Radix
 * dropdown. Clicking the avatar once and then waiting on an item means waiting
 * forever on a menu that closed a frame after it opened. `workspace-theme` and
 * `responsive` each grew their own retry loop; `accessibility` never got one.
 *
 * **A forced click on the item cannot land.** Radix positions the content
 * asynchronously, and `{ force: true }` skips exactly the wait that lets it
 * finish. Playwright then reports "Element is outside of the viewport" after
 * "done scrolling" — because a `position: fixed` popper cannot be scrolled into
 * view.
 *
 * So: force the avatar (the churn is real and the trigger is a plain button),
 * retry until the item appears, then click the item WITHOUT force so
 * actionability does its job.
 *
 * When the retries run out, SAY WHY. The first version reported only
 * "getByTestId('account-menu-settings') not found after 60000ms", which is true
 * of a menu that never opened, a menu that opened without that item, and an
 * avatar that is not on the page — three different faults with one sentence
 * between them. At 375px this failed for sixty seconds three times over and the
 * report could not distinguish any of them.
 */
export async function pressAccountMenuItem(page: Page, testId: string): Promise<void> {
  const item: Locator = page.getByTestId(testId);

  try {
    await expect(async () => {
      await page.getByTestId('user-avatar-button').click({ force: true });
      await expect(item).toBeVisible({ timeout: 3_000 });
    }).toPass({ timeout: 60_000 });
  } catch (error) {
    throw new Error(
      `the account menu never offered "${testId}". ${await describeAccountMenu(page)}\n` +
        `(original: ${error instanceof Error ? error.message.split('\n')[0] : String(error)})`,
    );
  }

  // In the viewport, not merely visible: `toBeVisible` is satisfied by a popper
  // that has been rendered but not yet positioned, which is the state the
  // forced click used to fail on.
  await expect(item).toBeInViewport({ timeout: 10_000 });
  await item.click();
}
