# P2P Basic Test Report

**Date:** 2025-12-24
**Timestamp:** 1766628128
**SDK Commit:** 868f119c (prevents redundant connection attempts)

## Accounts Created
- User 1: p2ptest1_1766628128
- User 2: p2ptest2_1766628128

## Test Results

| Test | Status | Notes |
|------|--------|-------|
| Account Creation | PASS | Both accounts created successfully |
| Workspace Load | PASS | No "Initialize Workspace" modal for User 2 |
| P2P Registration Send | PASS | Request sent from User 1 to User 2 |
| P2P Registration Accept | PASS | User 2 accepted request, notification shown |
| PeerConnect | FAIL | Peer connections not being established |
| Message User1->User2 | NOT TESTED | Blocked by PeerConnect failure |
| Message User2->User1 | NOT TESTED | Blocked by PeerConnect failure |

## SDK Fix Verification

**CONFIRMED WORKING:** The SDK fix (commit 868f119c) is preventing "Session Already Connected" errors during the initial connection phase.

**Evidence:**
- No "Session Already Connected" errors during account creation
- Both users successfully registered and connected to workspace
- P2P registration (PeerRegister) succeeded on both sides

## Issue Found: PeerConnect Not Populating conn.peers

### Problem
After P2P registration, the `conn.peers` HashMap remains empty. This prevents P2P messages from being sent.

### Logs Showing the Issue

```
[P2P-MSG] Sending message from 9024291364759186747 to peer 11374561820947984246
[P2P-MSG] Available peers in conn.peers: []
[P2P-MSG] Peer connection not found for peer_cid=11374561820947984246
```

```
GetSessionsResponse shows:
- p2ptest1_1766628128 (CID 11374561820947984246): peer_connections: {}
- p2ptest2_1766628128 session disconnected during accept flow
```

### Root Cause Analysis

1. **PeerRegisterNotification** is received successfully by both peers
2. **PeerConnectNotification** is received, triggering auto-connect
3. **PeerConnect request times out** - the backend doesn't establish the actual peer channel
4. The `conn.peers` map in internal-service never gets populated

### Console Warnings
```
P2PAutoConnect: Local connectedPeers has 11374561... but backend shows not connected
ServerAutoConnect: Connection failure: Session Already Connected
P2PAutoConnect: Failed to establish reverse channel to 11374561...: Error: PeerConnect request timed out
P2PAutoConnect: Connect failed for 11374561..., retry in 1s (attempt 1)
```

## UX/UI Issues Discovered

| Severity | Issue |
|----------|-------|
| Medium | "CONNECTED PEERS" shows logged-in user's name instead of actual connected peers |
| Low | Peers from old sessions (667440) remain in sidebar after sessions are gone |
| Medium | After P2P accept, session gets disconnected (possible session claim race) |

## Screenshots Captured

1. `01-user1-workspace.png` - User 1 logged into workspace
2. `02-user2-workspace.png` - User 2 logged into workspace
3. `03-user1-sends-invite.png` - P2P discovery modal with "Awaiting Response"
4. `04-user2-accepts.png` - User 2 after accepting connection

## Overall Result: PARTIAL PASS

**What Works:**
- Account creation (SDK fix confirmed)
- P2P registration flow (PeerRegister/PeerRegisterNotification)
- UI notifications for connection requests

**What Fails:**
- PeerConnect not establishing actual peer channels
- conn.peers map stays empty
- P2P messaging cannot be tested

## Comparison with Previous Test (1766627106)

| Aspect | Previous Test | Current Test |
|--------|---------------|--------------|
| Account Creation | PASS | PASS |
| P2P Registration | PASS | PASS |
| PeerConnect | Succeeded (had peer_connections) | FAIL (empty peer_connections) |
| Messaging | PARTIAL (sent but not received) | NOT TESTED |

**Key Difference:** In the previous test, `peer_connections` was populated in the GetSessionsResponse. In this test, `peer_connections: {}` for the new users while old sessions still show their peer connections.

## Next Steps

1. **Investigate PeerConnect handler** in `citadel-internal-service/src/kernel/requests/peer_connect.rs`
   - Verify it's correctly populating `conn.peers`
   - Check if the peer is online when PeerConnect is called

2. **Check SDK PeerConnect implementation**
   - The SDK updated (868f119c) prevents redundant connections but may have affected PeerConnect

3. **Verify timing between PeerRegister and PeerConnect**
   - PeerRegisterNotification triggers auto-connect immediately
   - May need a delay or confirmation before attempting PeerConnect

4. **Review session claim during P2P accept**
   - Session disconnection during accept flow suggests race condition
   - ClaimSession before PeerRegister may be disrupting the connection
