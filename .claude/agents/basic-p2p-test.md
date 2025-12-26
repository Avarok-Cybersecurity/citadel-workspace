---
name: basic-p2p-test
description: Basic P2P workflow test with 2 users. Creates accounts, registers P2P, tests bidirectional messaging, and documents UX/UI issues and console warnings.
model: opus
tools: Read, Write, Glob, Grep, LS, Bash, mcp__playwright__browser_navigate, mcp__playwright__browser_type, mcp__playwright__browser_click, mcp__playwright__browser_select_option, mcp__playwright__browser_console_messages, mcp__playwright__browser_navigate_back, mcp__playwright__browser_close, mcp__playwright__browser_snapshot, mcp__playwright__browser_wait_for, mcp__playwright__browser_press_key, mcp__playwright__browser_take_screenshot, mcp__playwright__browser_handle_dialog, mcp__playwright__browser_navigate_forward, mcp__playwright__browser_evaluate, mcp__playwright__browser_file_upload, mcp__playwright__browser_tabs, mcp__playwright__browser_network_requests, mcp__playwright__browser_install, mcp__playwright__browser_hover, mcp__playwright__browser_resize
color: blue
---
# Basic P2P Test Workflow

Tests P2P messaging between 2 users while documenting UX/UI issues and console warnings.

**CRITICAL: If ANY step fails or times out, IMMEDIATELY exit and return which step failed and why.**

## Configuration

- **UI_URL**: http://localhost:5173/
- **SERVER_LOCATION**: 127.0.0.1:12349
- **WORKSPACE_PASSWORD**: SUPER_SECRET_ADMIN_PASSWORD_CHANGE_ME
- **USER_PASSWORD**: test12345
- **MAX_WAIT_SECONDS**: 10 (for any single operation)

## Test Variables

- `TIMESTAMP`: Test start timestamp
- `USER1_USERNAME`: p2ptest1_{TIMESTAMP}
- `USER2_USERNAME`: p2ptest2_{TIMESTAMP}
- `UX_ISSUES`: Array of discovered UX/UI issues
- `CONSOLE_WARNINGS`: Array of console warnings

---

## Phase 0: Prerequisites Check (MUST PASS BEFORE CONTINUING)

**Step 0.1:** Check if services are running
```bash
tilt logs internal-service 2>&1 | tail -3
```
- **PASS if**: Contains "Citadel client established" or "Running target/debug/citadel-workspace-internal-service"
- **FAIL if**: Contains "connection refused" or command fails
- **ON FAIL**: Return immediately with "PREREQUISITE FAILED: Internal service not running. Run `tilt up` first."

**Step 0.2:** Check if UI is accessible
```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:5173/ --max-time 5
```
- **PASS if**: Returns 200
- **FAIL if**: Returns non-200 or times out
- **ON FAIL**: Return immediately with "PREREQUISITE FAILED: UI not accessible at http://localhost:5173/. Check if `tilt up` is running and UI service is healthy."

**Step 0.3:** Check server is running
```bash
tilt logs server 2>&1 | tail -3
```
- **PASS if**: Contains "Running" or "workspace"
- **FAIL if**: Contains errors or command fails
- **ON FAIL**: Return immediately with "PREREQUISITE FAILED: Server not running."

**CHECKPOINT 0:** All prerequisites passed. Continue to Phase 1.

---

## Phase 1: Create 2 Accounts

### Tab 0: Create User 1

**Step 1.1:** Navigate to http://localhost:5173/
- Use browser_navigate
- **ON FAIL**: Return "STEP 1.1 FAILED: Cannot navigate to UI"

**Step 1.2:** Wait up to 5 seconds for page to load, then take snapshot
- Use browser_wait_for with timeout
- Use browser_snapshot
- **ON FAIL**: Return "STEP 1.2 FAILED: Page did not load"

**Step 1.3:** Generate TIMESTAMP = current epoch time (e.g., Date.now() equivalent)

**Step 1.4:** Click "Join Workspace" button
- Look for button with text "Join Workspace" or similar
- **ON FAIL**: Return "STEP 1.4 FAILED: Cannot find Join Workspace button"

**Step 1.5:** Fill workspace form:
- Location: `127.0.0.1:12349`
- Password: leave empty
- Click "NEXT"

**Step 1.6:** Click "NEXT" on security settings

**Step 1.7:** Fill user profile:
- Full Name: P2P Test User One
- Username: `p2ptest1_{TIMESTAMP}` → store as USER1_USERNAME
- Password: `test12345`
- Confirm: `test12345`
- Click "JOIN"

**Step 1.8:** Check for "Initialize Workspace" modal
- If appears, enter: `SUPER_SECRET_ADMIN_PASSWORD_CHANGE_ME`
- Click the button to submit

**Step 1.9:** Wait up to 10 seconds for workspace to load
- Verify by looking for workspace UI elements (sidebar, content area)
- Take screenshot: "01-user1-workspace.png"
- **ON FAIL**: Return "STEP 1.9 FAILED: Workspace did not load for User 1"

### Tab 1: Create User 2

**Step 1.10:** Open new tab using browser_tabs action="new"

**Step 1.11:** Navigate to http://localhost:5173/
- **ON FAIL**: Return "STEP 1.11 FAILED: Cannot navigate in Tab 1"

**Step 1.12:** Click "Join Workspace"

**Step 1.13:** Fill workspace form (same location: 127.0.0.1:12349)

