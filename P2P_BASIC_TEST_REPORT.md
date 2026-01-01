# P2P Basic Test Report

**Date:** 2025-12-30
**Timestamp:** 1767145425 (Tenth Test Run - WebSocket Stability & Ratchet Issue Investigation)
**Previous Tests:** 1767116718, 1767117890, 1767119011, 1767120295, 1767138623, 1767139596, 1767140756, 1767141450, 1767143134

## Accounts Used
- **User 1 (Alice):** alice_1767144257 (CID: 2140228971562830034) - Tab 0
- **User 2 (Bob):** bob_1767144257 (CID: 4926344781773734389) - Tab 1
- Server: 127.0.0.1:12349
- Password: test12345

## Test Results

| Test | Status | Notes |
|------|--------|-------|
| Account Creation (Alice) | PASS | Used existing account from previous test |
| Account Creation (Bob) | PASS | Used existing account from previous test |
| P2P Registration | PASS | Already registered from previous session |
| P2P Connection Establishment | PASS | Auto-connected; Bob shows "Online" status |
| Message Alice -> Bob (Send) | PASS | Message "Hello from Alice!" sent successfully |
| Message Alice -> Bob (Receive) | **FAIL** | Message NOT received - **CRITICAL: WebSocket died on leader tab** |
| Message Bob -> Alice | NOT TESTED | WebSocket connection lost before testing |

## CRITICAL FINDINGS

### 1. Cryptographic Ratchet Version Mismatch

**ERROR from internal-service logs:**
```
Attempted to get ratchet v9 for cid=4926344781773734389, but does not exist! len: 1. Oldest: 0. Newest: 0
Attempted to get ratchet v8 for cid=4926344781773734389, but does not exist! len: 1. Oldest: 0. Newest: 0
```

The system is trying to access ratchet versions 8 and 9 for Bob's session, but only version 0 exists. This indicates a cryptographic key synchronization failure.

### 2. PANIC in Internal Service

**CRITICAL ERROR:**
```
Panic occurred: panicked at /usr/local/cargo/git/checkouts/citadel-protocol-5ed557508e8a0da8/7a040b2/citadel_proto/src/proto/session.rs:2254:18:
called `Option::unwrap()` on a `None` value
```

This panic caused the WebSocket connection to die, which explains why:
- Messages stopped being delivered
- The leader tab became unresponsive
- All P2P connections failed with "channel closed" errors

### 3. WebSocket Connection Death

**Console errors observed:**
```
Error sending WebSocket message: ConnectionNotOpen
WebSocket communication task ended
Failed to send message to WebSocket channel: SendError { .. }
PeerConnect request timed out (multiple occurrences)
ListAllPeers request timed out
ConnectionManager: Failed to get active sessions Failed to send message: channel closed
```

### 4. Connection Retry Attempts Failed

The P2PAutoConnect service attempted retries with exponential backoff:
```
P2PAutoConnect: Connect failed for 21402289..., retry in 1s (attempt 1)
P2PAutoConnect: Connect failed for 21402289..., retry in 2s (attempt 2)
P2PAutoConnect: Connect failed for 21402289..., retry in 4s (attempt 3)
P2PAutoConnect: Connect failed for 21402289..., retry in 8s (attempt 4)
P2PAutoConnect: Connect failed for 21402289..., retry in 16s (attempt 5)
P2PAutoConnect: Connect failed for 21402289..., retry in 32s (attempt 6)
```

All retries failed because the underlying WebSocket was dead.

## Console Log Analysis

### Message Send (Successful from Alice's perspective):
```
[P2P] *** sendMessage ENTRY *** recipientCid=49263447..., content="Hello from Alice!..."
Peer 4926344781773734389 already connected, skipping registration
[P2P] Peer already marked as ready: 4926344781773734389
[P2PChat] onMessage received: {messageId: 97d21b6a, messageType: text, senderCid: 214022897156...
[P2P] Sending message 97d21b6a-c372-47ee-be3f-fd8e4e59cd3e to 49263447...
Sending reliable P2P message from 2140228971562830034 to 4926344781773734389
Reliable P2P message sent from 2140228971562830034 to 4926344781773734389
[P2P] Message 97d21b6a-c372-47ee-be3f-fd8e4e59cd3e sent successfully in 14ms
```

