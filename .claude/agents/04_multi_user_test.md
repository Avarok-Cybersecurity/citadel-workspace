---
name: multi-user-agent
description: Comprehensive multi-workspace test that creates 3 accounts, verifies OrphanSessionsNavbar shows all sessions, and tests workspace switching between all accounts
model: sonnet
tools: Read, Write, Glob, Grep, LS, Bash, mcp__playwright__browser_navigate, mcp__playwright__browser_type, mcp__playwright__browser_click, mcp__playwright__browser_select_option, mcp__playwright__browser_console_messages, mcp__playwright__browser_navigate_back, mcp__playwright__browser_close, mcp__playwright__browser_snapshot, mcp__playwright__browser_wait_for, mcp__playwright__browser_press_key, mcp__playwright__browser_take_screenshot, mcp__playwright__browser_handle_dialog, mcp__playwright__browser_navigate_forward, mcp__playwright__browser_evaluate, mcp__playwright__browser_file_upload, mcp__playwright__browser_tab_select, mcp__playwright__browser_tab_list, mcp__playwright__browser_tab_close, mcp__playwright__browser_network_requests, mcp__playwright__browser_install, mcp__playwright__browser_tab_new, mcp__playwright__browser_hover, mcp__playwright__browser_resize
color: blue
---
# Multi-User Workspace Switching Test

This workflow performs comprehensive testing of multi-workspace functionality (Slack-like) by creating 3 accounts, verifying the OrphanSessionsNavbar displays all active sessions, and testing workspace switching between all accounts.

## Definitions

`checkForErrors()`: Look for errors in the console logs and in any possible overlay displayed. Stop if errors occur and fix them, restart from the beginning.

`scanScreen()`: Scan the screen for any errors or overlays. Stop if errors occur and fix them, restart from the beginning.

`checkLogs()`: Check backend logs using `tilt logs server | tail -50` and `tilt logs internal-service | tail -50` for errors, session conflicts, or message routing issues. Report any errors found.

`verifyWorkspaceLoaded()`: Verify the workspace has loaded by checking that:
- No continuous loading spinner is visible
- Workspace name is displayed in top left
- No timeout errors in console
- Toast notification appeared (if applicable)

`takeScreenshot(name)`: Take a screenshot with a descriptive filename. Store the path for the final report.

`storeUsername(userN, username)`: Store the generated username for later use in switching tests.

## Prerequisites

- Backend services running: `tilt logs server` and `tilt logs internal-service` should show active services
- Navigate to the landing page http://localhost:5173/
- checkForErrors()
- scanScreen()

## Test Phases

### Phase 1: Create User 1 (First User - Workspace Initialization)

**Step 1:** Navigate to http://localhost:5173/
**Step 2:** Click "Join Workspace" button
**Step 3:** Fill in workspace connection form:
  - Workspace location: 127.0.0.1:12349
  - Workspace password: (leave empty)
  - Click "NEXT"
**Step 4:** Click "NEXT" on security settings modal (use defaults)
**Step 5:** Fill in user profile form:
  - Full Name: User One
  - Username: Generate as `user1_{timestamp}` (e.g., "user1_1761492000000")
  - Password: test12345
  - Confirm Password: test12345
  - Click "JOIN"
**Step 6:** storeUsername("user1", generated_username)
**Step 7:** checkForErrors()
**Step 8:** **IMPORTANT:** "Initialize Workspace" modal should appear (first user only)
  - Read workspace master password from ./docker/workspace-server/kernel.toml
  - Look for `workspace_master_password` field (currently "SUPER_SECRET_ADMIN_PASSWORD_CHANGE_ME")
  - Enter the password in the modal
  - Click "Initialize"
**Step 9:** verifyWorkspaceLoaded()
**Step 10:** takeScreenshot("01_user1_workspace_loaded")
**Step 11:** checkLogs() - Verify workspace initialization succeeded
**Step 12:** Navigate to http://localhost:5173/
**Step 13:** Wait 2 seconds for OrphanSessionsNavbar to load
**Step 14:** takeScreenshot("02_after_user1_landing_page")

---

### Phase 2: Create User 2

**Step 15:** On landing page, click "Join Workspace" button
**Step 16:** Fill in workspace connection form:
  - Workspace location: 127.0.0.1:12349
  - Workspace password: (leave empty)
  - Click "NEXT"
**Step 17:** Click "NEXT" on security settings modal (use defaults)
**Step 18:** Fill in user profile form:
  - Full Name: User Two
  - Username: Generate as `user2_{timestamp}`
  - Password: test12345
  - Confirm Password: test12345
  - Click "JOIN"
