# Next Steps: P2P Implementation Guide

## Development Methodology
**All tasks must use the workspace-developer agent and include Playwright browser verification**

## 🔧 DX Step 0: Service Stability (✅ COMPLETED)

**Problem Solved**: Services were auto-restarting on file changes, losing all in-memory state

**Solution Implemented**:
- Modified `Tiltfile` to use `TRIGGER_MODE_MANUAL` for Docker services
- Services now only restart when explicitly triggered
- UI continues to use HMR for fast iteration

**Manual Restart Commands** (use sparingly):
```bash
# Only restart when Rust code changes require it
tilt trigger server          # Restart server container
tilt trigger internal-service # Restart internal-service container

# DO NOT restart for TypeScript/React changes - HMR handles those
```

**Important**: Each service restart loses all registered users and sessions. Only restart when:
- Rust code changes are made
- WASM bindings are updated
- Service configuration changes

## Progress Update - August 4, 2025

### ✅ COMPLETED ITEMS

#### Step 1: Tab State Isolation (PARTIALLY COMPLETE)
- ✅ P2P Discovery modal correctly shows tab-specific username
- ✅ Each tab maintains independent selected user
- ⏳ Full tab isolation for all workspace features pending

#### Step 2: Peer Discovery (✅ COMPLETE)
- ✅ "Discover Peers" button added to sidebar workspace members section
- ✅ PeerDiscoveryModal fully functional
- ✅ Shows correct username for each tab
- ✅ Lists all connected peers with usernames and CIDs
- ✅ Response parsing fixed (uses `peer_information` object)
- ✅ ListRegisteredPeers made non-blocking
- ✅ Redundant TopBar button removed

## 🚀 Next Phase: P2P Connection & Messaging

### 🎯 Step 3: P2P Registration Implementation (HIGH PRIORITY)

**Current State**: Registration UI exists but needs protocol implementation

**Files to Modify:**
- `citadel-workspaces/src/components/p2p/PeerDiscoveryModal.tsx`
- `citadel-workspaces/src/lib/websocket-service.ts`

**Implementation Tasks:**
1. Implement `registerWithPeer` function in PeerDiscoveryModal:
   ```typescript
   // Send PeerRegister request
   const request = {
     PeerRegister: {
       request_id: crypto.randomUUID(),
       cid: currentCid,
       peer_cid: targetPeerCid,
       session_security_settings: { /* ... */ },
       connect_after_register: true
     }
   };
   ```

2. Handle registration responses:
   - `PeerRegisterSuccess` - Update UI to show "Connected" status
   - `PeerRegisterFailure` - Show error message
   - `PeerRegisterNotification` - Show incoming registration request

3. Add registration state tracking:
   - Pending registrations
   - Accepted/rejected status
   - Connection state per peer

**Playwright Verification:**
```javascript
// Test registration flow
await page.click('button[title="Discover Peers"]');
await page.waitForSelector('.peer-list-item');
await page.click('button:has-text("Connect")');
await page.waitForSelector('text=Registration Sent');
```

### 🎯 Step 4: WASM P2P Bindings Verification (HIGH PRIORITY)

**Files to Check:**
- `citadel-internal-service/typescript-client/src/InternalServiceWasmClient.ts`
- `citadel-workspaces/src/lib/websocket-service.ts`

**Required WASM Methods:**
```typescript
interface WasmModule {
  open_p2p_connection(peer_cid: string): Promise<void>;
  send_p2p_message(peer_cid: string, message: any): Promise<void>;
}
```

**Verification Steps:**
1. Check if methods are exposed in WASM client
2. Test connection establishment after registration
3. Verify message serialization/deserialization

### 🎯 Step 5: P2P Connection Establishment (HIGH PRIORITY)

**After successful registration:**
1. Automatically call `openP2PConnection(peerCid)`
2. Update connection status in UI
3. Enable message sending UI

**Implementation:**
```typescript
// In PeerDiscoveryModal after successful registration
if (response.PeerRegisterSuccess) {
  await websocketService.openP2PConnection(currentCid, peerCid);
  updatePeerStatus(peerCid, 'connected');
}
```

### 🎯 Step 6: P2P Messaging Integration (MEDIUM PRIORITY)

**Components to Wire:**
- `P2PChat.tsx` - UI component exists
- `P2PMessengerManager` - Message management exists
- Need to connect to actual P2P protocol

**Protocol Structure:**
```typescript
// Correct message nesting for P2P
InternalServiceRequest.Message({
  peer_cid: targetCid,
  message_contents: WorkspaceProtocol.Message({
    contents: MessageProtocol.TextMessage({
      text: "Hello!"
    })
  })
})
```

### 🎯 Step 7: Comprehensive Testing (HIGH PRIORITY)

**Create Playwright Test Suite:**
```javascript
// tests/p2p-complete-flow.test.ts
describe('P2P Complete Flow', () => {
  test('Discovery → Registration → Connection → Messaging', async () => {
    // 1. Setup two tabs with different users
    const tab1 = await browser.newPage();
    const tab2 = await browser.newPage();
    
    // 2. Register users
    await registerUser(tab1, 'UserOne');
    await registerUser(tab2, 'UserTwo');
    
    // 3. Discover peers
    await discoverPeers(tab1);
    await discoverPeers(tab2);
    
    // 4. Register with each other
    await registerPeer(tab1, 'UserTwo');
    await acceptRegistration(tab2);
    
    // 5. Send message
    await sendMessage(tab1, 'Hello UserTwo!');
    
    // 6. Verify receipt
    await verifyMessageReceived(tab2, 'Hello UserTwo!');
  });
});
```

## Development Commands

### Start Services
```bash
tilt up
```

### Watch Logs
```bash
tilt logs internal-service
tilt logs server
```

### Check Service Status
```bash
tilt get uiresource
```

### Run Playwright Tests
```bash
npx playwright test tests/p2p-flow.test.ts --headed
```

## Success Metrics

### Phase 1: Discovery
✅ **COMPLETE**: Users can see each other in peer lists

### Phase 2: Registration
⏳ **IN PROGRESS**: Mutual registration with UI feedback

### Phase 3: Connection
⏳ **PENDING**: P2P connection establishes after registration

### Phase 4: Messaging
⏳ **PENDING**: Messages exchange bidirectionally

### Phase 5: Resilience
⏳ **PENDING**: Connection recovery and persistence

## Common Issues & Solutions

| Issue | Solution | Status |
|-------|----------|--------|
| "UserOne" in both tabs | Fixed with tab-specific session | ✅ FIXED |
| No peers visible | Fixed response parsing | ✅ FIXED |
| Registration timeout | Made non-blocking | ✅ FIXED |
| Registration fails | Implement proper PeerRegister request | ⏳ TODO |
| Messages not sending | Wire P2PChat to actual protocol | ⏳ TODO |
| Connection drops | Implement reconnection logic | ⏳ TODO |

## Debugging Tips

1. **Check Console Logs**: Look for WASM errors, protocol issues
2. **Monitor WebSocket**: DevTools > Network > WS tab
3. **Verify CIDs**: Ensure CIDs are consistent (string vs number)
4. **Check Tilt Logs**: `tilt logs internal-service` for backend errors
5. **Browser Storage**: Check LocalStorage/SessionStorage for state issues

## Next Immediate Action

```bash
# Continue with Step 3: P2P Registration Implementation
# Focus on making the "Connect" button in PeerDiscoveryModal functional
# This will unblock Steps 4-6
```

---

**Remember**: Every code change must be verified with Playwright browser interaction!