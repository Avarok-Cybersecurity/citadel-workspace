# P2P Messaging Test Report

**Date:** 2025-12-03
**Test Environment:** Multi-tab single browser (localhost:5173)
**Users:** p2ptest1, p2ptest2, p2ptest3

---

## Executive Summary

**Result: ❌ P2P MESSAGING BLOCKED BY CRITICAL BUG**

P2P messaging cannot function because the Citadel P2P protocol requires establishing a direct peer-to-peer channel via NAT traversal, which times out after 30 seconds when both peers are in the same browser/NAT.

---

## Test Results

### Phase 1: Account Setup ✅ PASS
- Created 3 accounts: p2ptest1, p2ptest2, p2ptest3
- All accounts connected to workspace server successfully
- OrphanSessionsNavbar shows all 3 active sessions

### Phase 2: P2P Registration ✅ PASS (Partially)
| Test | Status | Notes |
|------|--------|-------|
| user1 → user2 PeerRegister | ✅ PASS | Request sent successfully |
| user1 → user3 PeerRegister | ✅ PASS | Request sent successfully |
| user2 accepts user1 | ✅ PASS | Registration accepted (with UI bug) |
| user2 → user3 PeerRegister | ✅ PASS | Request sent |

**Bug Found:** Badge "1" persists after accepting request (UI not updated)

### Phase 3: Basic Messaging ❌ BLOCKED
| Test | Status | Error |
|------|--------|-------|
| user2 → user1 message | ❌ FAIL | `MessageSendFailure: "Connection for 1037731213400421288 not found"` |

**Root Cause:** `peer_connections` map is empty because PeerConnect timed out.

### Phase 4-6: Not Tested
Blocked by Phase 3 failure.

---

## Critical Bug Analysis

### BUG #1: Badge Persistence (Minor)
**Symptom:** After clicking "Accept" on pending P2P request, badge "1" still shows
**Location:** PendingConnectionsButton.tsx / PeerDiscoveryModal.tsx
**Impact:** UI confusion, but functionality works
**Fix Priority:** Low

### BUG #2: PeerConnect Timeout (CRITICAL)
**Symptom:** P2P messaging fails with "Connection not found"
**Root Cause:**

```
[PeerConnect] connect_to_peer_custom TIMED OUT after 30 seconds
PeerConnectFailure: "P2P connection timed out after 30 seconds"
```

**Technical Details:**
1. `PeerRegister` succeeds - peers are in each other's contact lists ✅
2. `PeerConnect` is called to establish direct P2P channel
3. P2P uses NAT hole-punching which fails when:
   - Both peers are behind the same NAT (same browser)
   - STUN/TURN servers are not configured/accessible
   - Docker networking blocks P2P ports
4. After 30s timeout, `peer_connections` map stays empty
5. Message send checks `conn.peers.get_mut(&peer_cid)` → fails

**Code Path:**
```
message.rs:34 → conn.peers.get_mut(&peer_cid) → None → "Connection not found"
```

**Evidence from logs:**
```
GetSessionsResponse {
  sessions: [
    SessionInformation { cid: ..., peer_connections: {} },  // EMPTY!
    SessionInformation { cid: ..., peer_connections: {} },  // EMPTY!
    SessionInformation { cid: ..., peer_connections: {} }   // EMPTY!
  ]
}
```

---

## Architectural Issue

The current P2P implementation assumes:
1. Peers need direct P2P connection for messaging
2. NAT traversal will succeed

But in a **multi-tab single-browser** setup:
- All tabs share ONE WebSocket to internal-service
- Internal-service has ALL sessions in `server_connection_map`
- Direct P2P is unnecessary - messages could route through internal-service

**Proposed Solutions:**

1. **Server-Relay Fallback:** When PeerConnect fails, route messages through the server
2. **Intra-Process Detection:** Detect when both peers are on same internal-service, skip P2P
3. **Hybrid Routing:** Use direct P2P when available, server relay otherwise

---

## Screenshots

| Screenshot | Description |
|------------|-------------|
| `p2p-test-message-send-failure.png` | Message appeared in UI with ✓ but backend returned failure |
| `p2p-test-bug-badge-persists-after-accept.png` | Badge "1" visible after accepting request |
| `p2p-test-phase2-user1-shows-connected.png` | Peer Discovery shows "Connected" (misleading) |

---

## Console Logs

### Message Send Attempt
```javascript
[P2P] sendP2PMessage called with: {cid: 1037731213400421288, targetCid: 6730932744337814965}
[P2P] CheckState timeout for 6730932744337814965, proceeding with send anyway
[P2P] Sending to 6730932744337814965 without CheckState confirmation

// Backend response:
MessageSendFailure: {
  cid: 1037731213400421288,
  message: "Connection for 1037731213400421288 not found"
}
```

### Server Logs
```
[PeerConnect] Received request: cid=1037731213400421288, peer_cid=6730932744337814965
[PeerConnect] find_target succeeded, calling connect_to_peer_custom with 30s timeout...
[PeerConnect] connect_to_peer_custom TIMED OUT after 30 seconds
PeerConnectFailure: "P2P connection timed out after 30 seconds"
```

---

## Recommendations

1. **Immediate:** Implement server-relay fallback for P2P messages
2. **Short-term:** Add detection for same-internal-service peers
3. **Long-term:** Review P2P architecture for containerized/NAT environments

---

## Test Checklist Summary

| Phase | Test | Status |
|-------|------|--------|
| 1 | Account creation | ✅ PASS |
| 2 | P2P registration | ✅ PASS |
| 2 | P2P connection | ❌ FAIL (30s timeout) |
| 3 | Basic messaging | ❌ BLOCKED |
| 4 | Message status | ❌ BLOCKED |
| 5 | Background tab handling | ❌ BLOCKED |
| 6 | Retry functionality | ❌ BLOCKED |

**Overall Result: P2P messaging is non-functional due to PeerConnect timeout**
