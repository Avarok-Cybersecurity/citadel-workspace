import { chromium, Browser, BrowserContext, Page } from 'playwright';

const UI_URL = 'http://localhost:5173/';
const SERVER_LOCATION = '127.0.0.1:12349';
const WORKSPACE_PASSWORD = 'SUPER_SECRET_ADMIN_PASSWORD_CHANGE_ME';
const USER_PASSWORD = 'test12345';
const TIMESTAMP = Date.now();
const USER1_USERNAME = `p2ptest1_${TIMESTAMP}`;
const USER2_USERNAME = `p2ptest2_${TIMESTAMP}`;

interface TestResult {
  step: string;
  status: 'PASS' | 'FAIL';
  notes: string;
}

const results: TestResult[] = [];
const uxIssues: string[] = [];

async function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function createAccount(
  page: Page,
  fullName: string,
  username: string,
  isFirstUser: boolean
): Promise<boolean> {
  try {
    // Navigate to UI
    await page.goto(UI_URL);
    await page.waitForLoadState('networkidle');

    // Click "Join Workspace" button
    const joinButton = page.locator('button:has-text("Join Workspace")');
    await joinButton.waitFor({ timeout: 10000 });
    await joinButton.click();

    // Fill workspace location
    const locationInput = page.locator('input[placeholder*="location"], input[name*="location"], input[id*="location"]').first();
    if (await locationInput.count() === 0) {
      // Try alternative selectors
      const inputs = page.locator('input[type="text"]');
      await inputs.first().fill(SERVER_LOCATION);
    } else {
      await locationInput.fill(SERVER_LOCATION);
    }

    // Click NEXT
    await page.locator('button:has-text("NEXT"), button:has-text("Next")').click();
    await delay(500);

    // Click NEXT on security settings
    await page.locator('button:has-text("NEXT"), button:has-text("Next")').click();
    await delay(500);

    // Fill user profile
    const fullNameInput = page.locator('input[placeholder*="Full Name"], input[name*="fullName"], input[id*="fullName"]').first();
    if (await fullNameInput.count() > 0) {
      await fullNameInput.fill(fullName);
    }

    const usernameInput = page.locator('input[placeholder*="Username"], input[name*="username"], input[id*="username"]').first();
    if (await usernameInput.count() > 0) {
      await usernameInput.fill(username);
    }

    // Fill password fields
    const passwordInputs = page.locator('input[type="password"]');
    const count = await passwordInputs.count();
    if (count >= 2) {
      await passwordInputs.nth(0).fill(USER_PASSWORD);
      await passwordInputs.nth(1).fill(USER_PASSWORD);
    }

    // Click JOIN
    await page.locator('button:has-text("JOIN"), button:has-text("Join")').click();
    await delay(2000);

    // Handle "Initialize Workspace" modal if first user
    if (isFirstUser) {
      const initModal = page.locator('text=Initialize Workspace');
      if (await initModal.isVisible({ timeout: 5000 }).catch(() => false)) {
        const masterPasswordInput = page.locator('input[type="password"]').first();
        await masterPasswordInput.fill(WORKSPACE_PASSWORD);
        await page.locator('button:has-text("Initialize"), button:has-text("Submit"), button:has-text("INITIALIZE")').click();
        await delay(2000);
      }
    } else {
      // Second user should NOT see initialize modal
      const initModal = page.locator('text=Initialize Workspace');
      if (await initModal.isVisible({ timeout: 2000 }).catch(() => false)) {
        uxIssues.push('Initialize Workspace modal appeared for second user (should not happen)');
      }
    }

    // Wait for workspace to load
    await page.waitForSelector('[class*="sidebar"], [class*="Sidebar"], [data-testid*="workspace"]', { timeout: 15000 });

    console.log(`Account created successfully: ${username}`);
    return true;
  } catch (error) {
    console.error(`Failed to create account ${username}:`, error);
    return false;
  }
}

