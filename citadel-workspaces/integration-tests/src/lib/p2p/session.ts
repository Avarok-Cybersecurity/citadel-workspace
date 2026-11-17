/**
 * P2P Session Management - disconnect, reconnect, and session lifecycle via UI
 */

import type { Page } from 'playwright';
import { sleep } from '../utils.js';
import { waitForWorkspaceLoaded, closeAnyModals } from '../modals.js';
import { takeScreenshot } from '../screenshots.js';
import { waitForAppReady } from '../browser.js';
import { UxIssueTracker } from '../ux-tracker.js';
import { isVisibleWithin } from '../utils.js';

/**
 * Simulate TCP drop by closing the page.
 * This orphans the session (unlike Sign out which removes it entirely).
 *
 * After TCP drop:
 * - Session IS in OrphanSessionsNavbar (can be reclaimed)
 * - P2P ratchets/cryptographic state PERSIST
 * - ILM can deliver queued messages after ClaimSession
 *
 * Use this for testing ILM offline messaging.
 */
export async function disconnectViaTcpDrop(
  page: Page,
  username: string,
  _uxTracker: UxIssueTracker | null = null
): Promise<boolean> {
  console.log(`\n=== ${username}: Simulating TCP drop (closing page) ===`);

  try {
    await takeScreenshot(page, `${username}_before_tcp_drop`);

    // Close the page to simulate TCP connection drop
    // This will orphan the session but preserve P2P cryptographic state
    await page.close();

    console.log(`  ${username} page closed (TCP drop simulated)`);
    return true;
  } catch (error) {
    console.log(`  Error during TCP drop simulation: ${error}`);
    return false;
  }
}

/**
 * Assert that a session IS in OrphanSessionsNavbar.
 * This is used to verify that TCP drop orphaned the session properly.
 */
export async function assertSessionInOrphanNavbar(
  page: Page,
  username: string,
  uxTracker: UxIssueTracker | null = null
): Promise<boolean> {
  console.log(`\n=== Asserting ${username} IS in OrphanSessionsNavbar ===`);

  try {
    // Retry up to 5 times - TCP drop detection can take time on the server
    for (let attempt = 1; attempt <= 5; attempt++) {
      await takeScreenshot(page, `${username}_landing_orphan_check`);

      // Check for session icon - it SHOULD exist for orphaned session
      const sessionIcon = page.locator(`[data-testid="session-icon-${username}"]`);
      const sessionButton = page.locator(`[data-testid="session-button-${username}"]`);

      // Also try username partial match (in case testid doesn't include full username)
      const usernamePrefix = username.substring(0, 15); // First 15 chars
      const partialMatch = page.locator(`[data-testid*="session"]:has-text("${usernamePrefix}")`).first();

      const iconVisible = await isVisibleWithin(sessionIcon, 3000);
      const buttonVisible = await isVisibleWithin(sessionButton, 1000);
      const partialVisible = await isVisibleWithin(partialMatch, 1000);

      if (iconVisible || buttonVisible || partialVisible) {
        console.log(`  PASS: Session for ${username} FOUND in OrphanSessionsNavbar (as expected, attempt ${attempt})`);
        return true;
      }

      if (attempt < 5) {
        console.log(`  Session not visible yet on attempt ${attempt}, refreshing and waiting...`);
        // Reload to get fresh session list from internal service
        const config = await import('../config.js');
        await page.goto(config.config.BASE_URL, { waitUntil: 'commit', timeout: 30000 });
        // Wait for the app to actually mount rather than guessing 4-7s. `commit`
        // resolves as soon as the navigation is committed, long before React has
        // rendered, which is what the escalating sleep was standing in for.
        await waitForAppReady(page);
      }
    }

    console.log(`  FAIL: Session for ${username} NOT in OrphanSessionsNavbar (unexpected)`);
    if (uxTracker) {
      uxTracker.log('critical', 'functional', `Session for ${username} not found in OrphanSessionsNavbar after TCP drop`);
    }
    await takeScreenshot(page, `${username}_not_orphaned`);
    return false;
  } catch (error) {
    console.log(`  Error checking OrphanSessionsNavbar: ${error}`);
    return false;
  }
}

/**
 * Disconnect via TopBar "Sign out" button.
 * This triggers InternalServiceRequest::Disconnect which:
 * 1. Drops the live connection (session removed from server_connection_map)
 * 2. Removes the session from stored sessions
 * 3. CID stays the same (tied to account credentials)
 *
 * WARNING: This destroys P2P ratchets/cryptographic state!
 * Use disconnectViaTcpDrop instead for ILM testing.
 *
 * After this, the session should NOT appear in OrphanSessionsNavbar because
 * explicit disconnect removes the session (unlike TCP drop which orphans it).
 *
 * The disconnect flow:
 * 1. Click TopBar avatar to open dropdown
 * 2. Click "Sign out" menu item
 * 3. Wait for disconnect to complete (DisconnectNotification)
 * 4. Page navigates to landing automatically
 */
