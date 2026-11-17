/**
 * P2P Registration - peer discovery and registration operations
 */

import type { Page } from 'playwright';
import { sleep } from '../utils.js';
import { waitForWorkspaceLoaded, closeAnyModals } from '../modals.js';
import { takeScreenshot } from '../screenshots.js';
import { UxIssueTracker } from '../ux-tracker.js';
import { isHiddenWithin, isVisibleWithin } from '../utils.js';

/**
 * Options for p2pRegister function
 */
export interface P2PRegisterOptions {
  uxTracker?: UxIssueTracker | null;
  /**
   * If true, leaves the modal open after clicking Connect.
   * Used for testing that the "Connected" badge appears after peer accepts.
   * Default: false (closes modal after sending request)
   */
  keepModalOpen?: boolean;
}

/**
 * Register a P2P connection with a peer
 */
export async function p2pRegister(
  page: Page,
  myUsername: string,
  peerUsername: string,
  uxTrackerOrOptions: UxIssueTracker | P2PRegisterOptions | null = null
): Promise<boolean> {
  // Handle both old (uxTracker) and new (options) signature for backwards compatibility
  const options: P2PRegisterOptions = uxTrackerOrOptions instanceof UxIssueTracker || uxTrackerOrOptions === null
    ? { uxTracker: uxTrackerOrOptions, keepModalOpen: false }
    : uxTrackerOrOptions;
  const uxTracker = options.uxTracker ?? null;
  const keepModalOpen = options.keepModalOpen ?? false;
  console.log(`\n=== P2P Register: ${myUsername} -> ${peerUsername} ===`);

  const loaded = await waitForWorkspaceLoaded(page, 45000);
  if (!loaded) {
    if (uxTracker) {
      uxTracker.log('critical', 'functional', 'Workspace failed to load for P2P registration');
    }
    await takeScreenshot(page, `${myUsername}_workspace_not_loaded`);
    return false;
  }

  // Wait longer for session to be fully established in Citadel SDK
  console.log('  Waiting for session to be fully established...');
  await sleep(5000);

  // Try to open Peer Discovery modal
  // The modal appearing IS the signal each of these is waiting for, so each
  // method waits for it rather than sleeping and assuming.
  //
  // This also makes the fallbacks reachable. `modalOpened` used to be set to
  // true immediately after Method 1's click, without checking anything, so
  // Methods 2 and 3 could never run — the chain looked like a retry strategy but
  // only ever had one attempt. Three fixed 2s waits are gone with it.
  const modalTitle = page.locator('text="Peer Discovery"');
  let modalOpened = false;

  // Method 1: click the UserPlus button directly.
  const userPlusBtn = page.locator('button:has(svg.lucide-user-plus), button[title="Discover Peers"]').first();
  if (await isVisibleWithin(userPlusBtn, 3000)) {
    console.log('  Found Discover Peers button, clicking...');
    await userPlusBtn.click();
    modalOpened = await isVisibleWithin(modalTitle, 8000);
  }

  // Method 2: the button may only be revealed on hover over the members header.
  //
  // That header used to read "WORKSPACE MEMBERS" and this hovered it by name.
  // The members list was deliberately given one noun and now reads "Members" or
  // "<Entity> Members", so the hover target was never found and this whole
  // method has been dead. Hover the header's actions instead, which is where
  // the button lives regardless of what the heading says.
  if (!modalOpened) {
    const membersSection = page.getByTestId('members-header-actions').first();
    if (await isVisibleWithin(membersSection, 2000)) {
      console.log('  Hovering over the members header...');
      await membersSection.hover();

      const discoverBtn = page.locator('button[title="Discover Peers"], button:has(svg.lucide-user-plus)').first();
      if (await isVisibleWithin(discoverBtn, 3000)) {
        await discoverBtn.click();
        modalOpened = await isVisibleWithin(modalTitle, 8000);
      }
    }
  }

  // Method 3: force past whatever is overlapping it.
  if (!modalOpened) {
    console.log('  Attempting force click on Discover Peers...');
    await page.locator('button[title="Discover Peers"]').click({ force: true, timeout: 5000 }).catch(() => {});
    modalOpened = await isVisibleWithin(modalTitle, 8000);
  }

  await takeScreenshot(page, `${myUsername}_peer_discovery`);

  if (!modalOpened) {
    const altModal = page.locator('[role="dialog"]:has-text("Peer"), [role="dialog"]:has-text("Discovery")');
    if (!await isVisibleWithin(altModal, 2000)) {
      if (uxTracker) {
        uxTracker.log('critical', 'functional', 'Peer Discovery modal did not open');
      }
      await takeScreenshot(page, `${myUsername}_modal_not_opened`);
      return false;
    }
  }

  console.log('  Peer Discovery modal opened');

  // Retry mechanism for peer discovery (API can timeout initially)
  const MAX_RETRIES = 3;
  let peerFound = false;

  for (let retry = 0; retry < MAX_RETRIES && !peerFound; retry++) {
    if (retry > 0) {
      console.log(`  Retry ${retry}/${MAX_RETRIES - 1}: Refreshing peer list...`);
      const refreshBtn = page.locator('[role="dialog"] button:has(svg.lucide-refresh-cw)');
      if (await isVisibleWithin(refreshBtn, 2000)) {
        await refreshBtn.click();
        await sleep(1000);
      }
    }

    // Wait for loading to complete
    console.log('  Waiting for peer list to load...');
    for (let i = 0; i < 15; i++) {
      const loadingSpinner = page.locator('[role="dialog"] svg.lucide-loader-2.animate-spin, [role="dialog"] .animate-spin');
      const isLoading = await isVisibleWithin(loadingSpinner, 500);

      if (!isLoading) {
        console.log('  Peer list loaded');
        break;
      }

      if (i === 14) {
        console.log('  WARNING: Peer list loading timed out (will retry)');
      }
      await sleep(1000);
    }

    await sleep(1000);

    // Find Connect button for the peer
    const dialog = page.locator('[role="dialog"]');
    const connectButtons = dialog.locator('button:has-text("Connect")');
    const connectCount = await connectButtons.count();
    console.log(`  Found ${connectCount} Connect buttons in dialog`);

    for (let i = 0; i < connectCount && !peerFound; i++) {
      const connectBtn = connectButtons.nth(i);
      const parent = connectBtn.locator('..').locator('..');
      const parentText = await parent.textContent().catch(() => '');
      console.log(`  Button ${i} parent text: "${(parentText ?? '').substring(0, 50)}..."`);

      if ((parentText ?? '').toLowerCase().includes(peerUsername.toLowerCase())) {
        peerFound = true;
        console.log(`  Found peer ${peerUsername}, clicking Connect...`);
        await connectBtn.click();
        await sleep(3000);
        console.log(`  P2P registration request sent`);
        break;
      }
    }

    // Method 2: Look for peer username text
    if (!peerFound) {
      const peerText = dialog.locator(`text="${peerUsername}"`).first();
      if (await isVisibleWithin(peerText, 2000)) {
        console.log(`  Found peer text, looking for Connect button nearby...`);
        const container = peerText.locator('xpath=ancestor::div[.//button[contains(text(), "Connect")]]').first();
        // By testid: the button said "Connect" when this was written, and this file
    // is the one every P2P spec goes through.
    const connectBtn = container.getByTestId('peer-connect');
        if (await isVisibleWithin(connectBtn, 2000)) {
          peerFound = true;
          console.log(`  Found peer ${peerUsername}, clicking Connect...`);
          await connectBtn.click();
          await sleep(3000);
          console.log(`  P2P registration request sent`);
        }
      }
    }

    if (!peerFound && retry < MAX_RETRIES - 1) {
      const visiblePeers = await page.locator('[role="dialog"] div.rounded-lg p.font-medium').allTextContents().catch(() => []);
      console.log(`  Peer not found yet. Available: ${visiblePeers.join(', ') || 'none'}. Retrying...`);
    }
  }

  console.log(`  DEBUG: After retry loop, peerFound = ${peerFound}`);

  if (!peerFound) {
    const visiblePeers = await page.locator('[role="dialog"] div.rounded-lg p.font-medium').allTextContents().catch(() => []);
    console.log(`  Available peers: ${visiblePeers.join(', ') || 'none'}`);
    if (uxTracker) {
      uxTracker.log('major', 'functional', `Peer ${peerUsername} not found after ${MAX_RETRIES} retries. Available: ${visiblePeers.join(', ')}`);
    }
    await takeScreenshot(page, `${myUsername}_peer_not_found`);
  } else {
    console.log(`  SUCCESS: Peer ${peerUsername} found and Connect clicked`);
  }

  // Conditionally close modal based on keepModalOpen option
  if (!keepModalOpen) {
    await page.keyboard.press('Escape');
    // The modal being gone is the signal; sleeping 500ms and hoping left the
    // next step racing a dialog that was still animating out and swallowing its
    // clicks.
    await isHiddenWithin(page.locator('[role="dialog"]'), 5000);
  } else {
    console.log(`  Keeping modal open for badge verification`);
  }
  return peerFound;
}