**Step 1.14:** Click "NEXT" on security settings

**Step 1.15:** Fill user profile:
- Full Name: P2P Test User Two
- Username: `p2ptest2_{TIMESTAMP}` → store as USER2_USERNAME
- Password: `test12345`
- Click "JOIN"

**Step 1.16:** **VERIFY**: No "Initialize Workspace" modal should appear
- If it does, note UX issue: "Initialize workspace appeared for second user"

**Step 1.17:** Wait for workspace to load
- Take screenshot: "02-user2-workspace.png"
- **ON FAIL**: Return "STEP 1.17 FAILED: Workspace did not load for User 2"

**CHECKPOINT 1:** Two accounts created. Verify 2 tabs exist using browser_tabs action="list".

---

## Phase 2: P2P Registration

**Step 2.1:** Switch to Tab 0 (User1) using browser_tabs action="select" index=0

**Step 2.2:** Look for "Discover Peers" button in WORKSPACE MEMBERS section
- Take snapshot to find the button

**Step 2.3:** Click "Discover Peers" to open modal

**Step 2.4:** In modal, click "Refresh" if peer list is empty

**Step 2.5:** Wait up to 10 seconds for USER2_USERNAME to appear in list
- **ON FAIL**: Return "STEP 2.5 FAILED: User 2 not appearing in peer list after 10s"

**Step 2.6:** Click "Connect" button next to USER2_USERNAME
- Take screenshot: "03-user1-sends-invite.png"

**Step 2.7:** Switch to Tab 1 (User2) using browser_tabs action="select" index=1

**Step 2.8:** Look for notification badge or bell icon with count
- Wait up to 10 seconds
- If not visible, note UX issue

**Step 2.9:** Click notification to open pending requests

**Step 2.10:** Find and click "Accept" for USER1_USERNAME's request
- Take screenshot: "04-user2-accepts.png"

**Step 2.11:** Verify "DIRECT MESSAGES" section shows USER1_USERNAME
- **ON FAIL**: Return "STEP 2.11 FAILED: DIRECT MESSAGES not populated after registration"

**CHECKPOINT 2:** P2P Registration complete.

---

## Phase 3: Bidirectional Messaging

### Message 1: User1 → User2

**Step 3.1:** Switch to Tab 0 (User1)

**Step 3.2:** In DIRECT MESSAGES sidebar, click USER2_USERNAME

**Step 3.3:** Verify chat opens with header showing USER2_USERNAME
- Note if shows "Offline" (UX issue if peer should be online)

**Step 3.4:** Type message: "Hello from user1!"

**Step 3.5:** Send message (press Enter or click Send)

**Step 3.6:** Wait 3 seconds, verify message appears on RIGHT side (sender)
- Take screenshot: "05-message-sent-user1.png"
- **ON FAIL**: Return "STEP 3.6 FAILED: Sent message not appearing"

**Step 3.7:** Switch to Tab 1 (User2)

**Step 3.8:** Click USER1_USERNAME in DIRECT MESSAGES

**Step 3.9:** Verify "Hello from user1!" appears on LEFT side (receiver)
- Take screenshot: "06-message-received-user2.png"
- **ON FAIL**: Note that message was not received, but continue

### Message 2: User2 → User1

**Step 3.10:** In Tab 1 (User2), type: "Hello back from user2!"

**Step 3.11:** Send message

**Step 3.12:** Wait 3 seconds, verify message on RIGHT (sender)
- Take screenshot: "07-message-sent-user2.png"

**Step 3.13:** Switch to Tab 0 (User1)

**Step 3.14:** Verify "Hello back from user2!" on LEFT (received)
- Take screenshot: "08-bidirectional-complete.png"
- **ON FAIL**: Note that message was not received

**CHECKPOINT 3:** Messaging test complete.

---

## Phase 4: Cleanup and Report

**Step 4.1:** Capture console messages with browser_console_messages

**Step 4.2:** Check backend logs:
```bash
tilt logs internal-service 2>&1 | tail -20
```

**Step 4.3:** Close browser with browser_close

**Step 4.4:** Generate report to `P2P_BASIC_TEST_REPORT.md`:

```markdown
# P2P Basic Test Report

**Date:** {current_date}
**Timestamp:** {TIMESTAMP}

## Accounts Created
- User 1: {USER1_USERNAME}
- User 2: {USER2_USERNAME}

## Test Results

| Test | Status | Notes |
|------|--------|-------|
| Account Creation | PASS/FAIL | |
| P2P Registration | PASS/FAIL | |
| Message User1→User2 | PASS/FAIL | |
| Message User2→User1 | PASS/FAIL | |

## UX/UI Issues Discovered

| Severity | Issue |
|----------|-------|
{list issues}

## Console Warnings/Errors

{list warnings}

## Overall Result: PASS/FAIL
```

---

## Error Handling Rules

1. **Service Not Running**: If tilt logs show errors or connection refused, EXIT IMMEDIATELY
2. **UI Not Accessible**: If curl to localhost:5173 fails, EXIT IMMEDIATELY
3. **Step Timeout**: If any step takes >10 seconds without progress, note it and try to continue
4. **Critical Failure**: If account creation or P2P registration fails, EXIT and report
5. **Message Failure**: If messaging fails, document but try to complete other tests

## Success Criteria

**PASS if:**
- Both accounts created
- P2P registration completed
- At least one message delivered

**FAIL if:**
- Prerequisites fail
- Account creation fails
- P2P registration fails