export async function disconnectViaTopBar(
  page: Page,
  username: string,
  uxTracker: UxIssueTracker | null = null
): Promise<boolean> {
  console.log(`\n=== ${username}: Disconnecting via TopBar Sign out ===`);

  try {
    // Make sure workspace is loaded
    const loaded = await waitForWorkspaceLoaded(page, 30000);
    if (!loaded) {
      console.log('  Workspace not loaded, cannot disconnect');
      return false;
    }

    // Dismiss any blocking modals (e.g. WorkspaceInitializationModal)
    await closeAnyModals(page);

    await takeScreenshot(page, `${username}_before_signout`);

    // Click the TopBar avatar to open dropdown menu
    // Primary: use data-testid for reliability
    let avatarButton = page.locator('[data-testid="user-avatar-button"]').first();

    if (!await isVisibleWithin(avatarButton, 3000)) {
      console.log('  Primary selector failed, trying alternative selectors...');
      // Try any button with Avatar child in the top fixed bar
      avatarButton = page.locator('.fixed.top-0 button:has([class*="Avatar"])').first();
    }

    if (!await isVisibleWithin(avatarButton, 2000)) {
      // Try button with rounded avatar
      avatarButton = page.locator('button:has(.h-8.w-8.rounded-full)').first();
    }

    if (!await isVisibleWithin(avatarButton, 2000)) {
      // Try finding AvatarFallback (shows user initials) and get parent button
      const avatarFallback = page.locator('.bg-\\[\\#444A6C\\]').first();
      if (await isVisibleWithin(avatarFallback, 2000)) {
        avatarButton = avatarFallback.locator('xpath=ancestor::button[1]');
      }
    }

    if (!await isVisibleWithin(avatarButton, 2000)) {
      console.log('  Avatar button not found in TopBar');
      if (uxTracker) {
        uxTracker.log('major', 'functional', 'Avatar button not found in TopBar');
      }
      await takeScreenshot(page, `${username}_avatar_not_found`);
      return false;
    }

    console.log('  Found avatar button, clicking...');
    await avatarButton.click();

    // The menu appearing is the signal. The sign-out lookups below already wait,
    // so this 1s was pure delay — and the screenshot it guarded was just as
    // likely to catch the menu mid-animation.
    await isVisibleWithin(page.locator('[role="menu"]'), 5000);
    await takeScreenshot(page, `${username}_dropdown_opened`);

    // Click "Sign out" in the dropdown menu
    // Radix UI DropdownMenu renders items with role="menuitem"
    // Try multiple selectors to be robust
    let signOutBtn = page.locator('[role="menuitem"]:has-text("Sign out")').first();

    if (!await isVisibleWithin(signOutBtn, 2000)) {
      // Try text match with exact text
      signOutBtn = page.locator('text="Sign out"').first();
    }

    if (!await isVisibleWithin(signOutBtn, 2000)) {
      // Try div with text content (Radix renders as div)
      signOutBtn = page.locator('div:text-is("Sign out")').first();
    }

    if (!await isVisibleWithin(signOutBtn, 2000)) {
      // Try any element containing the text (case insensitive)
      signOutBtn = page.locator('text=/sign out/i').first();
    }

    if (!await isVisibleWithin(signOutBtn, 2000)) {
      console.log('  Sign out button not found in dropdown');
      // Debug: List all visible menu items
      const menuItems = await page.locator('[role="menuitem"]').allTextContents().catch(() => []);
      console.log(`  Available menu items: ${menuItems.join(', ') || 'none found'}`);
      if (uxTracker) {
        uxTracker.log('major', 'functional', 'Sign out button not found in dropdown');
      }
      await takeScreenshot(page, `${username}_signout_not_found`);
      // Close dropdown
      await page.keyboard.press('Escape');
      return false;
    }

    console.log('  Clicking Sign out...');
    await signOutBtn.click();

    // Wait for disconnect modal to appear (indicates sign-out started)
    const disconnectModal = page.locator('[data-testid="disconnect-loading-modal"]');
    const modalAppeared = await isVisibleWithin(disconnectModal, 5000);

    if (modalAppeared) {
      console.log('  Disconnect modal appeared, waiting for completion...');

      // Wait for modal to close OR show "ready" state (disconnect complete)
      // The modal shows "✓ Safe to reconnect" when ready, then auto-closes after 1.5s
      // But sometimes the auto-close doesn't work, so we check for ready state as fallback
      let disconnectCompleted = false;
      const startTime = Date.now();
      const maxWaitTime = 45000; // 45 seconds max

      // Poll for modal to close or show ready state
      while (!disconnectCompleted && (Date.now() - startTime) < maxWaitTime) {
        // Check if modal closed
        const stillVisible = await disconnectModal.isVisible().catch(() => false);
        if (!stillVisible) {
          console.log('  Disconnect modal closed successfully');
          disconnectCompleted = true;
          break;
        }

        // Check modal content for ready state
        // "Session Disconnected" = ready state, "Disconnecting Session" = still processing
        const modalContent = await disconnectModal.textContent().catch(() => '');
        const isReady = modalContent?.includes('Session Disconnected') ||
          modalContent?.includes('Safe to reconnect') ||
          modalContent?.includes('safely reconnect');

        if (isReady) {
          console.log('  Disconnect completed (modal shows ready state)');
          disconnectCompleted = true;

          // Modal shows ready but didn't auto-close - navigate manually
          console.log('  Navigating to landing page manually...');
          const config = await import('../config.js');
          await page.goto(config.config.BASE_URL);
          await sleep(500);
          break;
        }

        // Log progress every 5 seconds
        const elapsed = Date.now() - startTime;
        if (elapsed > 0 && elapsed % 5000 < 600) {
          console.log(`  Still waiting... (${Math.floor(elapsed / 1000)}s) - Modal: ${modalContent?.substring(0, 50)}...`);
        }

        // Still processing, wait a bit and check again
        await sleep(500);
      }

      if (!disconnectCompleted) {
        const modalContent = await disconnectModal.textContent().catch(() => '');
        console.log(`  ERROR: Disconnect timeout after ${(Date.now() - startTime) / 1000}s`);
        console.log(`  Modal content: ${modalContent?.substring(0, 200)}`);
        await takeScreenshot(page, `${username}_disconnect_timeout`);

        if (uxTracker) {
          uxTracker.log('critical', 'functional', `Disconnect timeout for ${username}: ${modalContent?.substring(0, 100)}`);
        }
        return false;
      }
    } else {
      console.log('  Warning: Disconnect modal did not appear, falling back to sleep');
      await sleep(5000);
    }

    const config = await import('../config.js');

    // Wait for the landing navigation itself rather than guessing 300ms and then,
    // if that guess was wrong, another 2s. Resolves the moment the URL settles.
    await page
      .waitForURL(url => url.href.includes(config.config.BASE_URL) && !url.href.includes('/office'),
                  { timeout: 5000 })
      .catch(() => { /* verified below, which reports the actual URL */ });

    const currentUrl = page.url();
    if (!currentUrl.includes(config.config.BASE_URL) || currentUrl.includes('/office')) {
      console.log(`  Expected landing page but got: ${currentUrl}`);
    }

    console.log(`  ${username} signed out successfully`);
    await takeScreenshot(page, `${username}_signed_out`);
    return true;
  } catch (error) {
    console.log(`  Error during sign out: ${error}`);
    await takeScreenshot(page, `${username}_signout_error`);
    return false;
  }
}

