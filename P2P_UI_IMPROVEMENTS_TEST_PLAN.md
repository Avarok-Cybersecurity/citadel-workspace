# P2P UI Improvements Test Plan

**Date:** 2025-12-11
**Purpose:** Test 4 UI improvements after basic P2P messaging verification

---

## Prerequisites

1. Services running: `docker ps | grep -E "(internal-service|server)"`
2. UI accessible at http://localhost:5173/
3. Workspace password: `SUPER_SECRET_ADMIN_PASSWORD_CHANGE_ME`
4. Account password: `test12345`

---

## Phase 1: Account Setup

### Tab 1: Create User A

1. Open http://localhost:5173/ in a new browser tab
2. Click "Join Workspace"
3. Fill workspace form:
   - Location: `127.0.0.1:12349`
   - Password: leave empty
   - Click "NEXT"
4. Click "NEXT" on security settings
5. Fill user profile:
   - Full Name: `P2P User A`
   - Username: `p2ptest_a_{timestamp}` (use current timestamp)
   - Password: `test12345`
   - Confirm: `test12345`
   - Click "JOIN"
6. If "Initialize Workspace" modal appears:
   - Enter: `SUPER_SECRET_ADMIN_PASSWORD_CHANGE_ME`
   - Click button
7. Verify workspace loaded

### Tab 2: Create User B

1. Open http://localhost:5173/ in a NEW TAB (same browser)
2. Click "Join Workspace"
3. Fill workspace form (same location: `127.0.0.1:12349`)
4. Click "NEXT" on security settings
5. Fill user profile:
   - Full Name: `P2P User B`
   - Username: `p2ptest_b_{same_timestamp}`
   - Password: `test12345`
   - Click "JOIN"
6. **VERIFY:** NO "Initialize Workspace" modal (second user)
7. Verify workspace loaded

**CHECKPOINT 1:** Both accounts created, both tabs open

---

## Phase 2: P2P Registration

### From Tab 1 (User A):

1. Look for "Discover Peers" button in header area
2. Click to open Peer Discovery modal
3. Click "Refresh" if peer list is empty
4. Wait for User B to appear in list
5. Click "Connect" button next to User B
6. Button should change to "Awaiting Response..."

### From Tab 2 (User B):

1. Look for notification badge or bell icon
2. Open Pending Requests modal
3. Verify User A's request appears
4. Click "Accept" for User A
5. Verify badge is cleared after accepting

### Verification:

1. Both users should see "DIRECT MESSAGES" section in sidebar
2. The peer should appear in the direct messages list

**CHECKPOINT 2:** P2P Registration complete

---

## Phase 3: Basic Messaging Test

### From Tab 1 (User A):

1. Click on User B in DIRECT MESSAGES sidebar
2. Verify chat header shows User B and "Online" status
3. Type: "Hello from User A!"
4. Click Send or press Enter
5. Verify message appears on RIGHT side (sender)

### From Tab 2 (User B):

1. Click on User A in DIRECT MESSAGES sidebar
2. Verify "Hello from User A!" appears on LEFT side (receiver)
3. Type: "Hello back from User B!"
4. Click Send
5. Verify message appears on RIGHT side (sender)

### From Tab 1 (User A):

1. Verify "Hello back from User B!" appears on LEFT side (received)
2. Verify total 2 messages visible with correct positioning

**CHECKPOINT 3:** Bidirectional messaging verified

---

## Phase 4: Test UI Improvements

### UI Improvement 1: Cursor Indicator in Live Doc

**Test Steps:**
1. From Tab 1 (User A): In the P2P chat, click the message type selector
2. Select "Live Doc" type
3. Enter a document title: "Test Doc"
4. Click Create
5. Document should open in a new tab within the chat panel

**From Tab 2 (User B):**
1. Click on User A in DIRECT MESSAGES
2. Find the Live Document message bubble
3. Click "Click to open" on the bubble
4. Document should open in User B's view

**Cursor Test:**
1. In Tab 1, start typing in the document
2. Switch to Tab 2
3. **VERIFY:** You should see a thin blinking vertical line with a tooltip showing User A's name
4. The tooltip should have a colored background

**Expected Behavior:**
- Thin vertical line at cursor position (2px wide)
- Line should blink (1s interval)
- Tooltip above cursor with username
- Click tooltip to expand for flash comment input

**Screenshot:** Take screenshot of cursor indicator in Tab 2

---

### UI Improvement 2: Messages Tab Notification Dot

**Test Steps:**
1. In Tab 1 (User A), with the Live Document tab open (NOT messages tab)
2. From Tab 2 (User B), send a new message in the chat

**From Tab 1 (User A):**
1. Look at the "Messages" tab in the tab bar
2. **VERIFY:** Green glowing dot should appear next to "Messages" text
3. The dot should pulse/animate

**Expected Behavior:**
- Green dot (8px diameter)
- Glowing effect with box-shadow
- Pulse animation
- Dot disappears when Messages tab is clicked

