/**
 * Reaching the workspace admin panel.
 *
 * There is exactly one way in: open a tree node's ⋯ menu in the sidebar, choose
 * Admin Settings, and the modal appears with its tabs. member-management used to
 * guess at a different route entirely — a sidebar "Admin" button, then a "Member
 * Management" button, neither of which exists — so it never opened the panel and
 * reported four failures the app had not made. Sharing the path that works keeps
 * the next spec from inventing a third one.
 */

import type { Locator, Page } from 'playwright';
import { isHiddenWithin, isVisibleWithin } from './utils.js';
import { rootRow, rowNodeId } from './focused-tree.js';

/** useIsMobile's breakpoint (src/hooks/use-mobile.tsx). */
const MOBILE_BREAKPOINT_PX = 768;

/** The admin modal, identified by its own testid rather than "some dialog". */
export function adminDialog(page: Page) {
  return page.locator('[role="dialog"][data-testid="admin-modal"]');
}

/**
 * Open the ⋯ context menu of the workspace root.
 *
 * Not "the first menu on screen": the focused sidebar shows menus on the
 * selection and its peers only, and landing selects the default node, so the
 * first menu belonged to an office -- whose Members tab lists workspace
 * administrators as inherited and locked, which is not the panel callers want.
 */
export async function openNodeContextMenu(page: Page): Promise<boolean> {
  const root: Locator = rootRow(page);
  if (!(await isVisibleWithin(root, 10_000))) return false;
  const rootId: string | null = await rowNodeId(root);
  if (rootId === null) return false;

  if ((await root.getAttribute('aria-selected')) !== 'true') {
    await root.click();
    // Below the app's 768px mobile breakpoint a selection closes the sidebar
    // sheet. Wait for it to finish closing -- while it slides out the row is
    // still visible, and a menu opened then goes with it -- and open it again.
    if ((page.viewportSize()?.width ?? Infinity) < MOBILE_BREAKPOINT_PX) {
      if (!(await isHiddenWithin(root, 5000))) return false;
      await page.getByTestId('sidebar-toggle').click();
    }
    if (!(await isVisibleWithin(root.and(page.locator('[aria-selected="true"]')), 5000))) return false;
  }

  // Not forced: force skips Playwright's stability wait, and a row that was
  // just selected is still gliding -- the click lands where the trigger was.
  // (opacity-0 until hover does not need force; Playwright counts it visible.)
  await page.getByTestId(`tree-node-menu-${rootId}`).click({ timeout: 10_000 });
  return await isVisibleWithin(page.locator('[role="menu"]'), 5000);
}

/** Choose "Admin Settings" from an open node context menu and wait for the modal. */
export async function openAdminPanel(page: Page): Promise<boolean> {
  if (!(await openNodeContextMenu(page))) {
    console.log('  Could not open a tree node context menu');
    return false;
  }

  const item = page.locator('[data-testid^="admin-settings-node-"]').first();
  if (!(await isVisibleWithin(item, 5000))) {
    console.log('  No Admin Settings item in the context menu');
    return false;
  }

  await item.click();
  return await isVisibleWithin(adminDialog(page), 10_000);
}

/** Activate one of the admin panel's tabs and confirm its content rendered. */
export async function activateAdminTab(
  page: Page,
  name: 'general' | 'members' | 'chat'
): Promise<boolean> {
  const dialog = adminDialog(page);
  const tab = dialog.locator(`[data-testid="admin-tab-${name}"]`);
  if (!(await isVisibleWithin(tab, 5000))) return false;

  await tab.click();
  return await isVisibleWithin(dialog.locator(`[data-testid="admin-content-${name}"]`), 5000);
}