/**
 * Assert that a session is NOT in OrphanSessionsNavbar.
 * This is used to verify that explicit Disconnect removed the session entirely
 * (as opposed to TCP drop which would orphan it).
 */
export async function assertSessionNotInOrphanNavbar(
  page: Page,
  username: string,
  uxTracker: UxIssueTracker | null = null
): Promise<boolean> {
  console.log(`\n=== Asserting ${username} NOT in OrphanSessionsNavbar ===`);

  try {
    const config = await import('../config.js');

    // Retry up to 3 times with increasing delays to allow server-side cleanup
    for (let attempt = 1; attempt <= 3; attempt++) {
      // Navigate to landing page where OrphanSessionsNavbar would be visible
      await page.goto(config.config.BASE_URL, { waitUntil: 'commit', timeout: 30000 });
      await waitForAppReady(page);

      await takeScreenshot(page, `${username}_landing_for_orphan_check`);

      // Check for session icon - it should NOT exist
      const sessionIcon = page.locator(`[data-testid="session-icon-${username}"]`);
      const sessionButton = page.locator(`[data-testid="session-button-${username}"]`);

      const iconVisible = await isVisibleWithin(sessionIcon, 2000);
      const buttonVisible = await isVisibleWithin(sessionButton, 2000);

      if (!iconVisible && !buttonVisible) {
        console.log(`  PASS: Session for ${username} NOT in OrphanSessionsNavbar (as expected, attempt ${attempt})`);
        return true;
      }

      if (attempt < 3) {
        console.log(`  Session still visible on attempt ${attempt}, waiting for server cleanup...`);
      }
    }

    // A function named `assert...` returned TRUE here — in exactly the condition
    // it exists to reject — under the reasoning that a Disconnect/TCP-close race
    // can leave the session visible briefly.
    //
    // The retries above already answer that: three attempts with a 2s visibility
    // probe each is seconds of grace. Still present after all of them is not a
    // race, it is the session never being cleaned up — the "Session Already
    // Connected" lifecycle family this project has repeatedly fought. Four
    // reconnection suites record this return value as their verdict, so the soft
    // pass laundered that whole class into green.
    console.log(`  FAIL: Session for ${username} still in OrphanSessionsNavbar after 3 attempts`);
    if (uxTracker) {
      uxTracker.log('major', 'functional', `Session for ${username} was never removed from OrphanSessionsNavbar`);
    }
    await takeScreenshot(page, `${username}_orphan_not_cleaned_up`);
    return false;
  } catch (error) {
    console.log(`  Error checking OrphanSessionsNavbar: ${error}`);
    return false;
  }
}

