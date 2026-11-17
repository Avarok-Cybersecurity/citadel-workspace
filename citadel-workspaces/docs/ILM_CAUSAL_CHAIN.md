# ILM (Intersession Layer Messaging) Causal Chain

## Overview
This document traces the complete message flow for offline/reconnection messaging.

## Scenario: Alice sends message while Bob is offline, Bob reconnects and should receive it

---

## Phase 1: Initial Setup (Both Online)

### Step 1.1: P2P Registration
```
Alice Browser → sendP2PRegistration(bobCid)
  → websocketService.client.sendMessage()
  → InternalService (Rust) → PeerRegister command
  → Citadel SDK → Cryptographic exchange
  → InternalService → PeerRegisterSuccess
  → Alice Browser receives notification

Bob Browser → accepts P2P registration
  → InternalService → PeerRegisterNotification to Bob
  → Bob Browser receives, accepts
  → Mutual registration complete
```

### Step 1.2: P2P Connection (PeerConnect)
```
Alice Browser → p2pAutoConnectService.connectToPeer(bobCid)
  → websocketService.openP2PConnection(aliceCid, bobCid)
  → InternalService → PeerConnect command
  → Citadel SDK → QUIC/NAT traversal
  → InternalService → PeerConnectSuccess
  → Both Alice & Bob have bidirectional channel
```

---

## Phase 2: Bob Goes Offline (TCP Drop)

### Step 2.1: Browser Close
```
Bob closes browser tab
  → WebSocket connection drops
  → InternalService detects TCP disconnect
  → If orphan_mode enabled:
      - Session remains in server_connection_map
      - peer_connections preserved
      - Session marked as "orphaned"
  → InternalService notifies Alice via PostPeerDisconnect
  → Alice Browser → PeerDisconnect notification
  → p2pAutoConnectService.handlePeerDisconnect(bobCid)
  → connectedPeers.delete(bobCid)
```

---

## Phase 3: Alice Sends Offline Message

### Step 3.1: Message Send
```
Alice types message → clicks send
  → p2pMessengerManager.sendMessage(bobCid, text)
  → Checks connection: isPeerConnected(bobCid) → FALSE
  → Uses ILM: websocketService.sendP2PMessageReliable(aliceCid, bobCid, message)
  → WASM client → client.sendP2PMessageReliable()
  → InternalService (Rust) receives

  InternalService checks: Is Bob connected?
    → Checks peer_connections for bobCid
    → If NOT connected: Queues message in ILM
    → If connected: Delivers immediately
```

### Step 3.2: ILM Queue (Backend)
```
InternalService → ILM queue
  → Message stored in memory (or persistent storage)
  → Associated with (sender: Alice, recipient: Bob)
  → Waiting for Bob to reconnect
```

---

## Phase 4: Bob Reconnects (ClaimSession)

### Step 4.1: ClaimSession Request
```
Bob opens browser again
  → Sees session in OrphanSessionsNavbar
  → Clicks to reconnect
  → OrphanSessionsNavbar.handleNavigate()
  → websocketService.claimSession(bobCid)
  → InternalService → ConnectionManagement { ClaimSession }
  → Session transitions from orphaned → active
  → ClaimSessionSuccess response to Bob
```

### Step 4.2: session:activated Event (NEW FIX)
```
OrphanSessionsNavbar emits:
  eventEmitter.emit('session:activated', {
    cid: bobCid,
    username: 'bob',
    activationType: 'claim'  ← CRITICAL!
  })

SessionStartupService receives:
  → Checks activationType === 'claim' → ALWAYS run startup
  → p2pRegistrationService.start()
  → p2pAutoConnectService.connectToAllRegisteredPeers()
```

### Step 4.3: P2P Reconnection
```
p2pAutoConnectService.connectToAllRegisteredPeers():
  → Lists all registered peers (includes Alice)
  → For each peer:
      → refreshOnlineStatus() - check if peer is online
      → If Alice is online: connectToPeer(aliceCid)

connectToPeer(aliceCid):
  → claimSession(bobCid) - ensure we're active
  → openP2PConnection(bobCid, aliceCid) - CRITICAL!
  → InternalService → PeerConnect command
  → Citadel SDK → Reestablish QUIC channel
  → InternalService → PeerConnectSuccess to Bob
  → InternalService → PeerConnectNotification to Alice
```