**Step 19:** storeUsername("user2", generated_username)
**Step 20:** checkForErrors()
**Step 21:** **CRITICAL CHECK:** "Initialize Workspace" modal should NOT appear (workspace already initialized)
  - If it appears, STOP and report error - this violates the workflow
**Step 22:** verifyWorkspaceLoaded()
**Step 23:** takeScreenshot("03_user2_workspace_loaded")
**Step 24:** checkLogs() - Verify user2 was added to workspace domain
**Step 25:** Navigate to http://localhost:5173/
**Step 26:** Wait 2 seconds for OrphanSessionsNavbar to load
**Step 27:** Verify via browser_snapshot that 2 workspace icons are visible
**Step 28:** takeScreenshot("04_after_user2_two_icons_visible")

---

### Phase 3: Create User 3

**Step 29:** On landing page, click "Join Workspace" button
**Step 30:** Fill in workspace connection form:
  - Workspace location: 127.0.0.1:12349
  - Workspace password: (leave empty)
  - Click "NEXT"
**Step 31:** Click "NEXT" on security settings modal (use defaults)
**Step 32:** Fill in user profile form:
  - Full Name: User Three
  - Username: Generate as `user3_{timestamp}`
  - Password: test12345
  - Confirm Password: test12345
  - Click "JOIN"
**Step 33:** storeUsername("user3", generated_username)
**Step 34:** checkForErrors()
**Step 35:** **CRITICAL CHECK:** "Initialize Workspace" modal should NOT appear
**Step 36:** verifyWorkspaceLoaded()
**Step 37:** takeScreenshot("05_user3_workspace_loaded")
**Step 38:** checkLogs() - Verify user3 was added to workspace domain
**Step 39:** Navigate to http://localhost:5173/
**Step 40:** Wait 2 seconds for OrphanSessionsNavbar to load
**Step 41:** Verify via browser_snapshot that 3 workspace icons are visible
**Step 42:** takeScreenshot("06_all_three_icons_visible")
**Step 43:** **VERIFICATION CHECKPOINT:** All 3 accounts created successfully

---

### Phase 4: Test Workspace Switching - Switch to User 1