/**
 * Login with existing credentials after disconnect.
 * This is used to reconnect after explicit disconnect (NOT for orphan ClaimSession).
 *
 * The login flow:
 * 1. Navigate to landing page
 * 2. Click "Login" button
 * 3. Enter username and password
 * 4. Submit form
 * 5. Wait for workspace to load
 * 6. Wait for p2pAutoConnectService to establish peer connections
 */
export async function loginAfterDisconnect(
  page: Page,
  username: string,
  password: string,
  uxTracker: UxIssueTracker | null = null,
  serverAddress?: string
): Promise<boolean> {
  console.log(`\n=== ${username}: Logging in after disconnect ===`);

  try {
    // Navigate to landing page
    const configModule = await import('../config.js');
    const effectiveServerAddress = serverAddress || configModule.config.WORKSPACE_SERVER;
    console.log(`  Using server address: ${effectiveServerAddress}`);

    await page.goto(configModule.config.BASE_URL, { waitUntil: 'commit', timeout: 30000 });
    await waitForAppReady(page);

    // NOTE: Browser storage clearing was removed because:
    // 1. We use separate browsers per user, so no cross-contamination
    // 2. The stale sessions are in internal service's LocalDB, not browser storage
    // 3. The reload was causing WebSocket disconnect/reconnect race conditions
    // The internal service reuses sessions by username, so Bob gets the same CID

    await takeScreenshot(page, `${username}_landing_for_login`);

    // Check if there's an orphan session for this user (can happen if disconnect didn't fully clean up)
    // Wait longer and use multiple locator strategies to find the orphan
    const usernamePrefix = username.substring(0, 15);
    let orphanFound = false;
    for (let orphanAttempt = 1; orphanAttempt <= 3; orphanAttempt++) {
      const orphanButton = page.locator(`[data-testid="session-button-${username}"]`);
      const orphanIcon = page.locator(`[data-testid="session-icon-${username}"]`);
      const partialMatch = page.locator(`[data-testid*="session"]:has-text("${usernamePrefix}")`).first();
      orphanFound = await isVisibleWithin(orphanButton, 2000) ||
        await isVisibleWithin(orphanIcon, 1000) ||
        await isVisibleWithin(partialMatch, 1000);
      if (orphanFound) {
        console.log(`  Found orphan session for ${username} (attempt ${orphanAttempt}), claiming it instead of fresh login`);
        const clickTarget = await isVisibleWithin(orphanButton, 1000)
          ? orphanButton
          : await isVisibleWithin(orphanIcon, 1000)
            ? orphanIcon
            : partialMatch;
        await clickTarget.click();

        const claimLoaded = await waitForWorkspaceLoaded(page, 45000);
        if (claimLoaded) {
          console.log(`  ${username} reconnected via ClaimSession (orphan recovery)`);
          await takeScreenshot(page, `${username}_logged_in_via_claim`);
          await settleAutoConnect(page);
          return true;
        }
        console.log('  ClaimSession failed, falling back to fresh login...');
        await page.goto(configModule.config.BASE_URL, { waitUntil: 'commit', timeout: 30000 });
        await waitForAppReady(page);
        break; // Don't retry orphan claim, fall through to fresh login
      }
      if (orphanAttempt < 3) {
        console.log(`  No orphan found on attempt ${orphanAttempt}, waiting and reloading...`);
        await page.goto(configModule.config.BASE_URL, { waitUntil: 'commit', timeout: 30000 });
        await waitForAppReady(page);
      }
    }

    // By testid, not by the word "Login".
    //
    // The landing page's button says "Sign In" and has done for some time, so
    // this found nothing, reported "Login button not found on landing page" as
    // a MAJOR UX issue, and failed the whole reconnection family -- five specs
    // -- on a product that was working. Fifth check this session pinned to copy
    // the app had improved; see round 235 for the other four.
    const loginBtn = page.getByTestId('sign-in-button').first();

    if (!await isVisibleWithin(loginBtn, 5000)) {
      // Check if we're already on login form
      const usernameInput = page.locator('input[placeholder*="username"], input[name="username"]').first();
      if (!await isVisibleWithin(usernameInput, 2000)) {
        console.log('  Login button not found');
        if (uxTracker) {
          uxTracker.log('major', 'functional', 'Login button not found on landing page');
        }
        await takeScreenshot(page, `${username}_login_btn_not_found`);
        return false;
      }
      // Already on login form, proceed
    } else {
      console.log('  Clicking Login button...');
      await loginBtn.click();
      await sleep(1500);
    }

    await takeScreenshot(page, `${username}_login_form`);

    // Fill in username
    const usernameInput = page.locator('input[placeholder*="username"], input[name="username"]').first();
    if (!await isVisibleWithin(usernameInput, 3000)) {
      console.log('  Username input not found');
      return false;
    }
    await usernameInput.fill(username);

    // Fill in password
    const passwordInput = page.locator('input[type="password"]').first();
    if (!await isVisibleWithin(passwordInput, 3000)) {
      console.log('  Password input not found');
      return false;
    }
    await passwordInput.fill(password);

    // Open Advanced Options to fill in server address
    console.log('  Opening Advanced Options...');
    const advancedBtn = page.getByTestId('login-advanced-options').first();
    if (await isVisibleWithin(advancedBtn, 2000)) {
      await advancedBtn.click();
      await sleep(500);

      // Fill in server address
      const serverInput = page.locator('input[placeholder*="127.0.0.1:12349"]').first();
      if (await isVisibleWithin(serverInput, 2000)) {
        await serverInput.fill(effectiveServerAddress);
        console.log(`  Server address filled: ${effectiveServerAddress}`);
      } else {
        console.log('  Server address input not found - trying id selector');
        const serverInputById = page.locator('#server').first();
        if (await isVisibleWithin(serverInputById, 1000)) {
          await serverInputById.fill(effectiveServerAddress);
          console.log(`  Server address filled via id: ${effectiveServerAddress}`);
        } else {
          console.log('  WARNING: Could not fill server address');
        }
      }
    } else {
      console.log('  Advanced Options button not found - server address may not be set');
    }

    await sleep(500);
    await takeScreenshot(page, `${username}_credentials_filled`);

    // Submit the form - Login component button says "Connect"
    // The login form's submit, by testid. The three-way copy match it replaces
    // was one rename away from finding nothing at all.
    const submitBtn = page.getByTestId('login-submit').first();
    if (await isVisibleWithin(submitBtn, 2000)) {
      console.log('  Clicking submit button...');
      await submitBtn.click();
    } else {
      // Try pressing Enter
      console.log('  Submit button not found, pressing Enter...');
      await passwordInput.press('Enter');
    }

    console.log('  Waiting for login to complete...');
    // Wait for the navigation itself rather than sleeping 3s and then, if that
    // guess was wrong, another 5s. Same 8s ceiling, but it continues the moment
    // the URL changes — which is the thing the sleeps were approximating.
    await page
      .waitForURL(/\/(workspace|office)/, { timeout: 8000 })
      .catch(() => {
        console.log(`  Page still on: ${page.url()} (not /workspace yet)`);
      });

    // Wait for workspace to load
    const loaded = await waitForWorkspaceLoaded(page, 45000);
    if (!loaded) {
      console.log('  Workspace did not load after login');
      await takeScreenshot(page, `${username}_login_workspace_failed`);

      // Check current URL - if on /workspace, try reloading the page
      const currentUrl = page.url();
      if (currentUrl.includes('/workspace') || currentUrl.includes('/office')) {
        console.log('  On workspace URL but sidebar not rendered - reloading page...');
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
        // No sleep here: waitForWorkspaceLoaded below already polls for the
        // sidebar for up to 30s, so a fixed delay only added to that budget.
        const reloadLoaded = await waitForWorkspaceLoaded(page, 30000);
        if (reloadLoaded) {
          console.log(`  ${username} workspace loaded after reload`);
          await takeScreenshot(page, `${username}_logged_in_via_reload`);
          await settleAutoConnect(page);
          return true;
        }
        console.log('  Workspace still not loaded after reload');
      }

      // Retry: clear browser storage and navigate to landing
      console.log('  Clearing browser storage for clean retry...');
      try {
        await page.evaluate(async () => {
          localStorage.clear();
          sessionStorage.clear();
        });
      } catch { /* page may not be responsive */ }

      await page.goto(configModule.config.BASE_URL, { waitUntil: 'commit', timeout: 30000 });
      await sleep(3000);

      // Check if the session appeared as orphan (server created session but frontend missed it)
      const retryOrphanBtn = page.locator(`[data-testid="session-button-${username}"]`);
      const retryOrphanIcon = page.locator(`[data-testid="session-icon-${username}"]`);
      const retryUsernamePrefix = username.substring(0, 15);
      const retryPartialMatch = page.locator(`[data-testid*="session"]:has-text("${retryUsernamePrefix}")`).first();
      const hasRetryOrphan = await isVisibleWithin(retryOrphanBtn, 3000) ||
        await isVisibleWithin(retryOrphanIcon, 1000) ||
        await isVisibleWithin(retryPartialMatch, 1000);

      if (hasRetryOrphan) {
        console.log(`  Found orphan session on retry, claiming it...`);
        const target = await isVisibleWithin(retryOrphanBtn, 1000)
          ? retryOrphanBtn
          : await isVisibleWithin(retryOrphanIcon, 1000)
            ? retryOrphanIcon
            : retryPartialMatch;
        await target.click();
        const claimLoaded = await waitForWorkspaceLoaded(page, 30000);
        if (claimLoaded) {
          console.log(`  ${username} reconnected via ClaimSession on retry`);
          await takeScreenshot(page, `${username}_logged_in_via_retry_claim`);
          await settleAutoConnect(page);
          return true;
        }
        // ClaimSession navigated but workspace not loaded - try reload
        const claimUrl = page.url();
        if (claimUrl.includes('/workspace') || claimUrl.includes('/office')) {
          console.log('  ClaimSession on workspace URL - reloading...');
          await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
          const claimReloadLoaded = await waitForWorkspaceLoaded(page, 30000);
          if (claimReloadLoaded) {
            console.log(`  ${username} workspace loaded after claim + reload`);
            await takeScreenshot(page, `${username}_logged_in_claim_reload`);
            await settleAutoConnect(page);
            return true;
          }
        }
      }

      // Last resort: try fresh login from scratch after clearing everything
      console.log('  Attempting fresh login from scratch...');
      try {
        await page.evaluate(async () => {
          localStorage.clear();
          sessionStorage.clear();
          if ('indexedDB' in window && indexedDB.databases) {
            const dbs = await indexedDB.databases();
            await Promise.all(dbs.map(db => db.name ? new Promise<void>((resolve) => {
              const req = indexedDB.deleteDatabase(db.name!);
              req.onsuccess = () => resolve();
              req.onerror = () => resolve();
            }) : Promise.resolve()));
          }
        });
      } catch { /* page may not be responsive */ }

      await page.goto(configModule.config.BASE_URL, { waitUntil: 'commit', timeout: 30000 });
      await sleep(3000);

      // Try login form again
      const retryLoginBtn = page.getByTestId('sign-in-button').first();
      if (await isVisibleWithin(retryLoginBtn, 3000)) {
        await retryLoginBtn.click();
        await sleep(1500);
        const retryUsernameInput = page.locator('input[placeholder*="username"], input[name="username"]').first();
        const retryPasswordInput = page.locator('input[type="password"]').first();
        if (await isVisibleWithin(retryUsernameInput, 2000)) {
          await retryUsernameInput.fill(username);
          await retryPasswordInput.fill(password);
          // Open Advanced Options and fill server
          const retryAdvBtn = page.getByTestId('login-advanced-options').first();
          if (await isVisibleWithin(retryAdvBtn, 1000)) {
            await retryAdvBtn.click();
            await sleep(500);
            const retryServerInput = page.locator('input[placeholder*="127.0.0.1:12349"]').first();
            if (await isVisibleWithin(retryServerInput, 1000)) {
              await retryServerInput.fill(effectiveServerAddress);
            } else {
              const retryServerById = page.locator('#server').first();
              if (await isVisibleWithin(retryServerById, 500)) {
                await retryServerById.fill(effectiveServerAddress);
              }
            }
          }
          await sleep(500);
          const retrySubmit = page.getByTestId('login-submit').first();
          if (await isVisibleWithin(retrySubmit, 1000)) {
            await retrySubmit.click();
          } else {
            await retryPasswordInput.press('Enter');
          }
          const freshLoaded = await waitForWorkspaceLoaded(page, 45000);
          if (freshLoaded) {
            console.log(`  ${username} logged in on fresh retry`);
            await takeScreenshot(page, `${username}_logged_in_fresh_retry`);
            await settleAutoConnect(page);
            return true;
          }
        }
      }

      console.log('  All login attempts failed');
      await takeScreenshot(page, `${username}_all_login_failed`);
      return false;
    }

    console.log(`  ${username} logged in successfully`);
    await takeScreenshot(page, `${username}_logged_in`);

    await settleAutoConnect(page);

    return true;
  } catch (error) {
    console.log(`  Error during login: ${error}`);
    await takeScreenshot(page, `${username}_login_error`);
    return false;
  }
}