### Message Receive (Failed on Bob's side):
The message was never received because:
1. The ratchet version mismatch occurred during P2P operations
2. A panic crashed the protocol layer
3. The WebSocket connection died
4. All subsequent message routing failed

## UX/UI Issues Discovered

| Severity | Issue |
|----------|-------|
| **CRITICAL** | Panic in citadel_proto session.rs:2254 causes complete WebSocket failure |
| **CRITICAL** | Ratchet version mismatch (v8/v9 requested but only v0 exists) |
| **HIGH** | No automatic WebSocket reconnection after panic |
| **HIGH** | Leader tab becomes completely unresponsive after WebSocket death |
| **MEDIUM** | Page hangs requiring manual refresh after WebSocket failure |
| Low | React Router Future Flag Warnings |
| Low | Deprecated WASM initialization parameters |

## Root Cause Analysis

### Primary Issue: Cryptographic Ratchet Desynchronization

The P2P connection between Alice and Bob had a cryptographic key synchronization issue:
1. Bob's session (CID 4926344781773734389) has only ratchet version 0
2. The system attempted to access versions 8 and 9
3. This caused an `unwrap()` on `None` in session.rs:2254
4. The panic propagated and killed the WebSocket connection

### Why This Happened

Possible causes:
1. **Session persistence issue** - Ratchet state not properly persisted across reconnections
2. **Re-keying failure** - The automatic re-keying process may have failed silently
3. **Orphan session state** - When sessions go into orphan mode, ratchet state may not be preserved
4. **Multiple connection attempts** - Frequent connect/disconnect cycles may desync the ratchet

## Backend Logs Summary

```
[ListAllPeers] Handling request for cid=4926344781773734389
[ListAllPeers] Calling get_local_group_peers for cid=4926344781773734389
GetSessions: Found 14 total sessions in server_connection_map
ERROR: Attempted to get ratchet v9 for cid=4926344781773734389, but does not exist!
ERROR: Attempted to get ratchet v8 for cid=4926344781773734389, but does not exist!
ERROR: Panic occurred at session.rs:2254:18: called `Option::unwrap()` on a `None` value
```

## Test History Summary

| Test Run | Timestamp | Direction Tested | Result | Root Cause |
|----------|-----------|------------------|--------|------------|
| 1-6 | Various | Both | Mixed | Various issues |
| 7 | 1767140756 | Both | Asymmetric | Delivery issue |
| 8 | 1767141450 | Both | Asymmetric | Delivery issue |
| 9 | 1767143134 | Both | Asymmetric | Delivery issue |
| **10** | **1767145425** | **Alice->Bob** | **FAIL** | **Ratchet panic** |

## Recommendations

### Immediate Fixes Required

1. **Fix the unwrap() panic in session.rs:2254**
   - Add proper error handling instead of `.unwrap()`
   - Return an error or use `.unwrap_or_default()` with logging

2. **Handle ratchet version mismatches gracefully**
   - When requested ratchet version doesn't exist, trigger re-keying
   - Add fallback to oldest available ratchet version

3. **Add WebSocket reconnection logic**
   - Detect WebSocket death and automatically reconnect
   - Preserve session state during reconnection

### Investigation Needed

1. **Why is ratchet v0 the only version?**
   - Check if re-keying is being triggered
   - Verify ratchet state is persisted correctly

2. **Why does orphan mode affect ratchet state?**
   - Review how orphan sessions preserve cryptographic state
   - Ensure reconnection restores proper ratchet versions

3. **Multi-tab ratchet coordination**
   - Verify each tab/session has correct ratchet state
   - Check for race conditions in ratchet updates

## Overall Result: **FAIL**

The test revealed a **critical bug** in the Citadel protocol layer where a ratchet version mismatch causes a panic that kills the entire WebSocket connection, making P2P messaging impossible.

---

## Files Referenced

- `/usr/local/cargo/git/checkouts/citadel-protocol-5ed557508e8a0da8/7a040b2/citadel_proto/src/proto/session.rs:2254`
- `/usr/local/cargo/git/checkouts/citadel-protocol-5ed557508e8a0da8/7a040b2/citadel_crypt/src/toolset.rs:252`
