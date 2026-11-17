/**
 * Activating a Radix tab and knowing it actually activated.
 *
 * Extracted from settings-modal, which is where the subtleties were found the
 * hard way. Three of them, each of which silently produced a wrong result:
 *
 *  - `sleep(300)` then reading `data-state` races the click. Waiting for THIS
 *    tab to become active is the real signal.
 *  - Waiting for "some active tab" is useless: one always exists, so the wait is
 *    satisfied before the click lands.
 *  - `button[role="tab"]` matches page-wide. Any dialog or sheet has content
 *    behind it, and the office view renders its own Content/Chat tabs first —
 *    so callers must pass a locator already scoped to their container.
 */

import type { Locator, Page } from 'playwright';
import { isVisibleWithin } from './utils.js';

export interface TabActivation {
  works: boolean;
  hasContent: boolean;
  /** Present but not clickable — a state to report, not a failure. */
  disabled: boolean;
}

/**
 * Click `tab` and confirm it became the active tab with a visible panel.
 *
 * `fallbackPanel` is used when the tab carries no `aria-controls`; pass one
 * scoped to the same container, for the same reason the tab locator must be.
 */
export async function activateTab(
  page: Page,
  tab: Locator,
  name: string,
  fallbackPanel: Locator
): Promise<TabActivation> {
  if (!(await isVisibleWithin(tab, 2000))) {
    console.log(`  ${name}: tab not present`);
    return { works: false, hasContent: false, disabled: false };
  }

  if (await tab.isDisabled()) {
    console.log(`  ${name}: disabled`);
    return { works: false, hasContent: false, disabled: true };
  }

  await tab.click({ force: true });

  const works = await tab
    .and(page.locator('[data-state="active"]'))
    .waitFor({ state: 'visible', timeout: 5000 })
    .then(() => true)
    .catch(() => false);

  // An attribute selector rather than `#id`: Radix ids contain characters that
  // need escaping, and CSS.escape is a browser API absent from the Node process
  // the runner executes in.
  const panelId = await tab.getAttribute('aria-controls');
  const hasContent = panelId
    ? await isVisibleWithin(page.locator(`[id="${panelId}"]`), 5000)
    : await isVisibleWithin(fallbackPanel, 5000);

  console.log(`  ${name}: works=${works}, hasContent=${hasContent}`);
  return { works, hasContent, disabled: false };
}