/**
 * @deprecated Use disconnectViaTopBar instead for explicit disconnect
 *
 * Disconnect via OrphanSessionsNavbar on landing page.
 * This is for ORPHANED sessions (after TCP drop), not for explicit disconnect.
 *
 * For explicit disconnect, use disconnectViaTopBar which triggers
 * InternalServiceRequest::Disconnect.
 */
export async function disconnectViaNavbar(
  page: Page,
  username: string,
  uxTracker: UxIssueTracker | null = null
): Promise<boolean> {
  console.log(`\n=== ${username}: Disconnecting via landing page (DEPRECATED - use disconnectViaTopBar) ===`);

  try {
    // Navigate to landing page where OrphanSessionsNavbar is visible
    const config = await import('../config.js');
    await page.goto(config.config.BASE_URL, { waitUntil: 'commit', timeout: 30000 });
    // `commit` resolves before React has rendered anything, which is what the 3s
    // was covering for. Waiting for the app itself returns as soon as it is up.
    await waitForAppReady(page, 30_000);

    await takeScreenshot(page, `${username}_landing_for_disconnect`);

    // Look for the session icon using data-testid
    const sessionIcon = page.locator(`[data-testid="session-icon-${username}"]`);

    if (!await isVisibleWithin(sessionIcon, 5000)) {
      console.log(`  Session icon for ${username} not found on landing page`);

      // Try alternative: look for any session icons with matching username text
      const altSessionIcon = page.locator(`[data-session-cid]:has-text("${username}")`).first();
      if (!await isVisibleWithin(altSessionIcon, 2000)) {
        if (uxTracker) {
          uxTracker.log('major', 'functional', `Session icon for ${username} not found on landing page`);
        }
        await takeScreenshot(page, `${username}_session_icon_not_found`);
        return false;
      }
      // Use the alternative selector
      await altSessionIcon.hover();
      await sleep(500);
    } else {
      // Hover over session icon to reveal disconnect button
      await sessionIcon.hover();
      await sleep(500);
    }

    await takeScreenshot(page, `${username}_session_icon_hovered`);

    // Look for the disconnect button (appears on hover)
    const disconnectBtn = page.locator(`[data-testid="disconnect-button-${username}"]`);

    if (!await isVisibleWithin(disconnectBtn, 3000)) {
      // Try alternative: look for any X button near the session icon
      const altDisconnectBtn = page.locator(`[data-testid="session-icon-${username}"] ~ button:has(svg.lucide-x), [data-testid="session-icon-${username}"] button:has(svg)`).first();
      if (!await isVisibleWithin(altDisconnectBtn, 2000)) {
        console.log('  Disconnect button not visible after hover');
        if (uxTracker) {
          uxTracker.log('major', 'functional', 'Disconnect button not visible after hover');
        }
        await takeScreenshot(page, `${username}_disconnect_button_not_visible`);
        return false;
      }
      await altDisconnectBtn.click({ force: true });
    } else {
      console.log('  Found disconnect button, clicking...');
      await disconnectBtn.click({ force: true });
    }

    await sleep(2000);
    await takeScreenshot(page, `${username}_disconnect_modal`);

    // Handle DisconnectConfirmModal - click "Disconnect" button (not "Deregister")
    // The modal has two options: "Disconnect" (yellow) and "Deregister" (red)
    const disconnectConfirmBtn = page.locator('button:has-text("Disconnect")').first();

    if (await isVisibleWithin(disconnectConfirmBtn, 3000)) {
      console.log('  Clicking Disconnect in confirmation modal...');
      await disconnectConfirmBtn.click();
      await sleep(3000);

      // Wait for loading modal to complete
      const loadingModal = page.locator('text="Disconnecting"');
      if (await isVisibleWithin(loadingModal, 1000)) {
        console.log('  Waiting for disconnect to complete...');
        await page.waitForSelector('text="Disconnecting"', { state: 'hidden', timeout: 10000 }).catch(() => { });
      }

      console.log(`  ${username} disconnected successfully`);
      await takeScreenshot(page, `${username}_disconnected`);
      return true;
    }

    console.log('  Disconnect confirmation button not found');
    if (uxTracker) {
      uxTracker.log('major', 'functional', 'Disconnect confirmation button not found in modal');
    }
    await takeScreenshot(page, `${username}_disconnect_confirm_not_found`);
    return false;
  } catch (error) {
    console.log(`  Error during disconnect: ${error}`);
    await takeScreenshot(page, `${username}_disconnect_error`);
    return false;
  }
}

