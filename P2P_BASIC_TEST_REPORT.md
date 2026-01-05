# P2P Basic Test Report

**Date:** 2026-01-05
**Timestamp:** 1767648035
**Test Type:** P2P Basic Bidirectional Messaging Test

## Test Objective

Validate P2P messaging works correctly between two users:
1. Create 2 users and establish P2P connection
2. Send P2P message from User 1 to User 2 - verify receipt
3. Send P2P message from User 2 to User 1 - verify bidirectional messaging
4. Document UX issues and console warnings

## Accounts Created

| User | Username | CID | Tab |
|------|----------|-----|-----|
| User 1 | p2ptest1_1767648035 | 15627944488637335986 | Tab 0 |
| User 2 | p2ptest2_1767648035 | 5521168870191771248 | Tab 2 |

**Password:** test12345
**Workspace Location:** 127.0.0.1:12349

## Test Results

| Phase | Test | Status | Notes |
|-------|------|--------|-------|
| **Phase 0** | Prerequisites Check | PASS | All services running |
| **Phase 1** | Account Creation (User 1) | PASS | Workspace initialized as admin |
| **Phase 1** | Account Creation (User 2) | PASS | No initialization modal (correct) |
| **Phase 2** | P2P Peer Discovery | PASS | User 2 found in discovery list |
| **Phase 2** | P2P Connection Request | PASS | Request sent from User 1 |
| **Phase 2** | P2P Connection Accept | PASS | User 2 accepted, PeerConnectSuccess |
| **Phase 3** | Message User1 -> User2 | PASS | "Hello from user1!" delivered at 04:27 PM |
| **Phase 3** | Message Receipt (User 2) | PASS | Message appeared on LEFT side with timestamp |
| **Phase 3** | Message User2 -> User1 | PARTIAL | "Hello back from user2!" sent at 04:29 PM |
| **Phase 3** | Message Receipt (User 1) | ISSUE | Message NOT displayed in User 1's chat view |

## Overall Result: PARTIAL PASS

Basic P2P messaging works (User 1 -> User 2 direction confirmed). However, there is a UI synchronization issue where User 1's chat view did not display the reply from User 2, even though the message was successfully sent from User 2's side (confirmed by logs showing `Message sent successfully in 62ms`).

## Key Findings

### P2P Connection Established Successfully

Both users successfully established a P2P connection:

```
getPeersForSession(15627944...): 1 peers [55211688...]
getPeersForSession(55211688...): 1 peers [15627944...]
PeerConnectSuccess
```

### Message Delivery (User 1 -> User 2) - SUCCESS

The first message from User 1 to User 2 was delivered successfully:

```
[P2P] *** sendMessage ENTRY *** recipientCid=55211688..., content="Hello from user1!"
P2P message received: 258 bytes
P2P MessageNotification received from peer: 15627944488637335986 for session: 5521168870191771248
```

User 2's view correctly showed the message on the LEFT side (received messages).

### Message Delivery (User 2 -> User 1) - PARTIAL SUCCESS

The reply from User 2 was sent successfully but not displayed in User 1's view:

**Sender logs (User 2):**
```
[P2P] *** sendMessage ENTRY *** recipientCid=15627944..., content="Hello back from user..."
[P2P] Sending to 15627944488637335986 without CheckState confirmation
[P2P] Message 54d3d7ef-f3f3-401d-ba5a-25b3e986a585 sent successfully in 62ms
```

**Issue:** The message was sent but User 1's chat view only showed their original outgoing message, not the received reply.

### UI Synchronization Issue Identified

When Tab 2 (User 2) was opened via URL navigation, it triggered a complex session state involving:
1. CheckState handshake timeout
2. Message sent without CheckState confirmation
3. Tab was "Follower" not "Leader"

The warning `getPeersForSession(55211688...): 0 peers (none)` appeared multiple times for User 2's session after navigation, suggesting P2P state may have been lost during tab switching.

## Screenshots Captured

