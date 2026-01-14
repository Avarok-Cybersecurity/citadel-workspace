# P2P Messaging Testing Guide

## Overview

This guide documents how to test peer-to-peer (P2P) messaging functionality in the Citadel Workspace system, with special attention to the **multi-tab, single-WebSocket architecture**.

---

## Critical Architecture Understanding

### One Browser = One WebSocket

**IMPORTANT**: The system uses **ONE WebSocket connection per browser**, NOT per tab or per user.

```
Browser Window
  ├─ Tab 1: testuser1 logged in
  ├─ Tab 2: testuser2 logged in
  ├─ Tab 3: testuser3 logged in
  │
  └─ Leader Tab (elected automatically)
     └─ Single WebSocket → localhost:12345 (Internal Service)
        └─ Manages ALL sessions across ALL tabs
```

**Key Points**:
- Leader tab elected via BroadcastChannel/localStorage
- Follower tabs receive updates via broadcast from leader
- All user sessions in the browser share the single WebSocket
- Internal service manages multiple sessions via the same connection

**For Detailed Architecture**: See [ARCHITECTURE.md § Multi-Tab Coordination](./ARCHITECTURE.md#multi-tab-coordination)

---

## Testing Approach

### ✅ Correct: Single Browser, Multiple Tabs

```bash
# Open Tab 1
http://localhost:5173/ → Create testuser1

# Open Tab 2 (same browser)
http://localhost:5173/ → Create testuser2

# Test P2P between Tab 1 and Tab 2
# Both users share the same WebSocket connection
```

### ❌ Wrong: Multiple Browsers or Incognito

```bash
# DON'T DO THIS for local testing
Browser 1 → testuser1
Browser 2 (or incognito) → testuser2
```

**Why?** The multi-tab coordination is designed to work within a single browser. Using multiple browsers introduces unnecessary complexity and doesn't test the actual production architecture.

---

## P2P Testing Workflow

### Phase 1: Create Test Users

#### Tab 1: Create First User
1. Navigate to `http://localhost:5173/`
2. Fill in workspace connection:
   - Workspace: `127.0.0.1:12349`
   - Password: (leave empty)
3. Accept default security settings
4. Create user profile:
   - Full Name: `Test User One`
   - Username: `testuser1` (or timestamp-based)
   - Password: `test12345`
5. **First user only**: Initialize workspace with master password
6. Verify: Redirected to `/office` route

#### Tab 2: Create Second User
1. Open new tab (same browser)
2. Navigate to `http://localhost:5173/`
3. Repeat connection steps (same workspace)
4. Create user profile:
   - Full Name: `Test User Two`
   - Username: `testuser2`
   - Password: `test12345`
5. **Skip initialization**: Workspace already initialized
6. Verify: Redirected to `/office` route

**Expected State**:
- Both tabs logged in as different users
- Both sessions active in internal service
- Single WebSocket managing both sessions
- Leader tab elected (check browser DevTools → Application → BroadcastChannel)

---

### Phase 2: Peer Discovery

#### In Tab 1 (testuser1):
1. Navigate to `/office` if not already there
2. Look at left sidebar → "Direct Messages" section
3. Click the search/add peer button
4. Note: testuser2 should appear in available peers list

#### In Tab 2 (testuser2):
1. Navigate to `/office`
2. Check left sidebar → "Direct Messages"
3. Click search/add peer
4. Note: testuser1 should appear in available peers list

**Expected Behavior**:
- `ListAllPeers` request shows both users to each other
- Both users appear with real usernames (not "User 36414494...")
- Online status indicators show "online"

**Check Logs**:
```bash
tilt logs internal-service | grep -i "ListAllPeers"
```

**Expected Log Output**:
```
ListAllPeersResponse { cid: ..., peer_information: { ... } }
```

---

### Phase 3: Peer Registration

#### In Tab 1 (testuser1):
1. From available peers list, click on `testuser2`
2. Click "Add Peer" or similar action
3. Wait for registration to complete

**Expected Backend Flow**:
```
Tab 1 → Leader Tab → WebSocket → Internal Service
  │
  ├─ PeerRegister { peer_cid: testuser2_cid }
  │
Internal Service → Citadel Protocol
  │
  ├─ Mutual peer registration via Citadel SDK
  │
Internal Service → WebSocket → Leader Tab
  │
  ├─ PeerRegisterSuccess { peer_username: "testuser2" }
  │
  └─ PeerRegisterNotification { peer_username: "testuser1" } (to testuser2)
```

**Check Logs**:
```bash
tilt logs internal-service | grep -i "PeerRegister"
```

**Expected Log Output**:
```
PeerRegister request received
PeerRegisterSuccess { peer_username: "testuser2", ... }
PeerRegisterNotification { peer_username: "testuser1", ... }
```

**UI Verification**:
- Tab 1: testuser2 appears in "Direct Messages" list with real username
- Tab 2: testuser1 appears in "Direct Messages" list with real username
- Both show online status indicators

---

### Phase 4: P2P Connection

#### In Tab 1:
1. Click on testuser2 in "Direct Messages" sidebar
2. URL should change to include P2P parameters (e.g., `?showP2P=true&p2pUser=testuser2`)
3. P2PChat component should load

**Expected Backend Flow**:
```
Tab 1 → Leader → WebSocket → Internal Service
  │
  ├─ PeerConnect { peer_cid: testuser2_cid }
  │
Internal Service → Opens P2P channel via Citadel
  │
  └─ PeerConnectSuccess
```

**Check Logs**:
```bash
tilt logs internal-service | grep -i "PeerConnect"
```

**UI Verification**:
- Chat interface loads
- Shows peer username in header
- Message input field active
- No error messages

---

### Phase 5: P2P Messaging

#### Send Message from Tab 1 to Tab 2:
1. In Tab 1 (testuser1), type message: `Hello from testuser1`
2. Press Enter or click Send
3. Switch to Tab 2 (testuser2)
4. Verify message appears in chat

**Message Flow (Triple-Nested Protocol)**:
```
Layer 1: InternalServiceRequest::Message
  └─ peer_cid: testuser2_cid
  └─ message_contents: [serialized Layer 2]

Layer 2: WorkspaceProtocol::Message
  └─ contents: [serialized Layer 3]

Layer 3: MessageProtocol::Chat
  └─ content: "Hello from testuser1"
  └─ timestamp: ...
```

**Message Path Through System**:
```
Tab 1 (testuser1) types message
  │
  ├─ Is Tab 1 the leader?
  │  │
  │  ├─ YES → Send directly via WebSocket
  │  └─ NO  → Broadcast to leader, leader sends via WebSocket
  │
WebSocket → Internal Service (localhost:12345)
  │
  ├─ Routes to testuser2 session (same internal service instance!)
  │
Internal Service → WebSocket → Leader Tab
  │
Leader Tab → Broadcasts to all tabs
  │
Tab 2 (testuser2) receives broadcast
  │
  └─ P2PChat component displays message
```

#### Send Message from Tab 2 to Tab 1:
1. In Tab 2 (testuser2), click on testuser1 in sidebar
2. Type message: `Hello from testuser2`
3. Press Enter
4. Switch to Tab 1
5. Verify message appears

**Verify**:
- Messages appear in correct order
- Timestamps are accurate
- Sender names display correctly
- No duplicate messages
- Unread counts update in sidebar

---

### Phase 6: Multi-Message Testing

#### Rapid Message Exchange:
1. Send 5 messages from Tab 1
2. Send 5 messages from Tab 2
3. Verify all 10 messages appear in both tabs
4. Verify messages are in chronological order
5. Check sidebar shows last message preview

**Check Logs for Errors**:
```bash
# Should see NO errors or warnings
tilt logs internal-service | grep -i "error\|warn\|fail"
tilt logs server | grep -i "error\|warn\|fail"
```

---

## Verification Checklist

### TypeScript Bindings ✅
- [ ] `PeerRegisterNotification` uses `peer_username` field (not `username`)
- [ ] `ListAllPeersResponse` accesses `peer_information` field (not `online_peers`)
- [ ] `ListRegisteredPeersResponse` accesses `peers` field (not `online_peers`)
- [ ] `PeerInformation` uses `name` field (not `full_name`)

### Peer Discovery ✅
- [ ] Both users see each other in available peers list
- [ ] Usernames display correctly (not "User 36414494...")
- [ ] Online status indicators work
- [ ] Search/filter functionality works

### Peer Registration ✅
- [ ] PeerRegister succeeds without "Unable to find username" error
- [ ] Both users receive PeerRegisterNotification
- [ ] Registered peers appear in "Direct Messages" sidebar
- [ ] Registration persists across tab refresh

### P2P Connection ✅
- [ ] PeerConnect succeeds
- [ ] Chat interface loads without errors
- [ ] Peer username displays in chat header
- [ ] Connection status indicators work

### P2P Messaging ✅
- [ ] Messages send bidirectionally
- [ ] Messages appear in correct order
- [ ] Timestamps are accurate
- [ ] No duplicate messages
- [ ] Unread counts update correctly
- [ ] Last message preview shows in sidebar
- [ ] Messages persist across tab refresh (if stored)

### Multi-Tab Coordination ✅
- [ ] Leader election completes successfully
- [ ] Follower tabs receive message broadcasts
- [ ] Messages sent from follower tabs work (via leader)
- [ ] Leader tab closure promotes a follower to leader
- [ ] All tabs stay synchronized

---

## Troubleshooting

### Issue: "Unable to find username for local user"

**Symptom**: PeerRegister fails with username error

**Cause**: TypeScript reading wrong field name (`username` instead of `peer_username`)

**Fix**: Verify `p2p-registration-service.ts` line 149 reads:
```typescript
peerUsername: message.PeerRegisterNotification.peer_username
```

**Verify Fix**:
```bash
grep -n "peer_username" citadel-workspaces/src/lib/p2p-registration-service.ts
```

---

### Issue: Users show as "User 36414494..."

**Symptom**: Peer list shows CID instead of username

**Cause**: Backend returns `name` field, frontend expects `full_name`

**Fix**: Verify `updatePeerMaps()` in `p2p-registration-service.ts` line 358:
```typescript
fullName: peer.name || peer.username || 'Unknown User'
```

---

### Issue: ListAllPeers returns empty

**Symptom**: No peers show up in discovery

**Cause**: Response parsing reads wrong field (`online_peers` vs `peer_information`)

**Fix**: Verify `listAllPeers()` line 263:
```typescript
const peerInfo = response.peer_information || {};
return Object.values(peerInfo);
```

---

### Issue: Messages don't appear in Tab 2

**Symptom**: Send from Tab 1, nothing shows in Tab 2

**Possible Causes**:
1. Leader election failed
2. BroadcastChannel not working
3. P2P routing issue in internal service

**Debug Steps**:
```bash
# Check leader election
# Open DevTools → Console in both tabs
# Look for "Leader elected" or similar logs

# Check internal service logs
tilt logs internal-service | grep -i "message\|p2p"

# Verify both sessions active
tilt logs internal-service | grep "server_connection_map"
```

---

### Issue: WebSocket Connection Fails

**Symptom**: "WebSocket connection to ws://localhost:12345 failed"

**Cause**: Internal service not running

**Fix**:
```bash
# Check internal service status
tilt get uiresources | grep internal-service

# Restart if needed
tilt trigger internal-service

# Check logs
tilt logs internal-service
```

---

## Expected Log Patterns

### Successful P2P Flow

**Peer Discovery**:
```
ListAllPeers { request_id: "...", cid: 12345 }
ListAllPeersResponse { peer_information: { "67890": PeerInformation { ... } } }
```

**Peer Registration**:
```
PeerRegister { cid: 12345, peer_cid: 67890 }
PeerRegisterSuccess { peer_cid: 67890, peer_username: "testuser2" }
PeerRegisterNotification { peer_cid: 12345, peer_username: "testuser1" }
```

**P2P Connection**:
```
PeerConnect { cid: 12345, peer_cid: 67890 }
PeerConnectSuccess { peer_cid: 67890 }
```

**P2P Messaging**:
```
InternalServiceRequest::Message { peer_cid: 67890, message_contents: [...] }
(Message routed to peer session)
```

---

## Performance Testing

### Stress Test: Rapid Messages
1. Send 100 messages rapidly from Tab 1
2. Verify all appear in Tab 2 in order
3. Check for memory leaks (DevTools → Memory)
4. Verify no WebSocket backpressure

### Stress Test: Multiple Peers
1. Create 5 users in 5 tabs (same browser)
2. Register all users with each other
3. Send messages between various pairs
4. Verify message routing works correctly
5. Check internal service CPU/memory usage

---

## Integration with Testing Scripts

### Automated P2P Test (Future)
Consider creating `test-p2p-messaging.sh` similar to `test-session-management.sh`:

```bash
#!/bin/bash
# P2P Messaging Test Script

echo "=== P2P Messaging Test ==="
echo "1. Open Tab 1 and create testuser1"
read -p "Press Enter when testuser1 is logged in..."

echo "2. Open Tab 2 and create testuser2"
read -p "Press Enter when testuser2 is logged in..."

echo "3. Register peers in both tabs"
read -p "Press Enter when peer registration complete..."

echo "4. Send test message from Tab 1"
read -p "Did message appear in Tab 2? (y/n) " msg_received

if [ "$msg_received" = "y" ]; then
  echo "✅ P2P messaging working!"
else
  echo "❌ P2P messaging failed - check logs"
  tilt logs internal-service | tail -50
fi
```

---

## Related Documentation

- **Architecture**: [ARCHITECTURE.md § Multi-Tab Coordination](./ARCHITECTURE.md#multi-tab-coordination)
- **Development Guide**: [CLAUDE.md § Multi-Tab Testing](./CLAUDE.md#multi-tab-testing-single-browser)
- **Protocol Layers**: [ARCHITECTURE.md § Protocol Layers](./ARCHITECTURE.md#protocol-layers)
- **Session Management**: [SESSION_MANAGEMENT_TEST_RESULTS.md](./SESSION_MANAGEMENT_TEST_RESULTS.md)

---

## Success Criteria

**P2P messaging is working correctly when**:

✅ Peer discovery shows all users with real usernames
✅ Peer registration succeeds without errors
✅ P2P connections establish successfully
✅ Messages send bidirectionally between tabs
✅ Messages appear in chronological order
✅ Sidebar updates with last message previews
✅ Unread counts increment correctly
✅ Multi-tab coordination works (leader election, broadcasts)
✅ No "Session Already Connected" errors
✅ No username propagation errors
✅ No TypeScript binding errors in browser console

---

**Test Guide Version**: 1.0
**Date**: October 31, 2025
**Last Updated**: After TypeScript binding fixes for P2P registration