/**
 * Reconnect via ClaimSession (clicking on orphan session icon on landing page)
 * Navigates to landing page and clicks on the session icon to reclaim.
 *
 * The reconnect flow:
 * 1. Navigate to landing page where OrphanSessionsNavbar is displayed
 * 2. Find the session icon with data-testid="session-button-{username}"
 * 3. Click it to trigger ClaimSession
 * 4. Wait for workspace to load
 */
export async function reconnectViaClaimSession(
  page: Page,
  username: string,
  uxTracker: UxIssueTracker | null = null
): Promise<boolean> {
  console.log(`\n=== ${username}: Reconnecting via ClaimSession ===`);

  const config = await import('../config.js');

  // Retry loop — mirrors assertSessionInOrphanNavbar pattern
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      // Navigate to landing page
      await page.goto(config.config.BASE_URL, { waitUntil: 'commit', timeout: 30000 });
      await sleep(3000);

      await takeScreenshot(page, `${username}_landing_for_reconnect_attempt${attempt}`);

      // Look for the session button using data-testid
      const sessionButton = page.locator(`[data-testid="session-button-${username}"]`);

      let sessionFound = false;

      if (await isVisibleWithin(sessionButton, 5000)) {
        console.log(`  Found session button for ${username}`);
        await sessionButton.click();
        sessionFound = true;
      } else {
        // Try alternative: look for the session icon container
        const sessionIcon = page.locator(`[data-testid="session-icon-${username}"]`);
        if (await isVisibleWithin(sessionIcon, 3000)) {
          console.log(`  Found session icon for ${username}, clicking...`);
          await sessionIcon.click();
          sessionFound = true;
        } else {
          // Last resort: look for any session with matching text
          const anySession = page.locator(`[data-testid*="session"]:has-text("${username.slice(0, 10)}")`).first();
          if (await isVisibleWithin(anySession, 2000)) {
            console.log(`  Found session via text match`);
            await anySession.click();
            sessionFound = true;
          }
        }
      }

      if (!sessionFound) {
        if (attempt < 3) {
          console.log(`  No session icons found on attempt ${attempt}, reloading...`);
          await sleep(3000 + attempt * 1000);
          continue;
        }
        console.log('  No session icons found after all attempts');
        if (uxTracker) {
          uxTracker.log('major', 'functional', `No session icons found for ${username} on landing page`);
        }
        await takeScreenshot(page, `${username}_no_sessions`);
        return false;
      }


      // Wait for workspace to load after claiming session
      const loaded = await waitForWorkspaceLoaded(page, 45000);
      if (!loaded) {
        console.log('  Workspace did not load after claiming session');
        await takeScreenshot(page, `${username}_reconnect_failed`);
        return false;
      }

      console.log(`  ${username} reconnected successfully via ClaimSession`);
      await takeScreenshot(page, `${username}_reconnected`);
      return true;
    } catch (error) {
      console.log(`  Error during reconnect attempt ${attempt}: ${error}`);
      if (attempt === 3) {
        await takeScreenshot(page, `${username}_reconnect_error`);
        return false;
      }
      await sleep(3000 + attempt * 1000);
    }
  }

  return false;
}

