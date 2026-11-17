/**
 * Modal and dialog utilities
 */

import type { Page } from 'playwright';
import { waitForRegistrationToSettle } from './post-registration.js';
import { reportTimeout } from './screen-state.js';
import { sleep } from './utils.js';
import { UxIssueTracker } from './ux-tracker.js';

/**
 * NOTE ON `isVisible()` IN THIS FILE
 *
 * Everything here is a PROBE: "is this unexpected thing present right now?" — an
 * error toast, a leftover modal, a still-spinning loader inside a polling loop.
 * For those, the immediate snapshot is the correct semantics, and the waiting
 * form would spend the whole timeout confirming the common case (nothing there)
 * on every single call.
 *
 * That is the opposite of everywhere else in this suite, where
 * `isVisible({ timeout })` was used believing it waits — it does not, Playwright
 * ignores that option — and sleeps were added to compensate. Those call sites use
 * `isVisibleWithin` from utils.ts. These deliberately do not.
 */


/**
 * Close any open modals by clicking Cancel/Close buttons or pressing Escape.
 * Handles both Radix Dialog modals (Escape works) and raw div overlays
 * like WorkspaceInitializationModal (need to click Cancel button).
 */
export async function closeAnyModals(page: Page, maxAttempts = 5): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    // Check for any visible modal overlay
    const backdrop = page.locator('.bg-black\\/60, [data-state="open"], [role="dialog"]').first();
    if (!await backdrop.isVisible().catch(() => false)) {
      break; // No modal visible
    }

    // Name the match. `[data-state="open"]` is every open Radix primitive --
    // collapsibles, popovers, tooltips -- not only dialogs, and a bare "Modal
    // detected" could not say which one this loop was about to press Cancel on.
    const what = await backdrop
      .evaluate((el) => {
        const id = el.getAttribute('data-testid') ?? el.getAttribute('aria-label') ?? el.getAttribute('role') ?? '';
        // Playwright's isVisible() is true for an element at opacity 0 or
        // behind everything else, so say what a person would actually see.
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        const geometry = `${Math.round(r.width)}x${Math.round(r.height)}@${Math.round(r.x)},${Math.round(r.y)} opacity=${cs.opacity} z=${cs.zIndex}`;
        return `<${el.tagName.toLowerCase()} ${id}> "${(el.textContent ?? '').trim().slice(0, 60)}" [${geometry}]`;
      })
      .catch(() => '<gone>');
    console.log(`  closeAnyModals: Modal detected (attempt ${i + 1}/${maxAttempts}): ${what}`);

    // "Secure your account" is not dismissable: Escape closes the card and
    // leaves the join wizard behind it, whose Cancel discards the new account.
    // It is answered instead, whichever path registered the account, and the
    // wizard still painted during navigation is waited out, not escaped.
    if (await page.getByTestId('post-registration').isVisible().catch(() => false)) {
      await waitForRegistrationToSettle(page);
      continue;
    }

    // Strategy 1: Click Cancel or Close button inside the modal
    const cancelBtn = page.locator(
      '.bg-black\\/60 button:has-text("Cancel"), ' +
      '[role="dialog"] button:has-text("Cancel"), ' +
      '[role="dialog"] button:has-text("Close"), ' +
      '[data-state="open"] button[aria-label="Close"]'
    ).first();

    if (await cancelBtn.isVisible().catch(() => false)) {
      const label = await cancelBtn
        .evaluate((el) => `${el.getAttribute('aria-label') ?? ''} "${(el.textContent ?? '').trim().slice(0, 40)}"`)
        .catch(() => '<gone>');
      console.log(`  closeAnyModals: Clicking Cancel/Close button: ${label}`);
      // The click may LOSE ITS TARGET, and that is a success, not a failure.
      //
      // Modals here animate in and out, so the button is mid-transform when
      // this runs. Playwright waits for stability, retries, and if the dialog
      // finishes closing on its own the element detaches — at which point it
      // retried for the rest of its thirty seconds and then threw, out of a
      // HELPER, killing whichever spec called it. Measured in CI:
      //
      //   element is not stable / element was detached from the DOM, retrying
      //   at closeAnyModals ... at createAccount ... at runTest
      //
      // A short budget and a swallowed rejection: the loop's own check decides
      // whether a modal is still there, and that check is the one that matters.
      await cancelBtn.click({ timeout: 3_000 }).catch(() => {});
      await sleep(500);
      continue;
    }

    // Strategy 2: Press Escape (works for Radix dialogs)
    console.log('  closeAnyModals: Pressing Escape');
    await page.keyboard.press('Escape');
    await sleep(300);
  }
}

/**
 * Check for error toasts or messages on the page
 */
