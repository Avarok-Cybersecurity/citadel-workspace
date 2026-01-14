# P2P Registration UI Fix Test Report

**Test Date:** December 3, 2025
**Test Time:** 19:56 UTC
**Tester:** Automated UI Test (Playwright MCP)
**Timestamp:** 1764791656

---

## Executive Summary

**RESULT: FAILED** - The updated UI fix with debug logging **did not resolve the P2P registration Accept timeout issue**.

The test successfully:
1. Created two test accounts (p2pv2_a and p2pv2_b)
2. Sent P2P connection request from p2pv2_b to p2pv2_a
3. Attempted to accept the request from p2pv2_a
4. Captured detailed debug logs showing the matching logic

**Root Cause Identified:** The `matchesByCid` logic in `acceptRequest()` is **comparing the wrong CIDs**. When accepting a request, the PeerConnectNotification contains the **acceptor's CID** (our own CID), but the matching logic is looking for the **requester's CID** (target peer CID).

---

## Test Accounts Created

| User | Username | CID | Role |
|------|----------|-----|------|
| User A | p2pv2_a | 3061545840112020501 | **Acceptor** (receives and accepts request) |
| User B | p2pv2_b | 1540249320964392154 | **Requester** (sends connection request) |

---

## Test Flow Executed

### Phase 1: Account Creation ✅
1. Created p2pv2_a account successfully
2. Created p2pv2_b account successfully
3. Both accounts loaded workspaces without errors

### Phase 2: P2P Connection Request ✅
1. p2pv2_b opened Peer Discovery modal
2. p2pv2_b clicked "Connect" for p2pv2_a
3. Request sent successfully - toast notification: "Request Sent"
4. p2pv2_b's UI showed "Awaiting Response..." button

### Phase 3: Switch to p2pv2_a ✅
1. Navigated to landing page
2. Clicked on p2pv2_a workspace session
3. Successfully switched to p2pv2_a
4. Badge showed "1 pending connection request"

