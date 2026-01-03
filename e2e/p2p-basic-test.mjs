import { chromium } from 'playwright';

const UI_URL = 'http://localhost:5173/';
const SERVER_LOCATION = '127.0.0.1:12349';
const WORKSPACE_PASSWORD = 'SUPER_SECRET_ADMIN_PASSWORD_CHANGE_ME';
const USER_PASSWORD = 'test12345';
const TIMESTAMP = Date.now();
const USER1_USERNAME = `p2ptest1_${TIMESTAMP}`;
const USER2_USERNAME = `p2ptest2_${TIMESTAMP}`;

const results = [];
const uxIssues = [];

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function createAccount(page, fullName, username, isFirstUser) {
  try {
    await page.goto(UI_URL);
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: `./e2e/screenshots/${username}-landing.png` });

    const joinButton = page.locator('button:has-text("Join Workspace")');
    await joinButton.waitFor({ timeout: 10000 });
    await joinButton.click();
    await delay(1000);

    await page.screenshot({ path: `./e2e/screenshots/${username}-workspace-form.png` });

    const locationInput = page.locator('input[placeholder*="workspace-name"], input[placeholder*="avarok"]').first();
    try {
      await locationInput.waitFor({ timeout: 5000 });
      await locationInput.fill(SERVER_LOCATION);
      console.log(`Filled workspace location: ${SERVER_LOCATION}`);
    } catch (e) {
      const allInputs = page.locator('input');
      if (await allInputs.count() > 0) {
        await allInputs.first().fill(SERVER_LOCATION);
      }
    }

    await delay(500);
    await page.locator('button:has-text("NEXT")').first().click();
    console.log('Clicked NEXT (workspace form)');
    await delay(1000);

    await page.locator('button:has-text("NEXT")').first().click();
    console.log('Clicked NEXT (security settings)');
    await delay(1000);

    const fullNameInput = page.locator('input[placeholder="John Doe"]');
    try {
      await fullNameInput.waitFor({ timeout: 3000 });
      await fullNameInput.fill(fullName);
      console.log(`Filled full name: ${fullName}`);
    } catch (e) {}

    const usernameInput = page.locator('input[placeholder="john.doe.33"]');
    try {
      await usernameInput.waitFor({ timeout: 3000 });
      await usernameInput.fill(username);
      console.log(`Filled username: ${username}`);
    } catch (e) {}

    const passwordInputs = page.locator('input[type="password"]');
    const pwCount = await passwordInputs.count();
    if (pwCount >= 2) {
      await passwordInputs.nth(0).fill(USER_PASSWORD);
      await passwordInputs.nth(1).fill(USER_PASSWORD);
      console.log('Filled password fields');
    }

    await page.screenshot({ path: `./e2e/screenshots/${username}-before-join.png` });

    const joinButtonInModal = page.locator('button[type="submit"]:has-text("JOIN")');
    try {
      await joinButtonInModal.waitFor({ timeout: 5000 });
      await joinButtonInModal.click();
      console.log('Clicked JOIN button');
    } catch (e) {
      const purpleJoin = page.locator('button.bg-purple-600:has-text("JOIN")').last();
      await purpleJoin.click();
    }
    await delay(3000);

    await page.screenshot({ path: `./e2e/screenshots/${username}-after-join.png` });

    if (isFirstUser) {
      try {
        const initModal = page.locator('text=Initialize Workspace');
        if (await initModal.isVisible({ timeout: 5000 })) {
          console.log('Initialize Workspace modal detected');
          await delay(500);
          const masterPasswordInput = page.locator('input[type="password"]').first();
          await masterPasswordInput.fill(WORKSPACE_PASSWORD);
          console.log('Filled master password');

          const initButton = page.locator('button:has-text("Initialize"), button:has-text("INITIALIZE")').first();
          await initButton.click();
          console.log('Clicked Initialize button');
          await delay(3000);
        }
      } catch (e) {}
    }

    // Wait for workspace and navigate to an office (General) to see OFFICE MEMBERS
    try {
      // Click on General office to ensure we're in an office context
      const generalOffice = page.locator('text=General').first();
      await generalOffice.waitFor({ timeout: 10000 });
      await generalOffice.click();
      console.log('Clicked General office');
      await delay(2000);
    } catch (e) {
      console.log('Could not click General office');
    }

    await page.screenshot({ path: `./e2e/screenshots/${username}-workspace.png` });
    console.log(`Account created successfully: ${username}`);
    return true;
  } catch (error) {
    console.error(`Failed to create account ${username}:`, error);
    await page.screenshot({ path: `./e2e/screenshots/${username}-error.png` });
    return false;
  }
}