export async function checkForErrors(page: Page, context: string, uxTracker: UxIssueTracker | null = null): Promise<boolean> {
  // Sonner renders each toast as `<li data-sonner-toast data-type="error">`
  // inside an <ol> — it sets NO role="alert", so the previous selector matched
  // nothing and this helper silently reported "no errors" for every caller in
  // the suite. Verified against the live DOM, not assumed. The role-based arm
  // is kept for any non-Sonner alert that may be rendered elsewhere.
  const errorToast = page
    .locator(
      '[data-sonner-toast][data-type="error"], ' +
        '[role="alert"]:has-text("error"), [role="alert"]:has-text("failed")',
    )
    .first();
  if (await errorToast.isVisible().catch(() => false)) {
    const errorText = await errorToast.textContent();
    if (uxTracker && errorText) {
      uxTracker.log('critical', 'functional', `Error in ${context}: ${errorText}`);
    }
    console.log(`  ERROR in ${context}: ${errorText}`);
    return true;
  }
  return false;
}

/**
 * Wait for workspace to fully load
 * Looks for various sidebar section headers that indicate workspace is ready
 */
export async function waitForWorkspaceLoaded(page: Page, timeout = 60000): Promise<boolean> {
  console.log('  Waiting for workspace to fully load...');
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const loadingIndicator = page.locator('text="Loading workspace..."');
    const isLoading = await loadingIndicator.isVisible().catch(() => false);

    if (!isLoading) {
      // Look for any of the sidebar section headers that indicate workspace is loaded.
      // Sidebar labels use Title Case (e.g. "Workspace Members"), not the
      // historical UPPERCASE — text="..." is a case-sensitive exact match
      // in Playwright, so the strings below must match the rendered text
      // verbatim. The data-sidebar attribute is the most reliable signal
      // and is checked first to short-circuit the slower text matches.
      const sidebarIndicators = [
        // Sidebar group labels from the workspace layout (most reliable)
        '[data-sidebar="group-label"]',
        // The sidebar header's own control. This said `workspace-name`, which
        // the app has never rendered, so the line was inert among selectors
        // chosen for reliability.
        '[data-testid="workspace-switcher"]',
        // Section header. The sidebar list called itself three different
        // things depending on state the user could not see -- "Workspace
        // Members", "Connected Peers", or "<Entity> Members" -- and that was
        // deliberately unified to `Members`, or `<Entity> Members` when it is
        // genuinely scoped to an office or room (see membersSectionLabel).
        //
        // Both older spellings stayed here as indicators afterwards. Neither
        // can match: "Connected Peers" is now only a doc comment explaining
        // its own removal, and "Workspace Members" survives only in the user
        // SEARCH results, which is a different component in a different part
        // of the screen. A locator that matches nothing does not fail -- it
        // waits and falls through -- so this helper was two indicators poorer
        // than it read.
        'text="Members"',
        'text="Direct Messages"',
        'text="FILES"',
        // Office/room navigation elements
        'text="General"',
        // Width-independent. Every indicator above lives in the sidebar, which
        // at phone widths is a drawer that starts CLOSED — so on mobile this
        // helper reported "not loaded" for a workspace that had rendered fine.
        // The avatar sits in the top bar, which the workspace shell always
        // renders at any width, so it is the one signal that does not depend on
        // the sidebar being open.
        '[data-testid="user-avatar-button"]',
      ];

      for (const selector of sidebarIndicators) {
        const element = page.locator(selector).first();
        if (await element.isVisible().catch(() => false)) {
          console.log('  Workspace fully loaded');
          return true;
        }
      }

      // Additional check: if we're on a workspace URL and there's a sidebar element visible
      const currentUrl = page.url();
      if (currentUrl.includes('/workspace') || currentUrl.includes('/office')) {
        // Only the workspace's own sidebar. The router navigates in a transition,
        // so Landing stays on screen at /workspace until the lazy workspace chunk
        // loads, and its legal-links <nav> once satisfied `aside, nav` there: specs
        // were told "loaded" on the landing page and acted on nothing.
        const sidebar = page.locator('[data-sidebar="sidebar"]').first();
        if (await sidebar.isVisible().catch(() => false)) {
          // Sidebar is visible - check for any content inside it
          const sidebarText = await sidebar.textContent().catch(() => '');
          if (sidebarText && sidebarText.length > 20) {
            console.log('  Workspace loaded (sidebar with content detected)');
            return true;
          }
        }
      }
    }

    await sleep(1000);
  }

  await reportTimeout(page, 'Workspace loading timeout');
  return false;
}

/**
 * Toast state counts - tracks visible toast notifications
 */
export interface ToastState {
  successCount: number;
  errorCount: number;
  warningCount: number;
  totalCount: number;
}

/**
 * Check the current state of toast notifications on the page.
 * Supports both Sonner and Radix UI toast components.
 */