### Phase 4: Accept Request ❌ FAILED
1. Clicked on pending request badge
2. Pending Requests modal opened showing:
   - p2pv2_b requesting to connect
   - CID: 15402493...
   - **Timestamp: "1 minute ago"** (Fix #5 verified - relative timestamp working!)
3. Clicked "Accept" button
4. **ERROR**: "Failed to Accept - Registration request timed out"

---

## Console Logs Analysis

### Key Debug Logs Captured

```
[LOG] PeerRegistrationStore: acceptRequest waiting for response {
  registerRequestId: 0045831a-f88d-4e28-a842-aa1103a34e8f,
  targetPeerCid: 1540249320964392154,  ← p2pv2_b (requester)
  targetNormalized: 0964392154
}

[LOG] PeerRegistrationStore: Claiming session 3061545840112020501 before sending PeerRegister

[LOG] [websocket] Sending ClaimSession request with CID: 3061545840112020501

[LOG] ConnectionManager: Successfully claimed session 3061545840112020501 (updated 1 related sessions)

[LOG] [websocket] Sending message to internal service {
  "PeerRegister": {
    "request_id": "0045831a-f88d-4e28-a842-aa1103a34e8f",
    "cid": 3061545840112020500,
    "peer_cid": 1540249320964392200,  ← p2pv2_b (target)
    "session_security_settings": {...},
    "connect_after_register": true,
    "peer_session_password": null
  }
}

[LOG] InternalServiceWasmClient: Received message: {
  "PeerConnectNotification": {
    "cid": 1540249320964392200,  ← p2pv2_b (WRONG!)
    "peer_cid": 3061545840112020500,  ← p2pv2_a (our own CID!)
    "request_id": null,
    ...
  }
}

[LOG] PeerRegistrationStore: Checking response match {
  messageType: PeerConnectNotification,
  responsePeerCid: 3061545840112020501,  ← p2pv2_a (our CID)
  responseNormalized: 0112020501,
  targetNormalized: 0964392154,  ← p2pv2_b (requester CID)
  matchesByRequestId: false  ← NO MATCH!
}

[LOG] InternalServiceWasmClient: Received message: {
  "PeerConnectFailure": {
    "cid": 3061545840112020500,
    "message": "P2P connection timed out after 30 seconds",
    "request_id": "0045831a-f88d-4e28-a842-aa1103a34e8f"
  }
}
```

---

## Root Cause Analysis

### The Bug

The `matchesByCid` function in `acceptRequest()` (peer-registration-store.ts:399) is checking:

```typescript
const matchesByCid =
  normalizeCid(response.peer_cid) === normalizeCid(targetPeerCid);
```

**Problem:** When p2pv2_a accepts the request from p2pv2_b:
- `targetPeerCid` = `1540249320964392154` (p2pv2_b - the requester)
- `response.peer_cid` = `3061545840112020501` (p2pv2_a - our own CID!)

**Expected Behavior:** The PeerConnectNotification should contain the **requester's CID** in the `peer_cid` field when the acceptor receives it.

**Actual Behavior:** The PeerConnectNotification contains the **acceptor's CID** in the `peer_cid` field.

### Why the Match Fails

```
Waiting for:  targetNormalized: 0964392154 (p2pv2_b)
Received:     responseNormalized: 0112020501 (p2pv2_a)
Result:       0112020501 !== 0964392154 → NO MATCH → TIMEOUT
```

### Backend Investigation Needed

The PeerConnectNotification structure appears to be:
```rust
PeerConnectNotification {
  cid: u64,       // The peer's CID (requester in this case)
  peer_cid: u64,  // Our CID (acceptor in this case)
  ...
}
```

**Question for backend team:** Is this the intended field mapping? Or should `peer_cid` contain the **other peer's CID** from our perspective?

---

## Fix Verification Status

| Fix # | Description | File | Status | Notes |
|-------|-------------|------|--------|-------|
| 1 | Self-echo filter | p2p-messenger-manager.ts:290-296 | ⚠️ Not Tested | Could not reach messaging phase due to registration failure |
| 2 | RecipientCid threading | p2p-messenger-manager.ts:200-438 | ⚠️ Not Tested | Could not reach messaging phase due to registration failure |
| 3 | PeerConnectSuccess handler | peer-registration-store.ts:839-853 | ⚠️ Not Tested | Could not verify badge clearing due to registration failure |
| 4 | Notification integration | p2p-messenger-manager.ts:420-434 | ⚠️ Not Tested | Could not reach messaging phase due to registration failure |
| 5 | Date-fns timestamps | PendingRequestsModal.tsx:93-105 | ✅ **PASS** | Timestamp showed "1 minute ago" correctly |

---

## Updated UI Fix Effectiveness

The updated UI fix added:
1. ✅ `matchesByCid` function to compare by CID
2. ✅ `normalizeCid()` to handle JavaScript precision loss (last 10 digits)
3. ✅ Debug logging showing matching logic

**Debug logs successfully captured:**
```
PeerRegistrationStore: Checking response match {
  messageType: PeerConnectNotification,
  responsePeerCid: 3061545840112020501,
  responseNormalized: 0112020501,
  targetNormalized: 0964392154,
  matchesByRequestId: false
}
```

**However:** The matching logic itself is **fundamentally flawed** because it's comparing the wrong CIDs.

---

## Proposed Solution

### Option 1: Fix Frontend Matching Logic (Recommended)

Change `acceptRequest()` in `peer-registration-store.ts` to match using the **notification's `cid` field** instead of `peer_cid`:

```typescript
// Current (WRONG):
const matchesByCid =
  normalizeCid(response.peer_cid) === normalizeCid(targetPeerCid);

// Proposed (CORRECT):
const matchesByCid =
  normalizeCid(response.cid) === normalizeCid(targetPeerCid);
```

**Rationale:** The PeerConnectNotification's `cid` field contains the **other peer's CID** (p2pv2_b), which is what we're waiting for.

### Option 2: Fix Backend Field Mapping

If the backend is using the wrong field mapping, update `citadel-internal-service` to ensure:
- `PeerConnectNotification.peer_cid` contains the **other peer's CID** (from our perspective)
- Not our own CID

---

## Screenshots

### 1. p2pv2_a Workspace Loaded
![User A Workspace](/Volumes/nvme/Development/avarok/citadel-workspace/.playwright-mcp/01-p2pv2-a-workspace-loaded.png)

### 2. Registration Timeout Error
![Registration Timeout](/Volumes/nvme/Development/avarok/citadel-workspace/.playwright-mcp/02-p2p-registration-timeout-error.png)

Shows:
- Pending Requests modal open
- p2pv2_b requesting to connect
- Timestamp: "1 minute ago" (Fix #5 working!)
- Accept and Decline buttons enabled
- Toast error: "Failed to Accept - Registration request timed out"

---

## Errors Captured

### Frontend Errors
1. **Registration Timeout**: "Failed to Accept - Registration request timed out"
2. **ListRegisteredPeers timeouts** (unrelated to main issue)

### Backend Errors
None captured in logs for this test.

---

## Backend Log Excerpts

Not checked in this test. Focus was on frontend debug logs showing the matching logic.

---

## Next Steps

1. **Implement Option 1** (fix frontend matching logic) as immediate solution
2. **Re-run this test** to verify Accept now succeeds
3. **Continue with messaging tests** to verify Fixes #1, #2, #3, #4
4. **Investigate backend** to understand why `peer_cid` contains our own CID instead of the other peer's CID

---

## Test Artifacts

- **Screenshots**:
  - `/Volumes/nvme/Development/avarok/citadel-workspace/.playwright-mcp/01-p2pv2-a-workspace-loaded.png`
  - `/Volumes/nvme/Development/avarok/citadel-workspace/.playwright-mcp/02-p2p-registration-timeout-error.png`
- **Console Logs**: Captured in full (see Console Logs Analysis section)
- **Test Accounts**: p2pv2_a (CID: 3061545840112020501), p2pv2_b (CID: 1540249320964392154)

---

## Overall Result

**FAILED** - The Accept button still times out due to incorrect CID matching logic.

**Fix #5 (Timestamps)** is the only fix that could be verified and is working correctly.

The root cause has been identified and a solution proposed. Once the matching logic is corrected, the full test suite (all 5 fixes) can be re-run.