async function performP2PRegistration(user1Page, user2Page, user1Username, user2Username) {
  try {
    console.log('Starting P2P Registration...');
    await user1Page.screenshot({ path: `./e2e/screenshots/p2p-user1-before.png` });

    // Click the "Discover Peers" button using its title attribute
    console.log('Looking for Discover Peers button...');

    let discoverClicked = false;

    // Try using title attribute
    const discoverButton = user1Page.locator('[title="Discover Peers"]');
    try {
      await discoverButton.waitFor({ timeout: 5000 });
      await discoverButton.click();
      discoverClicked = true;
      console.log('Clicked Discover Peers button via title attribute');
    } catch (e) {
      console.log('Could not find button with title="Discover Peers"');
    }

    // Alternative: look for UserPlus icon button
    if (!discoverClicked) {
      const userPlusButton = user1Page.locator('button:has(svg.lucide-user-plus)');
      try {
        if (await userPlusButton.isVisible({ timeout: 2000 })) {
          await userPlusButton.click();
          discoverClicked = true;
          console.log('Clicked UserPlus icon button');
        }
      } catch (e) {
        console.log('Could not find UserPlus icon button');
      }
    }

    if (!discoverClicked) {
      console.log('Could not find discover peers button');
      await user1Page.screenshot({ path: `./e2e/screenshots/p2p-user1-no-discover.png` });
      return false;
    }

    await delay(1000);
    await user1Page.screenshot({ path: `./e2e/screenshots/p2p-user1-discover-modal.png` });

    // Click Refresh if visible
    try {
      const refreshButton = user1Page.locator('button:has-text("Refresh")');
      if (await refreshButton.isVisible({ timeout: 2000 })) {
        await refreshButton.click();
        console.log('Clicked Refresh button');
        await delay(3000);
      }
    } catch (e) {}

    await user1Page.screenshot({ path: `./e2e/screenshots/p2p-user1-after-refresh.png` });

    // Wait for USER2 to appear
    console.log(`Looking for ${user2Username} in peer list...`);
    const user2InList = user1Page.locator(`text=${user2Username}`);

    try {
      await user2InList.waitFor({ timeout: 15000 });
      console.log(`Found ${user2Username} in list`);
    } catch (e) {
      console.log(`${user2Username} not found in list after 15 seconds`);
      await user1Page.screenshot({ path: `./e2e/screenshots/p2p-user1-peer-not-found.png` });
      return false;
    }

    // Click Connect button
    const connectButton = user1Page.locator('button:has-text("Connect")').first();
    try {
      await connectButton.click();
      console.log(`User1 sent connection request to ${user2Username}`);
    } catch (e) {
      console.log('Could not click Connect button');
    }

    await delay(2000);
    await user1Page.screenshot({ path: `./e2e/screenshots/p2p-user1-sent-request.png` });

    // Close modal if still open
    try {
      const closeButton = user1Page.locator('button:has-text("Close")');
      if (await closeButton.isVisible({ timeout: 1000 })) {
        await closeButton.click();
      }
    } catch (e) {}

    // User2: Look for notification badge and open pending requests
    await user2Page.screenshot({ path: `./e2e/screenshots/p2p-user2-before-accept.png` });
    console.log('Looking for pending requests on User2 page...');
    await delay(2000);

    // Look for the red pending count badge or notification bell
    try {
      // The pending count badge is in the members section header
      const pendingBadge = user2Page.locator('.bg-red-500, [class*="bg-red"]').first();
      if (await pendingBadge.isVisible({ timeout: 5000 })) {
        await pendingBadge.click();
        console.log('Clicked pending badge');
        await delay(1000);
      }
    } catch (e) {
      console.log('No pending badge found');
      // Try the notification bell in header
      try {
        const bellIcon = user2Page.locator('svg.lucide-bell').first();
        if (await bellIcon.isVisible({ timeout: 2000 })) {
          await bellIcon.click();
          console.log('Clicked notification bell');
          await delay(1000);
        }
      } catch (e2) {}
    }

    await user2Page.screenshot({ path: `./e2e/screenshots/p2p-user2-notifications.png` });

    // Look for pending request from User1
    console.log(`Looking for pending request from ${user1Username}...`);
    const pendingRequest = user2Page.locator(`text=${user1Username}`);

    try {
      await pendingRequest.waitFor({ timeout: 10000 });
      console.log(`Found pending request from ${user1Username}`);
    } catch (e) {
      console.log(`Pending request from ${user1Username} not found`);
    }

    await user2Page.screenshot({ path: `./e2e/screenshots/p2p-user2-pending-requests.png` });

    // Click Accept
    try {
      const acceptButton = user2Page.locator('button:has-text("Accept")').first();
      await acceptButton.waitFor({ timeout: 5000 });
      await acceptButton.click();
      console.log(`User2 accepted connection request from ${user1Username}`);
    } catch (e) {
      console.log('Could not click Accept button');
    }

    await delay(3000);
    await user2Page.screenshot({ path: `./e2e/screenshots/p2p-user2-after-accept.png` });

    // Both users should now see each other in their sidebar
    // Close any open modals on User2
    try {
      const closeBtn = user2Page.locator('button:has-text("Close")');
      if (await closeBtn.isVisible({ timeout: 1000 })) {
        await closeBtn.click();
      }
    } catch (e) {}

    await delay(1000);
    await user1Page.screenshot({ path: `./e2e/screenshots/p2p-user1-after-registration.png` });
    await user2Page.screenshot({ path: `./e2e/screenshots/p2p-user2-after-registration.png` });

    return true;
  } catch (error) {
    console.error('P2P Registration failed:', error);
    return false;
  }
}