### Step 4.4: Alice Detects Bob Connected
```
Alice InternalService receives PeerConnectNotification
  → Emits to Alice Browser
  → p2pAutoConnectService.handleIncomingPeerConnect()
  → connectedPeers.add(bobCid)
  → eventEmitter.emit('p2p-connection-established', { peerCid: bobCid })
```

---

## Phase 5: ILM Delivery (THE CRITICAL PART)

### Step 5.1: ILM Detection
```
Alice's InternalService:
  → ILM polls connected_peers() periodically
  → Detects Bob is now in peer_connections
  → Finds queued messages for Bob
```

### Step 5.2: Message Delivery
```
Alice's InternalService:
  → For each queued message to Bob:
      → send_p2p_message(bobCid, message)
      → Message travels via existing channel

Bob's InternalService:
  → Receives P2P message
  → Emits MessageNotification to Bob Browser
```

### Step 5.3: Bob Browser Receives
```
Bob Browser:
  → websocket-message event with MessageNotification
  → p2pMessengerManager.handleWebSocketMessage()
  → Parses P2P protocol message
  → Updates UI with received message
```

---

## DEBUGGING: Where Things Might Be Failing

### Checkpoint 1: ClaimSession
- [x] Verify ClaimSession succeeds (logs show success)

### Checkpoint 2: session:activated Event
- [ ] Verify event emitted with activationType='claim'
- [ ] Verify SessionStartupService receives it
- [ ] Verify it bypasses duplicate CID check for 'claim'

### Checkpoint 3: P2P Auto-Connect
- [ ] Verify connectToAllRegisteredPeers() runs
- [ ] Verify Alice is found in registered peers
- [ ] Verify Alice shows as online
- [ ] Verify openP2PConnection() is called

### Checkpoint 4: PeerConnect Success
- [ ] Verify PeerConnectSuccess for Bob
- [ ] Verify PeerConnectNotification reaches Alice
- [ ] Verify Alice's connectedPeers includes Bob

### Checkpoint 5: ILM Queue Check
- [ ] Verify ILM has queued messages for Bob
- [ ] Verify ILM polls connected_peers after Bob reconnects
- [ ] Verify ILM attempts delivery

### Checkpoint 6: Message Delivery
- [ ] Verify message sent via channel
- [ ] Verify Bob's InternalService receives
- [ ] Verify MessageNotification emitted
- [ ] Verify Bob Browser receives and displays

---

## Aggressive Logging Needed

### SessionStartupService
```typescript
console.log(`[ILM-TRACE] session:activated received: ${JSON.stringify(event)}`);
console.log(`[ILM-TRACE] activationType=${event.activationType}, lastActivatedCid=${this.lastActivatedCid}`);
console.log(`[ILM-TRACE] Will run startup: ${isClaimSession || this.lastActivatedCid !== event.cid}`);
```

### P2PAutoConnectService
```typescript
// In connectToAllRegisteredPeers:
console.log(`[ILM-TRACE] connectToAllRegisteredPeers: currentCid=${currentCid}`);
console.log(`[ILM-TRACE] Found ${registeredPeers.length} peers: ${registeredPeers.map(p => p.cid?.slice(0,8)).join(',')}`);

// In connectToPeer:
console.log(`[ILM-TRACE] connectToPeer: peerCid=${peerCid}, isOnline=${this.isPeerOnline(peerCid)}`);
console.log(`[ILM-TRACE] openP2PConnection(${currentCid.slice(0,8)}, ${peerCid.slice(0,8)})`);
```

### websocketService
```typescript
// In openP2PConnection:
console.log(`[ILM-TRACE] openP2PConnection called: localCid=${localCid}, peerCid=${peerCid}`);

// After PeerConnectSuccess:
console.log(`[ILM-TRACE] PeerConnectSuccess: our_cid=${msg.cid}, peer_cid=${msg.peer_cid}`);
```

---

## Current Hypothesis

Based on logs, the issue is likely at **Checkpoint 3** or **Checkpoint 4**:
- `connectToAllRegisteredPeers()` runs
- But the actual PeerConnect to Alice might not be succeeding
- Or Alice isn't detecting Bob as connected
- Or ILM polling isn't finding Bob in connected_peers

Need to add logging to trace the exact failure point.