export async function checkToastState(page: Page): Promise<ToastState> {
  // Sonner toast selectors
  const sonnerToasts = page.locator('[data-sonner-toast]');
  const sonnerSuccess = page.locator('[data-sonner-toast][data-type="success"]');
  const sonnerError = page.locator('[data-sonner-toast][data-type="error"]');
  const sonnerWarning = page.locator('[data-sonner-toast][data-type="warning"]');

  // Radix UI toast selectors (fallback)
  const radixToasts = page.locator('[data-radix-toast-viewport] [data-state="open"]');
  const radixDestructive = page.locator('[data-radix-toast-viewport] [data-state="open"].destructive');

  // Count Sonner toasts
  const sonnerTotal = await sonnerToasts.count();
  const sonnerSuccessCount = await sonnerSuccess.count();
  const sonnerErrorCount = await sonnerError.count();
  const sonnerWarningCount = await sonnerWarning.count();

  // Count Radix toasts (if Sonner not in use)
  const radixTotal = await radixToasts.count();
  const radixDestructiveCount = await radixDestructive.count();

  // Combine counts (prefer Sonner if both present)
  if (sonnerTotal > 0) {
    return {
      successCount: sonnerSuccessCount,
      errorCount: sonnerErrorCount,
      warningCount: sonnerWarningCount,
      totalCount: sonnerTotal,
    };
  }

  // Radix fallback - classify destructive as error
  return {
    successCount: radixTotal - radixDestructiveCount,
    errorCount: radixDestructiveCount,
    warningCount: 0,
    totalCount: radixTotal,
  };
}

/**
 * Assert that no conflicting toasts appear (both success AND error visible).
 * This indicates a bug in the response handling - operations shouldn't
 * trigger both success and error simultaneously.
 *
 * @returns true if no conflict (test should continue), false if conflict detected
 * @throws Error if conflict detected and uxTracker is null (strict mode)
 */
export async function assertNoToastConflict(
  page: Page,
  context: string,
  uxTracker: UxIssueTracker | null = null
): Promise<boolean> {
  // Wait briefly for toasts to appear
  await sleep(500);

  const state = await checkToastState(page);

  if (state.successCount > 0 && state.errorCount > 0) {
    const message = `Toast conflict in ${context}: ${state.successCount} success and ${state.errorCount} error toasts visible simultaneously`;
    console.log(`  CONFLICT: ${message}`);

    if (uxTracker) {
      uxTracker.log('critical', 'functional', message);
    }

    // Return false to indicate test should fail
    return false;
  }

  if (state.errorCount > 0) {
    // Only error toasts visible - this is a real error
    console.log(`  ERROR TOAST: ${state.errorCount} error toast(s) visible in ${context}`);

    // Try to get error text for debugging
    const errorToast = page.locator('[data-sonner-toast][data-type="error"], [data-radix-toast-viewport] .destructive').first();
    if (await errorToast.isVisible().catch(() => false)) {
      const errorText = await errorToast.textContent();
      console.log(`  Error content: ${errorText}`);
      if (uxTracker) {
        uxTracker.log('critical', 'functional', `Error toast in ${context}: ${errorText}`);
      }
    }
    return false;
  }

  if (state.successCount > 0) {
    console.log(`  ✓ Success toast visible (${state.successCount} toast(s))`);
  }

  return true;
}

/**
 * Wait for tree data to be loaded in the sidebar.
 * The sidebar shows either tree-node elements (when nodes exist) or
 * the empty state (tree-empty). Either indicates the tree data has loaded.
 * This is more reliable than waitForWorkspaceLoaded() for operations
 * that depend on state.treeSchema being populated.
 */
export async function waitForTreeDataLoaded(page: Page, timeout = 30000): Promise<boolean> {
  console.log('  Waiting for tree data to load...');
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const treeNode = page.locator(
      '[data-testid^="tree-node-"]:not([data-testid^="tree-node-menu-"]):not([data-testid^="tree-node-toggle-"])'
    );
    // By testid: the empty state's copy changed and "No nodes yet" matched nothing.
    const emptyState = page.getByTestId('tree-empty');

    if (await treeNode.first().isVisible().catch(() => false)) {
      console.log('  Tree data loaded (nodes visible)');
      return true;
    }
    if (await emptyState.isVisible().catch(() => false)) {
      console.log('  Tree data loaded (empty state)');
      return true;
    }

    await sleep(500);
  }

  await reportTimeout(page, 'Tree data loading timeout');
  return false;
}

/**
 * Wait for and dismiss all visible toasts
 */
export async function dismissAllToasts(page: Page, timeout = 5000): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const state = await checkToastState(page);
    if (state.totalCount === 0) {
      return;
    }

    // Try clicking dismiss buttons
    const dismissBtn = page.locator('[data-sonner-toast] button[data-dismiss], [data-radix-toast-viewport] button[aria-label*="close"]').first();
    if (await dismissBtn.isVisible().catch(() => false)) {
      // Same reasoning as closeAnyModals: a toast dismisses itself on a timer,
      // so the button this just found may be gone before the click lands. The
      // loop's own count is what decides whether any are left.
      await dismissBtn.click({ timeout: 3_000 }).catch(() => {});
    }

    await sleep(500);
  }
}