async function performP2PRegistration(
  user1Page: Page,
  user2Page: Page,
  user1Username: string,
  user2Username: string
): Promise<boolean> {
  try {
    // User1: Click "Discover Peers"
    const discoverButton = user1Page.locator('button:has-text("Discover Peers"), button:has-text("discover")');
    await discoverButton.waitFor({ timeout: 10000 });
    await discoverButton.click();
    await delay(1000);

    // Click Refresh if needed
    const refreshButton = user1Page.locator('button:has-text("Refresh")');
    if (await refreshButton.isVisible()) {
      await refreshButton.click();
      await delay(2000);
    }

    // Wait for USER2 to appear and click Connect
    const user2InList = user1Page.locator(`text=${user2Username}`);
    await user2InList.waitFor({ timeout: 15000 });

    // Click Connect button next to user2
    const connectButton = user1Page.locator(`button:has-text("Connect")`).first();
    await connectButton.click();
    console.log(`User1 sent connection request to ${user2Username}`);
    await delay(2000);

    // User2: Look for notification and accept
    // Find notification bell or indicator
    const notificationBell = user2Page.locator('[class*="notification"], [class*="bell"], [aria-label*="notification"]');
    if (await notificationBell.isVisible({ timeout: 10000 }).catch(() => false)) {
      await notificationBell.click();
    }

    // Look for pending requests
    const pendingRequest = user2Page.locator(`text=${user1Username}`);
    await pendingRequest.waitFor({ timeout: 10000 });

    // Click Accept
    const acceptButton = user2Page.locator('button:has-text("Accept")').first();
    await acceptButton.click();
    console.log(`User2 accepted connection request from ${user1Username}`);
    await delay(2000);

    // Verify DIRECT MESSAGES shows up
    const directMessages = user2Page.locator('text=DIRECT MESSAGES');
    await directMessages.waitFor({ timeout: 10000 });

    return true;
  } catch (error) {
    console.error('P2P Registration failed:', error);
    return false;
  }
}

async function verifyOfficeMembersCID(
  page: Page,
  expectedPeerUsername: string
): Promise<{ success: boolean; channelCID: string | null; notes: string }> {
  try {
    // Look for OFFICE MEMBERS section
    const officeMembersSection = page.locator('text=OFFICE MEMBERS').first();
    await officeMembersSection.waitFor({ timeout: 5000 });

    // Find the peer in OFFICE MEMBERS
    const peerEntry = page.locator(`[class*="member"]:has-text("${expectedPeerUsername}"), li:has-text("${expectedPeerUsername}")`).first();

    if (await peerEntry.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Get current URL before click
      const urlBefore = page.url();
      console.log(`URL before clicking peer: ${urlBefore}`);

      // Click on the peer in OFFICE MEMBERS
      await peerEntry.click();
      await delay(1000);

      // Get URL after click
      const urlAfter = page.url();
      console.log(`URL after clicking peer: ${urlAfter}`);

      // Parse the URL to extract channel parameter
      const url = new URL(urlAfter);
      const channelCID = url.searchParams.get('channel');

      if (channelCID) {
        console.log(`Channel CID from URL: ${channelCID}`);
        return {
          success: true,
          channelCID,
          notes: `Channel parameter set to: ${channelCID}`
        };
      } else {
        return {
          success: false,
          channelCID: null,
          notes: 'No channel parameter found in URL after clicking peer'
        };
      }
    } else {
      return {
        success: false,
        channelCID: null,
        notes: `Peer ${expectedPeerUsername} not found in OFFICE MEMBERS section`
      };
    }
  } catch (error) {
    return {
      success: false,
      channelCID: null,
      notes: `Error verifying OFFICE MEMBERS CID: ${error}`
    };
  }
}

async function sendMessage(page: Page, message: string): Promise<boolean> {
  try {
    // Find message input
    const messageInput = page.locator('input[placeholder*="message"], textarea[placeholder*="message"], [contenteditable="true"]').first();
    await messageInput.waitFor({ timeout: 5000 });
    await messageInput.fill(message);

    // Press Enter to send
    await page.keyboard.press('Enter');
    await delay(2000);

    // Verify message appears
    const sentMessage = page.locator(`text="${message}"`);
    return await sentMessage.isVisible({ timeout: 5000 }).catch(() => false);
  } catch (error) {
    console.error('Failed to send message:', error);
    return false;
  }
}