/**
 * Verify that a peer shows "Connected" badge in the Peer Discovery modal.
 * This verifies that after Bob accepts Alice's registration request,
 * Alice's modal immediately shows "Connected" (which means "Registered" in P2P terminology -
 * the peer relationship is now established for direct messaging).
 *
 * The modal must already be open (use p2pRegister with keepModalOpen: true).
 *
 * @param page - Playwright page with Peer Discovery modal open
 * @param myUsername - This user's username (for logging and screenshots)
 * @param peerUsername - The peer's username to check for "Connected" badge
 * @param timeoutMs - Maximum time to wait for the badge to appear (default 15s)
 * @param uxTracker - Optional UX issue tracker
 * @returns true if "Connected" badge found for the peer
 */
export async function verifyConnectedBadgeInModal(
  page: Page,
  myUsername: string,
  peerUsername: string,
  timeoutMs: number = 15000,
  uxTracker: UxIssueTracker | null = null
): Promise<boolean> {
  console.log(`\n=== ${myUsername}: Verifying "Connected" badge for ${peerUsername} ===`);

  const startTime = Date.now();
  const pollInterval = 500;

  // The modal should already be open - verify it
  const modal = page.locator('[role="dialog"]:has-text("Peer Discovery")');
  if (!await isVisibleWithin(modal, 2000)) {
    console.log('  ERROR: Peer Discovery modal is not open');
    if (uxTracker) {
      uxTracker.log('critical', 'functional', 'Peer Discovery modal not open for badge verification');
    }
    return false;
  }

  // Look for the peer's row and check for "Connected" badge with checkmark icon
  // The badge HTML structure: <Badge><UserCheck icon/>Connected</Badge>
  // The Badge has class bg-blue-500/20 and text "Connected"
  while (Date.now() - startTime < timeoutMs) {
    // Find the peer's row in the modal
    const peerRow = modal.locator(`div.rounded-lg:has(p.font-medium:text-is("${peerUsername}"))`).first();

    if (await isVisibleWithin(peerRow, 500)) {
      // The registered badge, by test id: it reads "Contact" (it was "Connected",
      // which claimed a connection for peers who were offline).
      const connectedBadge = peerRow.getByTestId('peer-contact-badge');

      if (await isVisibleWithin(connectedBadge, 100)) {
        console.log(`  SUCCESS: Found "Connected" badge for ${peerUsername}`);
        await takeScreenshot(page, `${myUsername}_connected_badge_verified`);
        return true;
      }

      // Also check for "Awaiting Response..." button (means badge hasn't updated yet)
      const awaitingBtn = peerRow.locator('button:has-text("Awaiting Response")');
      if (await isVisibleWithin(awaitingBtn, 100)) {
        console.log(`  Still showing "Awaiting Response..." (waiting for PeerRegisterSuccess event)`);
      }
    }

    await sleep(pollInterval);
  }

  console.log(`  FAIL: "Connected" badge for ${peerUsername} not found after ${timeoutMs}ms`);
  await takeScreenshot(page, `${myUsername}_connected_badge_not_found`);

  if (uxTracker) {
    uxTracker.log('critical', 'functional', `"Connected" badge for ${peerUsername} not shown after peer accepted request`);
  }

  return false;
}

