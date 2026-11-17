# P2P Basic Test Report

**Date:** 2026-01-22
**Timestamp:** 1769092410
**Test Type:** Basic P2P Messaging (2 Users)

## Accounts Created

| User | Username | CID | Tab Role |
|------|----------|-----|----------|
| Alice | p2palice_1769092410 | 1087410467696734588 | Tab 0 (Leader) |
| Bob | p2pbob_1769092410 | 4519690157514980889 | Tab 1 (Follower) |

**Password:** test12345
**Workspace Admin Password:** SUPER_SECRET_ADMIN_PASSWORD_CHANGE_ME

## Test Results

| Test | Status | Notes |
|------|--------|-------|
| Account Creation (Alice) | PASS | First user, initialized workspace |
| Account Creation (Bob) | PASS | Second user, no init modal shown |
| P2P Registration (Alice -> Bob) | PASS | Alice sent request via Discover Peers |
| P2P Acceptance (Bob accepts) | PASS | Bob accepted via Pending Connection Requests |
| Message User1 -> User2 | PASS | "Hello from Alice!" delivered in 43ms |
| Message User2 -> User1 | PASS | "Hello back from Bob!" delivered in 6ms |
| Message Delivery Receipts | PASS | Status transitions: sent -> delivered -> read |
| MessageNotification Routing | PASS | CID-based routing working correctly |

## MessageNotification Routing Verification

The primary objective of this test was to verify that `MessageNotification` routing works correctly after adding it to the `CID_ROUTED_NOTIFICATIONS` set in `instance-inbound-router.ts`.

**Console Evidence:**
```
[ILM-Router] MessageNotification uses CID routing, skipping request_id extraction
[ILM-Router] Routing MessageNotification (CID: 4519690157514980889)
P2P MessageNotification received from peer: 1087410467696734588 for session: 45196901575149808...
[P2P] handleMessageAck FOUND message, updating status: sent -> delivered
[P2P] handleMessageAck FOUND message, updating status: delivered -> read
```

**Conclusion:** MessageNotification CID routing is working as expected. Messages are correctly routed to the appropriate tab/session based on the CID in the notification.

## UX/UI Issues Discovered

| Severity | Issue |
|----------|-------|
| Low | React Router v7 future flag warnings (expected, not a bug) |
| Low | "Key not found" warnings for first-time LocalDB access (expected behavior) |
| Low | Deprecated WASM initialization parameters warning |

**Note:** No critical UX issues discovered. The P2P registration, acceptance, and messaging flows all worked smoothly.

## Console Warnings/Errors

**Errors:** None

**Warnings (benign):**
1. React Router Future Flag warnings for v7 migration preparation
2. PeerRegistrationStore: Failed to load from LocalDB (expected on first use)
3. ServerAutoConnect: Failed to load enabled setting: Key not found (expected on first use)
4. WASM deprecated parameters warning (cosmetic)

## Screenshots

| Screenshot | Description |
|------------|-------------|
| 04-bob-accepts-request.png | Bob's view after accepting Alice's P2P registration |
| 05-message-sent-alice.png | Alice's chat showing sent message to Bob |
| 06-message-received-bob.png | Bob's chat showing received message from Alice |
| 07-message-sent-bob.png | Bob's chat showing reply sent to Alice |
| 08-bidirectional-complete-alice.png | Alice's view showing complete bidirectional conversation |

## Multi-Tab Architecture Observations

The test successfully verified the multi-tab leader/follower architecture:

1. **Leader Tab (Alice - Tab 0):** Manages WebSocket connection to internal service
2. **Follower Tab (Bob - Tab 1):** Receives updates via BroadcastChannel from leader
3. **CID Routing:** Messages correctly routed to appropriate session based on notification CID
4. **Session Isolation:** Each user's messages appear in their respective conversation views

## Overall Result: PASS

All test objectives were met:
- Both accounts created successfully
- P2P registration completed successfully
- Bidirectional messaging verified (Alice -> Bob and Bob -> Alice)
- MessageNotification CID routing confirmed working
- No blocking errors or UX issues discovered

---

## Historical Test Results

### Previous Test (2026-01-18)
- **Result:** FAIL
- **Issue:** `PeerRegisterRespond` request type was missing in backend
- **Resolution:** Backend handler was subsequently implemented

### Current Test (2026-01-22)
- **Result:** PASS
- **Notes:** Full P2P flow working end-to-end including MessageNotification CID routing
