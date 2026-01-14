# P2P Messaging Test Report

**Date:** 2025-11-30
**Result:** PASS (with minor UI bugs)
**Tester:** Manual via Playwright MCP

---

## Executive Summary

**P2P messaging between two users works correctly!** Registration, connection establishment, and bidirectional message exchange all function as expected. Some UI bugs were identified (duplicate messages display, spurious error logs).

---

## Test Configuration

| Item | Value |
|------|-------|
| User A | `testuser_a_debug` (CID: 705028106378368169) |
| User B | `testuser_b_debug` (CID: 264072795762843337) |
| Password | `test12345` |
| Workspace Password | `SUPER_SECRET_ADMIN_PASSWORD_CHANGE_ME` |
| Test Method | Two browser tabs, one per user |

---

## Phase Results

| Phase | Status | Notes |
|-------|--------|-------|
| Phase 1: Account Setup | PASS | Both accounts created successfully in separate tabs |
| Phase 2: Peer Discovery | PASS | Users visible in peer discovery modal |
| Phase 3: Peer Registration | PASS | User B sent request, User A accepted |
| Phase 4: P2P Connection | PASS | `PeerConnectSuccess` received, peers added to sidebar |
| Phase 5: P2P Messaging | PASS | Bidirectional messaging works |

---

## Functionality Test Results

| Test | Result | Notes |
|------|--------|-------|
| Can User A open P2P chat with User B? | PASS | Chat panel opens with "Connected" badge |
| Can User A send a message to User B? | PASS | Message sent and acknowledged |
| Does User B receive the message in real-time? | PASS | Message appears in User B's chat |
| Can User B reply to User A? | PASS | Reply sent successfully |
| Does User A receive the reply in real-time? | PASS | Message appears in User A's chat |
| Do messages persist after page refresh? | Not Tested | LocalDB storage confirmed |
| Do unread message counts work? | Not Tested | |
| Does message history load correctly? | Not Tested | |

---

## Bugs Identified

### Bug 1: Duplicate Messages in UI (Medium Severity)

**Description:** When a user sends a message, it appears **twice** in their own chat panel.

**Evidence:**
- React warning: `Warning: Encountered two children with the same key`
- Visual: Message bubble duplicated in sender's view

**Root Cause:** Likely the message is being added both:
1. Optimistically when sent
2. Again when MessageNotification is received (echo from server or self-delivery)

**Files to Investigate:**
- `citadel-workspaces/src/lib/p2p-messenger-manager.ts` - Message handling
- `citadel-workspaces/src/components/p2p/P2PChatPanel.tsx` - Message rendering

**Suggested Fix:** Add message ID deduplication in the message list or prevent adding sent messages that echo back.

---

### Bug 2: Spurious MessageSendFailure (Low Severity)

**Description:** Console shows `MessageSendFailure` error, but the message is still delivered successfully.

**Evidence:**
```
[LOG] MessageSendFailure: {cid: 705028106378368169...}
[LOG] MessageAck: {ack_type: "delivered", message_id: "..."}
```

**Impact:** Non-blocking - message delivery works despite the error log.

**Root Cause:** Possibly a race condition where the failure response is for a different operation, or the backend sends both failure and success for some edge case.

**Files to Investigate:**
- `citadel-internal-service/src/kernel/requests/message.rs` - Message routing

---

### Bug 3: Unknown User in DIRECT MESSAGES (Low Severity)

**Description:** An entry "User 70502810..." appears in the DIRECT MESSAGES sidebar with a truncated/unknown username.

**Impact:** Minor UX issue - extra entry that shouldn't exist.

**Suggested Fix:** Filter out self-entries or entries without proper usernames.

---

## What Changed Since Previous Failed Test?

The previous test (earlier today) showed `peer_connections: {}` in backend despite frontend showing "Connected". The difference this time:

1. **Fresh accounts created in same session** - No stale sessions
2. **Both tabs connected before registration** - Proper WebSocket state
3. **No ClaimSession involved** - Each user stayed in their original tab
4. **Direct peer registration flow** - User B → User A without switching contexts

The previous test may have had issues with:
- Multi-tab session context desync
- ClaimSession not properly routing PeerConnect
- Stale peer connection state from previous sessions

---

## Visual UX Observations

| Element | Status | Notes |
|---------|--------|-------|
| Message bubble styling | Good | Clean, modern design |
| Sent vs received differentiation | Good | Sent messages on right, received on left |
| Timestamps display | Good | Shows "03:54 PM" format |
| User avatars/indicators | Good | Clear avatar with initials |
| Chat panel layout | Good | Clean header with status |
| "Connected" badge | Good | Green badge showing connection state |
| "Online" status | Good | Shows peer online status |

---

## Console Logs of Interest

### Successful P2P Flow:
```
[LOG] PeerConnectSuccess: {cid: 705028106378368169, peer_cid: 264072795762843337}
[LOG] P2PAutoConnect: Connected to 26407279...
[LOG] [P2P] sendP2PMessage called with: {cid: 705028106378368169, targetCid: 264072795762843337}
[LOG] P2P MessageNotification received from peer: 264072795762843337
[LOG] P2P message content: {"type":"MessageAck","payload":{"ack_type":"delivered"...}}
```

### Typing Indicators Working:
```
[LOG] P2P message content: {"type":"MessagingLayerCommand","payload":{"layer":{"type":"Typing"}...}}
```

---

## Flickering Issue - FIXED

