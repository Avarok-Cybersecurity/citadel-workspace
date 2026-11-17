/**
 * In-app route navigation for specs.
 *
 * `page.goto()` is the wrong tool once a session exists: a full document load
 * tears down the WASM client and its WebSocket, so the app comes back up
 * unauthenticated and every later assertion fails for a reason that has nothing
 * to do with what the spec is testing. pushState + popstate is what react-router
 * listens for, and it keeps the session intact.
 */

import type { Page } from 'playwright';
import { isVisibleWithin } from './utils.js';

/**
 * Navigate to `path` client-side and wait for `heading` to confirm arrival.
 *
 * Returns false rather than throwing, so a spec can report "did not navigate"
 * as the failed assertion it is instead of dying with a locator timeout.
 */
export async function navigateInApp(
  page: Page,
  path: string,
  heading: string,
  timeoutMs = 15_000
): Promise<boolean> {
  await page.evaluate((target) => {
    window.history.pushState({}, '', target);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path);

  // The heading appearing IS the signal that the route rendered. Waiting on it
  // replaces a fixed sleep and returns as soon as the page is actually ready.
  if (await isVisibleWithin(page.locator(`h1:has-text("${heading}")`), timeoutMs)) {
    return true;
  }

  // Fall back to a real link if one is on screen — covers the case where the
  // route guard bounced us and only a nav click will pass through it.
  const link = page.locator(`[href="${path}"], a[href*="${path}"]`).first();
  if (await isVisibleWithin(link, 3000)) {
    await link.click();
    return await isVisibleWithin(page.locator(`h1:has-text("${heading}")`), timeoutMs);
  }

  return false;
}

/** The workspace user directory. Route is `/directory`, heading "User Directory". */
export async function navigateToDirectory(page: Page): Promise<boolean> {
  console.log('\n=== Navigating to User Directory ===');
  const ok = await navigateInApp(page, '/directory', 'User Directory');
  console.log(ok ? '  On the User Directory' : '  Could not reach the User Directory');
  return ok;
}