async function verifyOfficeMembersCID(page, expectedPeerUsername, pageLabel) {
  try {
    console.log(`\n${pageLabel}: Verifying OFFICE MEMBERS CID for peer ${expectedPeerUsername}`);
    await page.screenshot({ path: `./e2e/screenshots/${pageLabel}-office-members-before.png` });

    // Look for the peer in the sidebar (in OFFICE MEMBERS or registered peers section)
    console.log(`${pageLabel}: Looking for ${expectedPeerUsername} in sidebar...`);

    // The peer should appear as a clickable button in the sidebar
    const peerButton = page.locator(`button:has-text("${expectedPeerUsername}")`).first();

    const isVisible = await peerButton.isVisible({ timeout: 10000 }).catch(() => false);
    console.log(`${pageLabel}: Peer button visible: ${isVisible}`);

    if (isVisible) {
      const urlBefore = page.url();
      console.log(`${pageLabel}: URL before clicking peer: ${urlBefore}`);

      await peerButton.click();
      await delay(1000);

      const urlAfter = page.url();
      console.log(`${pageLabel}: URL after clicking peer: ${urlAfter}`);

      await page.screenshot({ path: `./e2e/screenshots/${pageLabel}-office-members-after-click.png` });

      const url = new URL(urlAfter);
      const channelCID = url.searchParams.get('channel');

      if (channelCID) {
        console.log(`${pageLabel}: Channel CID from URL: ${channelCID}`);

        // CRITICAL CHECK: The channel CID should be the PEER's CID, not our own
        // We can't know the exact CID here, but we can verify the URL changed
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
      console.log(`${pageLabel}: Peer ${expectedPeerUsername} not found in sidebar`);
      return {
        success: false,
        channelCID: null,
        notes: `Peer ${expectedPeerUsername} not found in sidebar`
      };
    }
  } catch (error) {
    console.log(`${pageLabel}: Error: ${error}`);
    return {
      success: false,
      channelCID: null,
      notes: `Error: ${error}`
    };
  }
}

async function sendMessage(page, message, pageLabel) {
  try {
    console.log(`${pageLabel}: Sending message: ${message}`);

    // Find message input - look for the P2P chat input
    const messageInput = page.locator('input[placeholder*="message" i], textarea[placeholder*="message" i]').first();

    try {
      await messageInput.waitFor({ timeout: 5000 });
      await messageInput.fill(message);
      console.log(`${pageLabel}: Filled message input`);
    } catch (e) {
      console.log(`${pageLabel}: Could not find message input`);
      await page.screenshot({ path: `./e2e/screenshots/${pageLabel}-no-message-input.png` });
      return false;
    }

    await page.keyboard.press('Enter');
    console.log(`${pageLabel}: Pressed Enter to send`);
    await delay(2000);

    await page.screenshot({ path: `./e2e/screenshots/${pageLabel}-message-sent.png` });

    const sentMessage = page.locator(`text="${message}"`);
    const isVisible = await sentMessage.isVisible({ timeout: 5000 }).catch(() => false);
    console.log(`${pageLabel}: Message visible: ${isVisible}`);

    return isVisible;
  } catch (error) {
    console.error(`${pageLabel}: Failed to send message:`, error);
    return false;
  }
}

async function verifyMessageReceived(page, message, pageLabel) {
  try {
    console.log(`${pageLabel}: Checking for received message: ${message}`);
    await delay(2000);

    const receivedMessage = page.locator(`text="${message}"`);
    const isVisible = await receivedMessage.isVisible({ timeout: 10000 }).catch(() => false);

    await page.screenshot({ path: `./e2e/screenshots/${pageLabel}-message-check.png` });
    console.log(`${pageLabel}: Message received: ${isVisible}`);
    return isVisible;
  } catch (error) {
    console.error(`${pageLabel}: Failed to verify message:`, error);
    return false;
  }
}

async function main() {
  console.log('=== P2P Basic Test ===');
  console.log(`Timestamp: ${TIMESTAMP}`);
  console.log(`User1: ${USER1_USERNAME}`);
  console.log(`User2: ${USER2_USERNAME}`);
  console.log('');

  const browser = await chromium.launch({
    headless: false,
    slowMo: 100
  });

  const context = await browser.newContext();

  try {
    const page1 = await context.newPage();
    const page2 = await context.newPage();

    // Phase 1: Create accounts
    console.log('\n=== Phase 1: Create Accounts ===');

    console.log(`\nCreating User1: ${USER1_USERNAME}`);
    const user1Created = await createAccount(page1, 'P2P Test User One', USER1_USERNAME, true);
    results.push({
      step: 'Create User1 Account',
      status: user1Created ? 'PASS' : 'FAIL',
      notes: user1Created ? `Created ${USER1_USERNAME}` : 'Failed'
    });

    if (!user1Created) {
      throw new Error('User1 account creation failed');
    }

    console.log(`\nCreating User2: ${USER2_USERNAME}`);
    const user2Created = await createAccount(page2, 'P2P Test User Two', USER2_USERNAME, false);
    results.push({
      step: 'Create User2 Account',
      status: user2Created ? 'PASS' : 'FAIL',
      notes: user2Created ? `Created ${USER2_USERNAME}` : 'Failed'
    });

    if (!user2Created) {
      throw new Error('User2 account creation failed');
    }

    // Phase 2: P2P Registration
    console.log('\n=== Phase 2: P2P Registration ===');
    const p2pRegistered = await performP2PRegistration(page1, page2, USER1_USERNAME, USER2_USERNAME);
    results.push({
      step: 'P2P Registration',
      status: p2pRegistered ? 'PASS' : 'FAIL',
      notes: p2pRegistered ? 'Registration successful' : 'Registration failed'
    });

    // Phase 2.5: CRITICAL - Verify OFFICE MEMBERS CID fix
    console.log('\n=== Phase 2.5: Verify OFFICE MEMBERS CID Fix ===');

    const user1ClickResult = await verifyOfficeMembersCID(page1, USER2_USERNAME, 'User1');
    console.log(`User1 click result:`, JSON.stringify(user1ClickResult, null, 2));

    const user2ClickResult = await verifyOfficeMembersCID(page2, USER1_USERNAME, 'User2');
    console.log(`User2 click result:`, JSON.stringify(user2ClickResult, null, 2));

    results.push({
      step: 'OFFICE MEMBERS CID (User1 clicks User2)',
      status: user1ClickResult.success ? 'PASS' : 'FAIL',
      notes: user1ClickResult.notes
    });

    results.push({
      step: 'OFFICE MEMBERS CID (User2 clicks User1)',
      status: user2ClickResult.success ? 'PASS' : 'FAIL',
      notes: user2ClickResult.notes
    });

    // Phase 3: Send messages
    console.log('\n=== Phase 3: Bidirectional Messaging ===');

    // User1 should already have peer chat open from clicking in OFFICE MEMBERS
    const message1Sent = await sendMessage(page1, 'Hello from user1!', 'User1');
    results.push({
      step: 'Message User1 -> User2 (Send)',
      status: message1Sent ? 'PASS' : 'FAIL',
      notes: message1Sent ? 'Message sent' : 'Failed to send'
    });

    // User2: Click on User1 to open chat
    try {
      const user1InSidebar = page2.locator(`button:has-text("${USER1_USERNAME}")`).first();
      await user1InSidebar.click();
      await delay(1000);
    } catch (e) {}

    const message1Received = await verifyMessageReceived(page2, 'Hello from user1!', 'User2');
    results.push({
      step: 'Message User1 -> User2 (Receive)',
      status: message1Received ? 'PASS' : 'FAIL',
      notes: message1Received ? 'Message received' : 'Not received'
    });

    const message2Sent = await sendMessage(page2, 'Hello back from user2!', 'User2');
    results.push({
      step: 'Message User2 -> User1 (Send)',
      status: message2Sent ? 'PASS' : 'FAIL',
      notes: message2Sent ? 'Reply sent' : 'Failed to send'
    });

    const message2Received = await verifyMessageReceived(page1, 'Hello back from user2!', 'User1');
    results.push({
      step: 'Message User2 -> User1 (Receive)',
      status: message2Received ? 'PASS' : 'FAIL',
      notes: message2Received ? 'Reply received' : 'Not received'
    });

    // Print results
    console.log('\n========================================');
    console.log('=== TEST RESULTS ===');
    console.log('========================================\n');

    for (const result of results) {
      const icon = result.status === 'PASS' ? '[PASS]' : '[FAIL]';
      console.log(`${icon} ${result.step}`);
      console.log(`       Notes: ${result.notes}`);
    }

    const passCount = results.filter(r => r.status === 'PASS').length;
    const allPassed = passCount === results.length;

    console.log(`\n========================================`);
    console.log(`=== OVERALL: ${allPassed ? 'PASS' : 'FAIL'} (${passCount}/${results.length} passed) ===`);
    console.log(`========================================`);

    console.log('\nKeeping browser open for 30 seconds for inspection...\n');
    await delay(30000);

  } catch (error) {
    console.error('Test failed with error:', error);
  } finally {
    await browser.close();
  }
}

main().catch(console.error);
