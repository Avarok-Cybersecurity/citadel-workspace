import type { Page } from 'playwright';
import { isVisibleWithin } from './utils.js';

/**
 * How long the server's role answer may trail the workspace load. The old 10s
 * was a guess that a loaded runner beat. Env-overridable so a control can
 * prove the check still fails.
 */
export const ADMIN_ROLE_BUDGET_MS: number = Number(process.env.ADMIN_ROLE_BUDGET_MS ?? 45_000);

/**
 * Wait for the signed-in user to be SHOWN as admin, and say which of two
 * different things happened if they are not.
 *
 * The role is not on screen "from the moment the workspace loads". TopBar
 * reads it from `state.currentUser.role`, which the server fills in after the
 * sidebar is up, and on a loaded runner that answer can trail the load by more
 * than 10s. Run 33914939883 recorded exactly that: React took 6.9s to render,
 * the `_admin_ready` screenshot shows the avatar with NO ring, `Admin status:
 * FAIL` -- and the `_node_updated` screenshot seconds later shows the admin
 * ring, the ADMIN SETTINGS badge, and an office this user had just created.
 * The user was admin; the check measured latency and called it a role.
 *
 * "Never became admin" and "role never arrived" need different fixes, and a
 * bare FAIL hid the difference for two runs, in two specs.
 */
export async function waitForAdminRole(page: Page, budgetMs: number = ADMIN_ROLE_BUDGET_MS): Promise<boolean> {
  const avatar = page.locator('[data-testid="user-avatar-button"]');
  const adminAvatar = page.locator('[data-testid="user-avatar-button"][title="Workspace Administrator"]');
  const started = Date.now();
  const isAdmin = await isVisibleWithin(adminAvatar, budgetMs);
  const elapsed = Date.now() - started;
  if (isAdmin) {
    console.log(`  Admin status: PASS (role arrived after ${elapsed}ms)`);
  } else if (await avatar.count()) {
    console.log(`  Admin status: FAIL — avatar present but role never became admin within ${budgetMs}ms`);
  } else {
    console.log(`  Admin status: FAIL — no avatar at all within ${budgetMs}ms (workspace state never populated)`);
  }
  return isAdmin;
}
