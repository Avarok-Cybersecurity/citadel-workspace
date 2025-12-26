# Live Doc UI Improvements Test Report

**Date:** December 13, 2025
**Tester:** Automated via Playwright MCP
**Test Environment:** localhost:5173 with tilt-based backend services

## Executive Summary

All 4 proposed UI/UX improvements for Live Doc features were tested. **3 out of 4 features are NOT IMPLEMENTED** and require development. One feature (notification count sync) is partially working.

| Issue | Feature | Status | Priority |
|-------|---------|--------|----------|
| 1 | Cursor/Presence Indicator | NOT IMPLEMENTED | High |
| 2 | Messages Tab Notification Dot | NOT IMPLEMENTED | Medium |
| 3 | Tab Activity Indicator | NOT IMPLEMENTED | Medium |
| 4 | Notification Bell Count Sync | PARTIALLY WORKING | Low |

---

## Test Setup

### Users Created
- **User 1 (Tab 0):** p2ptest1_1213a - P2P Test User 1
- **User 2 (Tab 1):** p2ptest2_1213a - P2P Test User 2

### P2P Connection
- Users successfully registered as P2P peers
- Bidirectional messaging working
- YJS awareness messages exchanging between peers

---

## Issue 1: Cursor/Presence Indicator

### Expected Behavior
A thin vertical blinking line (cursor indicator) should appear in Live Doc editor showing where collaborators are actively typing. Should include a username tooltip on hover.

### Test Procedure
1. User 1 created "Test Cursor Indicator Doc" Live Doc
2. User 2 opened the same Live Doc
3. User 2 typed content: "Hello from User 2! This is a cursor test."
4. Switched to User 1's view to check for cursor indicator

### Result: NOT IMPLEMENTED

**Observations:**
- YJS awareness IS working - shows "Editing with p2ptest2_1213a" text
- NO visual cursor/caret indicator showing collaborator's typing position
- Content sync appears broken (User 1's editor showed empty content)

### Screenshots
- `cursor-indicator-test-user1.png` - Shows empty editor, no cursor indicator visible

### Required Implementation
1. Subscribe to YJS awareness state changes for cursor positions
2. Render cursor indicator overlay at collaborator's cursor position
3. Add username tooltip on hover
4. Animate cursor with blinking effect
5. Use distinct colors for multiple collaborators

---

## Issue 2: Messages Tab Notification Dot

### Expected Behavior
A glowing green dot should appear on the "Messages" tab when a P2P message arrives while the user is viewing a Live Doc tab.

### Test Procedure
1. User 1 had "Test Cursor Indicator Doc" tab open (not on Messages)
2. User 2 sent text message: "Test message from User 2 - checking notification dot!"
3. Checked User 1's Messages tab for notification indicator

### Result: NOT IMPLEMENTED

**Observations:**
- Message was received successfully (appeared in chat)
- NO green dot or any visual indicator on Messages tab
- Tab appears plain regardless of unread messages

### Screenshots
- `messages-tab-notification-test.png` - Messages tab without notification dot

### Required Implementation
1. Track unread message count per tab
2. Add green dot component to tab when unread > 0
3. Clear dot when tab is clicked/viewed
4. Optional: Add subtle pulse/glow animation

---

## Issue 3: Tab Activity Indicator

### Expected Behavior
A green dot should appear on Live Doc tabs when a peer has activity in that document (typing, editing).

### Test Procedure
1. Captured baseline screenshot of User 1's tabs
2. User 2 opened "Cursor Test Doc" Live Doc
3. User 2 typed: "Testing tab activity indicator from User 2!"
4. Switched to User 1's view to check tab indicators

### Result: NOT IMPLEMENTED

**Observations:**
- YJS sync messages were being exchanged (visible in console logs)
- NO green dot on any Live Doc tabs
- No visual differentiation between active and inactive document tabs

### Screenshots
- `tab-activity-indicator-test-before.png` - Tabs before activity
- `tab-activity-indicator-test-after.png` - Tabs after peer activity (no change)

### Required Implementation
1. Subscribe to YJS document update events for each open Live Doc
2. Track activity state per document
3. Show green dot on tab when remote peer makes changes
4. Clear dot after N seconds of inactivity or when tab is focused
5. Optional: Distinguish between "peer typing" vs "peer made changes"

---

## Issue 4: Notification Bell Count Sync

### Expected Behavior
The notification bell count should automatically decrement when messages are viewed (either by clicking Messages tab or scrolling to see messages).

### Test Procedure
1. Observed notification count: 11
2. Clicked on Messages tab to view messages
3. Checked if count decreased

### Result: PARTIALLY WORKING

**Observations:**
- Count decreased from 11 to 9 when Messages tab was clicked
- Count decremented by 2 (possibly counted multiple message types)
- Basic count update works when explicitly viewing messages

### Improvements Needed
1. More granular decrement (1 per message viewed, not batch)
2. Auto-decrement as user scrolls through messages
3. Real-time sync when viewing messages in already-open tab
4. Consider "mark all as read" functionality

---

## Technical Notes

### Working Features
- YJS document sync (content replication)
- YJS awareness (shows "Editing with {username}")
- P2P messaging via WebSocket/WASM
- BroadcastChannel for cross-tab communication
- Notification count in bell icon

### Console Logs Observed
```
P2P message content: {"type":"yjs_sync","document_id":"..."}
P2P message content: {"type":"yjs_awareness","document_id":"..."}
BroadcastChannelService: Received message from tab-xxx: leader-election
```

### Architecture Context
- Single WebSocket per browser (leader tab manages)
- Follower tabs receive updates via BroadcastChannel
- YJS awareness messages flowing but not rendered visually

---

## Recommended Priority Order

1. **Issue 1 (Cursor Indicator)** - High value for collaborative editing UX
2. **Issue 3 (Tab Activity)** - Important for multi-document workflows
3. **Issue 2 (Messages Dot)** - Useful notification signal
4. **Issue 4 (Bell Sync)** - Already partially working, refinement only

---

## Files Created During Testing

| File | Description |
|------|-------------|
| `cursor-indicator-test-user1.png` | Live Doc editor without cursor indicator |
| `messages-tab-notification-test.png` | Messages tab without green dot |
| `tab-activity-indicator-test-before.png` | Tabs before peer activity |
| `tab-activity-indicator-test-after.png` | Tabs after peer activity (unchanged) |
| `notification-count-after-viewing.png` | Count decreased after viewing messages |