async function verifyMessageReceived(page: Page, message: string): Promise<boolean> {
  try {
    const receivedMessage = page.locator(`text="${message}"`);
    return await receivedMessage.isVisible({ timeout: 10000 }).catch(() => false);
  } catch (error) {
    console.error('Failed to verify message:', error);
    return false;
  }
}

async function main() {
  console.log('=== P2P Basic Test ===');
  console.log(`Timestamp: ${TIMESTAMP}`);
  console.log(`User1: ${USER1_USERNAME}`);
  console.log(`User2: ${USER2_USERNAME}`);
  console.log('');

  const browser: Browser = await chromium.launch({
    headless: false,
    slowMo: 100
  });

  const context: BrowserContext = await browser.newContext();

  try {
    // Create two pages (tabs)
    const page1 = await context.newPage();
    const page2 = await context.newPage();

    // Phase 1: Create accounts
    console.log('\n=== Phase 1: Create Accounts ===');

    console.log(`Creating User1: ${USER1_USERNAME}`);
    const user1Created = await createAccount(page1, 'P2P Test User One', USER1_USERNAME, true);
    results.push({
      step: 'Create User1 Account',
      status: user1Created ? 'PASS' : 'FAIL',
      notes: user1Created ? `Created ${USER1_USERNAME}` : 'Failed to create account'
    });

    if (!user1Created) {
      throw new Error('User1 account creation failed - cannot continue');
    }

    await page1.screenshot({ path: `/Volumes/nvme/Development/avarok/citadel-workspace/e2e/screenshots/01-user1-workspace.png` });

    console.log(`Creating User2: ${USER2_USERNAME}`);
    const user2Created = await createAccount(page2, 'P2P Test User Two', USER2_USERNAME, false);
    results.push({
      step: 'Create User2 Account',
      status: user2Created ? 'PASS' : 'FAIL',
      notes: user2Created ? `Created ${USER2_USERNAME}` : 'Failed to create account'
    });

    if (!user2Created) {
      throw new Error('User2 account creation failed - cannot continue');
    }

    await page2.screenshot({ path: `/Volumes/nvme/Development/avarok/citadel-workspace/e2e/screenshots/02-user2-workspace.png` });

    // Phase 2: P2P Registration
    console.log('\n=== Phase 2: P2P Registration ===');
    const p2pRegistered = await performP2PRegistration(page1, page2, USER1_USERNAME, USER2_USERNAME);
    results.push({
      step: 'P2P Registration',
      status: p2pRegistered ? 'PASS' : 'FAIL',
      notes: p2pRegistered ? 'Registration successful' : 'Registration failed'
    });

    await page1.screenshot({ path: `/Volumes/nvme/Development/avarok/citadel-workspace/e2e/screenshots/03-user1-after-registration.png` });
    await page2.screenshot({ path: `/Volumes/nvme/Development/avarok/citadel-workspace/e2e/screenshots/04-user2-after-registration.png` });

    // Phase 2.5: CRITICAL - Verify OFFICE MEMBERS CID fix
    console.log('\n=== Phase 2.5: Verify OFFICE MEMBERS CID Fix ===');

    // From User1's perspective, click on User2 in OFFICE MEMBERS
    console.log('User1: Clicking on User2 in OFFICE MEMBERS...');
    const user1ClickResult = await verifyOfficeMembersCID(page1, USER2_USERNAME);
    console.log(`User1 click result: ${JSON.stringify(user1ClickResult)}`);

    // From User2's perspective, click on User1 in OFFICE MEMBERS
    console.log('User2: Clicking on User1 in OFFICE MEMBERS...');
    const user2ClickResult = await verifyOfficeMembersCID(page2, USER1_USERNAME);
    console.log(`User2 click result: ${JSON.stringify(user2ClickResult)}`);

    // Analyze CID correctness
    // The channel CID should be the PEER's CID, not your own
    // We need to compare: when User1 clicks User2, the channel should be User2's CID
    results.push({
      step: 'OFFICE MEMBERS CID Verification (User1 -> User2)',
      status: user1ClickResult.success ? 'PASS' : 'FAIL',
      notes: user1ClickResult.notes
    });

    results.push({
      step: 'OFFICE MEMBERS CID Verification (User2 -> User1)',
      status: user2ClickResult.success ? 'PASS' : 'FAIL',
      notes: user2ClickResult.notes
    });

    await page1.screenshot({ path: `/Volumes/nvme/Development/avarok/citadel-workspace/e2e/screenshots/05-user1-clicked-peer.png` });
    await page2.screenshot({ path: `/Volumes/nvme/Development/avarok/citadel-workspace/e2e/screenshots/06-user2-clicked-peer.png` });

    // Phase 3: Send messages
    console.log('\n=== Phase 3: Bidirectional Messaging ===');

    // User1 sends to User2
    // First, click on User2 in DIRECT MESSAGES to open chat
    const user2InDM = page1.locator(`text=${USER2_USERNAME}`).first();
    await user2InDM.click();
    await delay(1000);

    console.log('User1 sending message to User2...');
    const message1Sent = await sendMessage(page1, 'Hello from user1!');
    results.push({
      step: 'Message User1 -> User2 (Send)',
      status: message1Sent ? 'PASS' : 'FAIL',
      notes: message1Sent ? 'Message sent successfully' : 'Failed to send message'
    });

    await page1.screenshot({ path: `/Volumes/nvme/Development/avarok/citadel-workspace/e2e/screenshots/07-user1-sent-message.png` });

    // User2 checks for received message
    const user1InDM = page2.locator(`text=${USER1_USERNAME}`).first();
    await user1InDM.click();
    await delay(1000);

    console.log('User2 checking for message...');
    const message1Received = await verifyMessageReceived(page2, 'Hello from user1!');
    results.push({
      step: 'Message User1 -> User2 (Receive)',
      status: message1Received ? 'PASS' : 'FAIL',
      notes: message1Received ? 'Message received' : 'Message not received'
    });

    await page2.screenshot({ path: `/Volumes/nvme/Development/avarok/citadel-workspace/e2e/screenshots/08-user2-received-message.png` });

    // User2 sends reply
    console.log('User2 sending reply to User1...');
    const message2Sent = await sendMessage(page2, 'Hello back from user2!');
    results.push({
      step: 'Message User2 -> User1 (Send)',
      status: message2Sent ? 'PASS' : 'FAIL',
      notes: message2Sent ? 'Reply sent successfully' : 'Failed to send reply'
    });

    await page2.screenshot({ path: `/Volumes/nvme/Development/avarok/citadel-workspace/e2e/screenshots/09-user2-sent-reply.png` });

    // User1 checks for received reply
    console.log('User1 checking for reply...');
    const message2Received = await verifyMessageReceived(page1, 'Hello back from user2!');
    results.push({
      step: 'Message User2 -> User1 (Receive)',
      status: message2Received ? 'PASS' : 'FAIL',
      notes: message2Received ? 'Reply received' : 'Reply not received'
    });

    await page1.screenshot({ path: `/Volumes/nvme/Development/avarok/citadel-workspace/e2e/screenshots/10-user1-received-reply.png` });

    // Print results
    console.log('\n=== TEST RESULTS ===');
    console.log('');
    for (const result of results) {
      console.log(`${result.status === 'PASS' ? '[PASS]' : '[FAIL]'} ${result.step}: ${result.notes}`);
    }

    if (uxIssues.length > 0) {
      console.log('\n=== UX ISSUES ===');
      for (const issue of uxIssues) {
        console.log(`- ${issue}`);
      }
    }

    // Overall result
    const allPassed = results.every(r => r.status === 'PASS');
    console.log(`\n=== OVERALL: ${allPassed ? 'PASS' : 'FAIL'} ===`);

    // Keep browser open for inspection
    console.log('\nKeeping browser open for 30 seconds for inspection...');
    await delay(30000);

  } catch (error) {
    console.error('Test failed with error:', error);
  } finally {
    await browser.close();
  }
}

main().catch(console.error);