**Step 44:** On landing page (http://localhost:5173/), verify 3 workspace icons are visible
**Step 45:** Identify user1's workspace icon (should show first letter of username or "U")
**Step 46:** Click user1's workspace icon in OrphanSessionsNavbar
**Step 47:** Wait for workspace to load (max 5 seconds)
**Step 48:** checkForErrors() - Look for console errors, especially:
  - "Session Already Connected" errors
  - "ListRegisteredPeers request timed out" (non-critical, can be ignored)
  - MessageNotification routing errors
**Step 49:** Verify toast notification appeared: "Connected! Now viewing {user1_username}"
**Step 50:** verifyWorkspaceLoaded()
**Step 51:** Verify workspace displays correct user:
  - Check top left shows "RW Root Workspace" with User One's name
  - Verify URL is http://localhost:5173/office
**Step 52:** takeScreenshot("07_switched_to_user1")
**Step 53:** checkLogs() - Look for:
  - "Successfully claimed session {cid}" in internal-service logs
  - "MessageNotification" with workspace data in logs
  - "GetWorkspace for user: {user1_username}" in server logs
**Step 54:** Navigate to http://localhost:5173/

---

### Phase 5: Test Workspace Switching - Switch to User 2

**Step 55:** On landing page, verify 3 workspace icons still visible
**Step 56:** Identify user2's workspace icon
**Step 57:** Click user2's workspace icon in OrphanSessionsNavbar
**Step 58:** Wait for workspace to load (max 5 seconds)
**Step 59:** checkForErrors()
**Step 60:** Verify toast notification: "Connected! Now viewing {user2_username}"
**Step 61:** verifyWorkspaceLoaded()
**Step 62:** Verify workspace displays User Two
**Step 63:** takeScreenshot("08_switched_to_user2")
**Step 64:** checkLogs() - Same checks as Step 53
**Step 65:** Navigate to http://localhost:5173/

---

### Phase 6: Test Workspace Switching - Switch to User 3

**Step 66:** On landing page, verify 3 workspace icons still visible
**Step 67:** Identify user3's workspace icon
**Step 68:** Click user3's workspace icon in OrphanSessionsNavbar
**Step 69:** Wait for workspace to load (max 5 seconds)
**Step 70:** checkForErrors()
**Step 71:** Verify toast notification: "Connected! Now viewing {user3_username}"
**Step 72:** verifyWorkspaceLoaded()
**Step 73:** Verify workspace displays User Three
**Step 74:** takeScreenshot("09_switched_to_user3")
**Step 75:** checkLogs() - Same checks as Step 53
**Step 76:** Navigate to http://localhost:5173/

---

### Phase 7: Bidirectional Switching Test (User 3 → User 1 → User 2)

**Step 77:** Switch from User 3 to User 1:
  - Click user1 workspace icon
  - Verify workspace loads with User One data
  - takeScreenshot("10_user3_to_user1_switch")
  - checkForErrors()
**Step 78:** Navigate to landing page
**Step 79:** Switch from User 1 to User 2:
  - Click user2 workspace icon
  - Verify workspace loads with User Two data
  - takeScreenshot("11_user1_to_user2_switch")
  - checkForErrors()
**Step 80:** Navigate to landing page
**Step 81:** Switch from User 2 to User 3:
  - Click user3 workspace icon
  - Verify workspace loads with User Three data
  - takeScreenshot("12_user2_to_user3_switch")
  - checkForErrors()

---

### Phase 9: Disconnect Test

**Step 82:** Navigate to http://localhost:5173/
**Step 83:** Wait 2 seconds for OrphanSessionsNavbar to load
**Step 84:** takeScreenshot("13_before_disconnect")
**Step 85:** Verify via browser_snapshot that 3 workspace icons are visible
**Step 86:** Identify user2's workspace icon and its disconnect button (trash/X icon)
**Step 87:** Click the disconnect button for user2
**Step 88:** If a confirmation modal appears, confirm the disconnect
**Step 89:** Wait 2 seconds for disconnect to complete
**Step 90:** takeScreenshot("14_after_disconnect_two_icons_remaining")
**Step 91:** Verify via browser_snapshot that only 2 workspace icons remain (user1 and user3)
  - user2's icon should no longer be visible
  - Verify visually that the navbar shows only 2 active workspaces
**Step 92:** checkLogs() - Check backend logs for disconnect confirmation:
  - Run `tilt logs internal-service | tail -100`
  - Look for disconnect message containing user2's CID
  - Look for "Connection Drop" or "Session cleanup" messages
  - Verify session was removed from server_connection_map
**Step 93:** checkLogs() - Check server logs:
  - Run `tilt logs server | tail -100`
  - Verify user2's session was removed from workspace domain
  - Look for cleanup messages (peers, file handlers, groups)
**Step 94:** checkForErrors() - Ensure disconnect completed without errors
**Step 95:** **VERIFICATION CHECKPOINT:** Disconnect test successful

---

### Phase 10: Re-login Verification

**Step 96:** On landing page (http://localhost:5173/), verify only 2 workspace icons visible
**Step 97:** Click "Login Workspace" button
**Step 98:** Fill in login form with user2's credentials:
  - Username: {user2_username} (stored from Phase 2)
  - Password: test12345
  - Click "Connect"
**Step 99:** checkForErrors() - Look for any login errors
**Step 100:** verifyWorkspaceLoaded() - Ensure workspace loads successfully
**Step 101:** Verify workspace displays User Two's name
**Step 102:** takeScreenshot("15_user2_relogin_success")
**Step 103:** checkLogs() - Verify successful reconnection:
  - Look for "ConnectSuccess" with new CID for user2
  - Verify workspace data loaded (GetWorkspace, ListOffices)
**Step 104:** Navigate to http://localhost:5173/
**Step 105:** Wait 2 seconds for OrphanSessionsNavbar to load
**Step 106:** Verify via browser_snapshot that 3 workspace icons are visible again
  - user2's icon should be back in the navbar
**Step 107:** takeScreenshot("16_after_relogin_three_icons_again")
**Step 108:** Optionally test switching to user2's workspace:
  - Click user2's workspace icon
  - Verify workspace loads successfully
  - Navigate back to landing page
**Step 109:** checkForErrors()
**Step 110:** checkLogs() - Final verification that re-login succeeded
**Step 111:** **VERIFICATION CHECKPOINT:** Re-login test successful

---

### Phase 11: Final Verification and Report

**Step 112:** Navigate to http://localhost:5173/
**Step 113:** Wait 2 seconds for OrphanSessionsNavbar
**Step 114:** takeScreenshot("17_final_all_three_icons")
**Step 115:** checkLogs() - Final comprehensive log check
**Step 116:** Close browser

**Step 117:** Generate comprehensive test report with:
  - **Created Accounts:**
    - user1: {username} (CID from logs)
    - user2: {username} (CID from logs)
    - user3: {username} (CID from logs)

  - **Screenshots Taken:** (list all 17 screenshots with paths)
    1. 01_user1_workspace_loaded
    2. 02_after_user1_landing_page
    3. 03_user2_workspace_loaded
    4. 04_after_user2_two_icons_visible
    5. 05_user3_workspace_loaded
    6. 06_all_three_icons_visible
    7. 07_switched_to_user1
    8. 08_switched_to_user2
    9. 09_switched_to_user3
    10. 10_user3_to_user1_switch
    11. 11_user1_to_user2_switch
    12. 12_user2_to_user3_switch
    13. 13_before_disconnect
    14. 14_after_disconnect_two_icons_remaining
    15. 15_user2_relogin_success
    16. 16_after_relogin_three_icons_again
    17. 17_final_all_three_icons

  - **Switching Tests:**
    - ✅ Landing → User 1 (workspace loaded)
    - ✅ Landing → User 2 (workspace loaded)
    - ✅ Landing → User 3 (workspace loaded)
    - ✅ User 3 → User 1 (bidirectional)
    - ✅ User 1 → User 2 (bidirectional)
    - ✅ User 2 → User 3 (bidirectional)

  - **Disconnect & Re-login Tests:**
    - ✅ Disconnected user2 from navbar on landing page
    - ✅ Visual verification: Only 2 icons remained after disconnect
    - ✅ Backend logs confirmed session cleanup
    - ✅ Re-login to user2 succeeded
    - ✅ Visual verification: 3 icons restored after re-login
    - ✅ user2 workspace switching works after re-login

  - **Critical Checks:**
    - ✅ OrphanSessionsNavbar shows all 3 sessions
    - ✅ ClaimSession succeeds for all switches
    - ✅ MessageNotification routing works correctly
    - ✅ Workspace data loads (no timeouts)
    - ✅ Toast notifications show correct usernames
    - ✅ No "Session Already Connected" errors
    - ✅ Disconnect removes session from navbar
    - ✅ Disconnect cleanup in backend logs
    - ✅ Re-login restores session successfully

  - **Backend Verification:**
    - Log excerpts showing successful ClaimSession operations
    - MessageNotification delivery confirmations
    - Workspace data retrieval logs
    - Disconnect and session cleanup logs
    - Re-login and session restoration logs

  - **Final Verdict:** PASS/FAIL with reasoning

---

## Expected Behavior

1. **Account Creation:**
   - First user triggers workspace initialization modal
   - Subsequent users skip initialization and go directly to workspace
   - Each user session persists in OrphanSessionsNavbar

2. **OrphanSessionsNavbar:**
   - Shows all active sessions with workspace icons
   - Each icon displays first letter of username
   - Clicking icon triggers ClaimSession and workspace switch

3. **Workspace Switching:**
   - ClaimSession updates `associated_tcp_connection` to current WebSocket
   - MessageNotification responses route to correct connection
   - Workspace data loads successfully (GetWorkspace, ListOffices)
   - Toast notification confirms successful switch
   - No duplicate session errors

4. **Backend Message Routing:**
   - Server processes GetWorkspace requests
   - Internal service routes MessageNotification to current TCP connection
   - Frontend receives workspace protocol responses
   - No timeout or routing errors

## Known Non-Critical Issues

- **"ListRegisteredPeers request timed out"** - This is a P2P registration timeout, not a blocker. Core workspace functionality works correctly.

## Troubleshooting

If any step fails:

1. **"Initialize Workspace" modal appears for user2/user3:**
   - STOP - This indicates workspace initialization failed for user1
   - Check server logs for workspace initialization errors
   - Restart test from Phase 1

2. **Workspace loading timeout after switch:**
   - Check internal-service logs for ClaimSession success
   - Check server logs for GetWorkspace processing
   - Verify MessageNotification appears in logs but not in frontend
   - This indicates message routing bug (should be fixed by connect.rs changes)

3. **"Session Already Connected" error:**
   - Check if reconnectToStoredSessions() is being called
   - This should NOT happen - ClaimSession should update connection, not create new one

4. **OrphanSessionsNavbar doesn't show all icons:**
   - Check that sessions are in orphan mode (allow_orphan_sessions = true)
   - Verify getActiveSessions() returns all sessions
   - Check that Landing.tsx loads active sessions on mount

## Success Criteria

The test PASSES if:
- ✅ All 3 accounts created successfully
- ✅ OrphanSessionsNavbar displays all 3 workspace icons
- ✅ All 6 workspace switches succeed (3 from landing + 3 bidirectional)
- ✅ Each switch loads correct workspace data
- ✅ Disconnect test succeeds (user2 removed from navbar, backend logs confirm cleanup)
- ✅ Re-login test succeeds (user2 can log back in, icon restored to navbar)
- ✅ No critical errors in logs or console
- ✅ All 17 screenshots captured successfully

The test FAILS if:
- ❌ Any account creation fails
- ❌ OrphanSessionsNavbar missing any session icons
- ❌ Any workspace switch times out
- ❌ "Session Already Connected" errors occur
- ❌ MessageNotification routing fails
- ❌ User2 or User3 see initialization modal
- ❌ Disconnect fails or doesn't remove session from navbar
- ❌ Re-login fails or session not restored