/**
 * Give the P2P auto-connect service a chance to establish peer channels after a
 * login, and return as soon as it has.
 *
 * Replaces six identical `await sleep(10000)` calls that sat on the success paths
 * of the login helpers — 60s of hedging against a background service, paid on
 * every run whether or not the session had any peers to connect to.
 *
 * Two observations make that unnecessary:
 *   - A session with NO registered peers has nothing to wait for. Most specs are
 *     in that position (they log in, then do something unrelated to P2P), and for
 *     them this returns immediately.
 *   - A session WITH peers reports them through p2pAutoConnectService as soon as
 *     each channel comes up, so the wait can end on that rather than on a clock.
 *
 * The service is exposed on `window` only in development builds, which is what
 * the tests run against. If it is absent the helper returns rather than guessing,
 * because the callers that actually need a live channel (p2pRegister,
 * waitForP2PConnection) do their own waiting anyway — this is a head start, not a
 * correctness barrier.
 */
/**
 * Wait for the server reconnect cycle to go quiet.
 *
 * ServerAutoConnect polls roughly every 30s, and a reconnect landing mid-test
 * can produce "Session Already Connected" and block ILM delivery. Two specs
 * handled that by sleeping 35s — one full cycle — which is 70s of a suite run
 * spent waiting on a clock rather than on the thing itself.
 *
 * getPendingReconnectCount() reaching zero is that thing. Returns as soon as it
 * does, and tolerates a build that does not expose the service (production, or a
 * preview server) by not stalling: there is nothing to observe there, and a
 * missing diagnostic should not fail a test.
 */