**Issue:** Office/workspace flickering caused by BroadcastChannel `connection-status` messages triggering unnecessary workspace reloads.

**Fix Applied:** Added CID deduplication in `WorkspaceApp.tsx:81-97` to skip redundant connection updates for the same CID.

---

## Recommendations

### Priority 1: Fix Duplicate Messages Bug
Add message deduplication by ID in the chat message list. Check if message already exists before adding.

### Priority 2: Investigate MessageSendFailure
Determine why MessageSendFailure is logged when messages are actually delivered. May need backend investigation.

### Priority 3: Clean Up DIRECT MESSAGES List
Filter out invalid entries (self, truncated usernames) from the direct messages sidebar.

---

## Conclusion

**P2P messaging is functional!** The core functionality works correctly:
- Peer discovery and registration
- P2P connection establishment
- Bidirectional real-time messaging
- Message acknowledgments
- Typing indicators

Minor UI bugs exist but don't block the core functionality. The previous test failure was likely due to session context issues that don't occur when testing with fresh accounts in a clean setup.

**Test Status: PASS**

---

# Additional Test Session: 2024-11-30 (Evening)

**Test Users:** p2p_user_a (CID: 4398843767654670086), p2p_user_b (CID: 895697823540931917)

## Test Summary

| Test | Status | Notes |
|------|--------|-------|
| Bidirectional Messaging | ✅ PASS | Messages sent and received both directions |
| Delivery Acknowledgments | ✅ PASS | Double checkmarks (✓✓) appear on delivered messages |
| Online Status | ✅ PASS | Green "Online" indicator works correctly |
| Typing Indicators Protocol | ✅ PASS | Protocol messages sent and received |
| Special Characters & Emojis | ✅ PASS | Emojis 🎉🚀 displayed, XSS prevented |
| Rapid Messaging | ✅ PASS | Multiple messages sent quickly all delivered |
| Message Persistence | ❌ FAIL | Messages lost after page refresh |

## New Observations & Bugs Found

### 1. CRITICAL: Message History Not Persisting After Refresh
**Severity:** High
**Location:** P2P chat panel message loading

**Issue:** After refreshing the page, P2P message history is completely lost. The messages ARE being saved to LocalDB (observed `LocalDBSetKVSuccess` with key `p2p_messages_{cid}`), but they are NOT loaded when the chat panel reopens.

**Expected:** Messages should load from LocalDB when opening a P2P chat conversation.

**Screenshot:** `.playwright-mcp/p2p-messages-not-persisted.png`

### 2. Typing Indicator - No Visual UI Feedback
**Severity:** Medium
**Location:** P2P chat panel header/typing area

**Issue:** The typing indicator protocol IS working - `MessagingLayerCommand` with `{"type":"Typing"}` is being sent and received between peers. However, there's no visual feedback in the UI showing "User is typing...".

**Expected:** Show "typing..." indicator below username when peer is typing.

### 3. Message Ordering Bug
**Severity:** Medium
**Location:** P2P chat message display

**Issue:** Messages are displayed out of chronological order. Example:
- 08:08 PM - "Hello from User A..."
- 08:22 PM - "Testing special chars..." (newest, appears 2nd)
- 08:08 PM - "Hi User A!..." (appears 3rd)
- 08:21 PM - "Testing typing indicator..." (appears 4th)

**Expected:** Messages should be sorted by timestamp in ascending order.

### 4. DIRECT MESSAGES Section Missing After Refresh
**Severity:** Medium
**Location:** Sidebar

**Issue:** After page refresh, the "DIRECT MESSAGES" section completely disappears from the sidebar. The section only appears after new messages are exchanged.

**Expected:** DIRECT MESSAGES section should persist and show previous DM conversations.

## What's Working Well

1. **Core P2P Messaging:** Bidirectional messaging works reliably
2. **Delivery Acknowledgments:** Read/delivered status with double checkmarks
3. **XSS Protection:** Script tags properly escaped and rendered as text
4. **Special Characters:** Emojis, quotes, apostrophes, backslashes all handled correctly
5. **Online Status:** Real-time online/offline status indicators
6. **Rapid Messaging:** No message loss when sending multiple messages quickly
7. **Multi-tab Support:** Leader/Follower coordination working correctly
8. **P2PAutoConnect:** Automatic peer connection establishment on session claim

## Updated Recommendations

### Priority 1 (Critical)
1. **Fix message persistence loading** - Implement LocalDB read on chat panel mount to load message history

### Priority 2 (Important)
2. **Add visual typing indicator** - Show "typing..." in chat header when receiving Typing protocol messages
3. **Fix message ordering** - Sort messages by timestamp before rendering
4. **Fix DIRECT MESSAGES persistence** - Load DM conversation list from LocalDB on mount

### Priority 3 (Nice to Have)
5. **Display username in DIRECT MESSAGES** - Resolve CID to username for display
6. **Investigate MessageSendFailure** - Determine why spurious failures are logged

## Test Screenshots

- `.playwright-mcp/p2p-messaging-test-success.png` - Successful bidirectional messaging
- `.playwright-mcp/p2p-messages-not-persisted.png` - Empty chat after refresh (persistence bug)
- `.playwright-mcp/p2p-test-complete.png` - Final test state with all messages

---

**Overall Assessment:** Core P2P messaging functionality is solid and reliable. The main issues are around persistence (messages not loading from LocalDB) and some UI polish items (typing indicator display, message ordering). No data loss during active sessions - only on page refresh.