/**
 * Close the Peer Discovery modal (helper for after verifyConnectedBadgeInModal)
 */
export async function closePeerDiscoveryModal(page: Page): Promise<void> {
  console.log('  Closing Peer Discovery modal');
  await page.keyboard.press('Escape');
  await isHiddenWithin(page.locator('[role="dialog"]'), 5000);
}

/**
 * Accept a pending P2P request -- or confirm there was none to accept because the client took it
 * unasked.
 *
 * Under the workspace's messaging trust policy (AllTrusted by default) a colleague's request is
 * accepted automatically and no pending card ever appears; waiting for the badge then failed a
 * registration that had succeeded. With `requesterUsername` the requester showing up as a contact
 * row counts as accepted. Without it only the badge does, which is what a Strict workspace shows.
 */
export async function acceptP2PRequest(
  page: Page,
  username: string,
  uxTracker: UxIssueTracker | null = null,
  requesterUsername: string | null = null,
): Promise<boolean> {
  console.log(`\n=== ${username}: Checking for P2P requests ===`);

  // Logged rather than thrown: these helpers report failure through their
  // return value and the caller decides. Silently discarding it is what made
  // the group-call stall unreadable — the log ended at 'Waiting for workspace
  // to fully load...' and never said whether it arrived.
  if (!(await waitForWorkspaceLoaded(page, 30000))) {
    console.log(`  WARNING: ${username}'s workspace never finished loading; continuing anyway`);
  }
  // No fixed wait here: the badge poll below already retries for as long as it
  // takes, so a 3s sleep only delayed the first look.

  // Look for pending request badge using specific selector
  // The badge is in the sidebar with data-testid="pending-requests-badge"
  // We MUST find and click this specific badge to open the Pending Requests modal
  const badgeSelector = '[data-testid="pending-requests-badge"]';
  console.log(`  Looking for badge with selector: ${badgeSelector}`);

  // Wait longer for the badge to appear - P2P registration notification may take time
  const MAX_WAIT_ATTEMPTS = 20;
  for (let i = 0; i < MAX_WAIT_ATTEMPTS; i++) {
    if (requesterUsername !== null && (await page.getByTestId(`peer-row-${requesterUsername}`).count()) > 0) {
      console.log(`  ✓ ${requesterUsername} is already a contact: accepted automatically under the workspace's messaging trust`);
      return true;
    }
    const badge = page.locator(badgeSelector).first();
    const isVisible = await isVisibleWithin(badge, 1000);

    if (isVisible) {
      console.log(`  ✓ Found pending request badge (attempt ${i + 1})`);
      await takeScreenshot(page, `${username}_found_badge`);

      // Click the badge to open the Pending Requests modal
      console.log(`  Clicking badge to open modal...`);
      await badge.click();
      await sleep(2000);

      await takeScreenshot(page, `${username}_pending_requests_modal`);

      // Wait for modal to open - look for the "Pending Connection Requests" title
      const modalTitle = page.locator('text="Pending Connection Requests"');
      if (await isVisibleWithin(modalTitle, 3000)) {
        console.log(`  ✓ Modal opened successfully`);

        // Find and click the Accept button
        const acceptBtn = page.getByTestId('peer-accept').first();
        if (await isVisibleWithin(acceptBtn, 5000)) {
          console.log(`  ✓ Found Accept button, clicking...`);
          await acceptBtn.click();
          await sleep(3000);
          console.log(`  ✓ P2P request accepted!`);

          await takeScreenshot(page, `${username}_after_accept`);
          await page.keyboard.press('Escape');
          await sleep(500);
          return true;
        } else {
          // Say WHICH thing is missing. "Accept button not found in modal"
          // read as "the request never arrived" for as long as the modal's
          // button simply had no testid, and sent four reconnection legs
          // looking at the P2P layer for a defect that was in the markup.
          const rowCount: number = await page.getByTestId('peer-accept').count();
          console.log(
            `  ✗ No [data-testid="peer-accept"] inside the open modal ` +
              `(${rowCount} on the page). The modal is up; either it lists no ` +
              `requests, or its accept control is not addressable.`,
          );
          await takeScreenshot(page, `${username}_no_accept_button`);
          if (uxTracker) {
            uxTracker.log('major', 'functional', 'Accept button not found in pending requests modal');
          }
        }
      } else {
        console.log(`  ✗ Modal did not open after clicking badge`);
        await takeScreenshot(page, `${username}_modal_not_opened`);
      }

      // Close any open modals and continue
      await page.keyboard.press('Escape');
      await sleep(500);
    }

    console.log(`  Waiting for pending request badge... (${i + 1}/${MAX_WAIT_ATTEMPTS})`);
    await sleep(2000);
  }

  console.log(`  ✗ No pending P2P request badge found after ${MAX_WAIT_ATTEMPTS} attempts`);
  await takeScreenshot(page, `${username}_no_badge_found`);
  await closeAnyModals(page);
  return false;
}