| Screenshot | Description | Path |
|------------|-------------|------|
| 01-user1-workspace.png | User 1 workspace after initialization | `.playwright-mcp/01-user1-workspace.png` |
| 02-user2-workspace.png | User 2 workspace loaded | `.playwright-mcp/02-user2-workspace.png` |
| 03-user1-sends-invite.png | User 1 sending P2P connection request | `.playwright-mcp/03-user1-sends-invite.png` |
| 04-user2-accepts.png | User 2 accepting connection request | `.playwright-mcp/04-user2-accepts.png` |
| 05-message-sent-user1.png | Message sent from User 1 | `.playwright-mcp/05-message-sent-user1.png` |
| 06-message-received-user2.png | User 2 received message from User 1 | `.playwright-mcp/06-message-received-user2.png` |
| 07-message-sent-user2.png | User 2 sent reply (both messages visible) | `.playwright-mcp/07-message-sent-user2.png` |
| 08-user1-final.png | User 1 view - missing reply from User 2 | `.playwright-mcp/08-user1-final.png` |

## UX/UI Issues Discovered

| Severity | Issue | Details |
|----------|-------|---------|
| **HIGH** | Bidirectional message display issue | User 1 did not see reply from User 2, even though it was sent successfully |
| Medium | CheckState timeout | "CheckState timeout for peer, proceeding with send anyway" |
| Medium | Tab navigation disrupts P2P state | `getPeersForSession` returned 0 peers after tab navigation |
| Low | React Router Future Flag Warnings | Deprecation warnings about v7 migration flags |
| Low | WASM Initialization | "using deprecated parameters for the initialization function" |

## Console Warnings/Errors

### Critical Warnings

| Warning | Frequency | Impact |
|---------|-----------|--------|
| `[P2P] CheckState timeout for X, proceeding with send anyway` | Multiple | Messages sent without peer state confirmation |
| `[P2P][WasmPeerBridge] CALL #X getPeersForSession(55211688...): 0 peers (none)` | Many | P2P state lost on Tab 2 after navigation |
| `[InstanceInboundRouter] No instance owns CID 0, message may be lost` | Multiple | Potential message routing issues |

### Expected/Benign Warnings

| Warning | Explanation |
|---------|-------------|
| `ServerAutoConnect: Skipping X (already active)` | Normal - sessions already connected |
| `BroadcastChannelService: leader-election` | Normal tab coordination |

## Key Metrics

| Metric | Value |
|--------|-------|
| Active Sessions | 6 (from previous tests + current) |
| P2P Connections | Active bidirectionally |
| Messages Sent (User 1 -> User 2) | 1 (delivered) |
| Messages Sent (User 2 -> User 1) | 1 (sent but not displayed) |
| Session Errors | 0 |
| Ratchet Errors | 0 |

## No "Ratchet does not exist" Errors

**IMPORTANT**: No "Ratchet does not exist" errors were observed during the entire test. This confirms the cryptographic ratchet state is properly maintained.

## Test Execution Timeline

1. **04:27 PM**: User 1 created (p2ptest1_1767648035)
2. **04:27 PM**: User 2 created (p2ptest2_1767648035)
3. **04:27 PM**: P2P Registration completed (User 1 invited, User 2 accepted)
4. **04:27 PM**: Message sent from User 1 "Hello from user1!"
5. **04:27 PM**: Message received by User 2 (confirmed via screenshot)
6. **04:29 PM**: Reply sent from User 2 "Hello back from user2!"
7. **04:29 PM**: User 2 shows both messages correctly
8. **04:30 PM**: User 1 view only shows sent message (missing reply)

## Conclusion

### What Works
1. **Account Creation**: Both accounts created successfully
2. **P2P Registration**: Connection established and accepted
3. **Unidirectional Messaging (User 1 -> User 2)**: Messages delivered and displayed correctly
4. **No Ratchet Errors**: Cryptographic state maintained

### What Needs Investigation
1. **Bidirectional Messaging Issue**: Messages from User 2 to User 1 are sent successfully but not displayed in User 1's view
2. **Tab Navigation P2P State**: Navigating between tabs appears to disrupt P2P connection state
3. **CheckState Handshake**: Timeouts occurring before message send

### Recommendations

1. **Investigate bidirectional message delivery**: The logs show messages are sent successfully, but not rendered in the recipient's view. This could be:
   - Message routing issue between tabs
   - React state not updating when receiving messages
   - BroadcastChannel not propagating MessageNotification to correct tab

2. **P2P state synchronization on tab switch**: When a user switches tabs, the P2P connection state should be properly synchronized

3. **CheckState handshake reliability**: The CheckState timeout suggests peer state verification is failing, though messages are still delivered

The basic P2P infrastructure is working, but there are UI/state synchronization issues that need to be addressed for reliable bidirectional messaging in multi-tab scenarios.