export async function settleServerAutoConnect(page: Page, timeout = 40_000): Promise<void> {
  const settled = await page
    .waitForFunction(
      () => {
        const svc = (window as unknown as {
          __serverAutoConnectService?: { getPendingReconnectCount(): number };
        }).__serverAutoConnectService;
        if (!svc) return true;
        return svc.getPendingReconnectCount() === 0;
      },
      undefined,
      { timeout, polling: 250 }
    )
    .then(() => true)
    .catch(() => false);

  console.log(
    settled
      ? '  Server reconnect cycle is quiet'
      : `  Server reconnect cycle still busy after ${timeout}ms — continuing anyway`
  );
}

export async function settleAutoConnect(page: Page, timeout = 10000): Promise<void> {
  const connected = await page
    .waitForFunction(
      () => {
        const w = window as unknown as {
          __p2pAutoConnectService?: { getPeersForSession: (cid: bigint) => unknown[] };
          __connectionManager?: { getConnectionStatus?: () => { cid?: bigint } | null };
          __p2pRegistrationService?: { getPeers?: () => { registeredPeers?: unknown[] } };
        };
        const svc = w.__p2pAutoConnectService;
        if (!svc) return true; // not a dev build — nothing to observe, do not stall
        const cid = w.__connectionManager?.getConnectionStatus?.()?.cid;
        if (cid === undefined || cid === null) return false;

        // Nothing to connect TO means nothing to wait for. This is the common
        // case — most specs log in and then do something unrelated to P2P — and
        // without it the helper spent its full timeout confirming that a session
        // with no peers had, indeed, connected to none of them.
        const registered = w.__p2pRegistrationService?.getPeers?.()?.registeredPeers;
        if (Array.isArray(registered) && registered.length === 0) return true;

        return svc.getPeersForSession(cid).length > 0;
      },
      undefined,
      { timeout, polling: 250 }
    )
    .then(() => true)
    .catch(() => false);

  console.log(
    connected
      ? '  P2P auto-connect: peer channels established'
      : `  P2P auto-connect: no peer channels within ${timeout}ms (fine if this session has no peers)`
  );
}