**Screenshot:** Take screenshot showing the notification dot on Messages tab

---

### UI Improvement 3: Tab Activity Indicator (Live Doc)

**Test Steps:**
1. In Tab 1 (User A), ensure both "Messages" and Live Doc tabs are visible
2. Click on "Messages" tab (not Live Doc)
3. From Tab 2 (User B), type some text in the Live Document

**From Tab 1 (User A):**
1. Look at the Live Doc tab
2. **VERIFY:** Green activity indicator should appear on the Live Doc tab
3. The indicator shows peer has made changes

**Expected Behavior:**
- Same green dot style as Messages notification
- Appears when document receives update while not active
- Clears when tab is selected

**Screenshot:** Take screenshot of activity indicator on Live Doc tab

---

### UI Improvement 4: Notification Bell Count Sync

**Test Steps:**
1. Open the browser's notification center by clicking the bell icon
2. Note the current unread count

**From Tab 2 (User B):**
1. Send multiple new messages to User A
2. Check bell icon badge count increases in Tab 1

**From Tab 1 (User A):**
1. Click on User B in DIRECT MESSAGES to view the conversation
2. **VERIFY:** Notification bell count should auto-decrement
3. Messages from User B should be automatically marked as read

**Expected Behavior:**
- Badge shows unread count (destructive/red badge)
- Count decreases when viewing conversation
- Uses `notificationService.markMessageNotificationsAsReadBySender(peerCid)`

**Screenshot:** Take screenshot of bell icon before and after viewing messages

---

## Phase 5: Final Verification

### Console Check:
1. Open browser DevTools (F12)
2. Check Console tab for errors
3. Note any warnings related to:
   - "Key not found"
   - "request timed out"
   - "MessageSendFailure"

### Server Logs Check:
```bash
tilt logs internal-service | tail -100
tilt logs server | tail -100
```

---

## Report Template

```markdown
# P2P UI Improvements Test Report

**Date:** {current_date}
**Timestamp:** {test_timestamp}

## Accounts Created
- User A: {USER_A_USERNAME}
- User B: {USER_B_USERNAME}

## P2P Messaging Test Results

| Test | Status | Notes |
|------|--------|-------|
| Account Creation | PASS/FAIL | |
| P2P Registration | PASS/FAIL | |
| Message A->B | PASS/FAIL | |
| Message B->A | PASS/FAIL | |
| Message Positioning | PASS/FAIL | Sender=RIGHT, Receiver=LEFT |

## UI Improvements Test Results

| Feature | Status | Notes |
|---------|--------|-------|
| Cursor Indicator in Live Doc | PASS/FAIL | Blinking line + tooltip visible |
| Messages Tab Notification Dot | PASS/FAIL | Green glowing dot when new message |
| Tab Activity Indicator | PASS/FAIL | Green dot on Live Doc when peer activity |
| Notification Bell Count Sync | PASS/FAIL | Auto-decrement when messages viewed |

## UX Issues Discovered

| Severity | Issue |
|----------|-------|
| HIGH/MEDIUM/LOW | Description |

## Console Warnings/Errors

- {warning_message}

## Screenshots

1. cursor-indicator.png
2. messages-tab-notification.png
3. tab-activity-indicator.png
4. notification-bell-count.png

## Overall Result: PASS/FAIL
```

---

## Key Files Reference

| Feature | File | Key Lines |
|---------|------|-----------|
| Cursor Indicator | `src/components/p2p/CollaboratorCursor.tsx` | Lines 48-195 |
| Messages Tab Dot | `src/components/p2p/ChatTabBar.tsx` | Lines 44-46 |
| Tab Activity | `src/components/p2p/P2PChat.tsx` | Lines 274-290 |
| Bell Count Sync | `src/components/p2p/P2PChat.tsx` | Lines 313-318 |
| CSS Styles | `src/index.css` | Lines 255-487 |

---

## Expected CSS Behavior

### Cursor Indicator
```css
.collaborator-cursor__line {
  width: 2px;
  animation: cursor-blink 1s step-end infinite;
}
.collaborator-cursor__tooltip {
  white-space: nowrap;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
}
```

### Notification Dot
```css
.notification-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #22c55e;
  box-shadow: 0 0 6px #22c55e;
}
.notification-dot.animate-pulse-green {
  animation: pulse-glow-green 2s ease-in-out infinite;
}
```

---

## Troubleshooting

### If P2P messaging fails:
1. Check both sessions exist in GetSessions response
2. Look for PeerConnectFailure or MessageSendFailure errors
3. Verify peer_connections is populated in backend logs

### If cursor doesn't appear:
1. Verify both users have the document open
2. Check for `yjs_awareness` messages in console
3. Verify `p2p:raw-message` event is being emitted

### If notification dot doesn't appear:
1. Verify you're NOT on the Messages tab when message arrives
2. Check `messagesHasUnread` state in React DevTools
3. Verify eventEmitter 'p2p:message-received' is fired
