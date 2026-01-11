# Cascading Disconnect Bug Investigation

## Bug Description

When disconnecting a single user session via the OrphanSessionsNavbar, **all sessions** on the same underlying connection are being disconnected instead of just the targeted session.

## Symptoms

1. **Test Failure**: STEP 8 "Reconnect After Disconnect" in `previous-sessions.test.ts` times out
2. **User Impact**: After logging out one user, other users in the same browser also get logged out
3. **Expected Behavior**: Disconnecting USER2 should only disconnect USER2, leaving USER1 active

## Test Evidence

From `npm run test:prev-sessions` logs:

```
[OrphanSessionsNavbar] Disconnecting session: 15938309119912698657  ← USER2 (intended)
[ServerAutoConnect] Marked prev_sess_b as user-disconnected        ← USER2 marked (expected)
[InstanceInboundRouter] Routing DisconnectNotification (CID: USER2)
...
[ServerAutoConnect] Marked prev_sess_a as user-disconnected        ← USER1 marked (BUG!)
[InstanceInboundRouter] Routing DisconnectNotification (CID: USER1) ← USER1 (BUG!)
```

**Problem**: TWO `DisconnectNotification` messages are received when only ONE disconnect was requested.

## Root Cause Hypothesis

The SDK's `ClientServerRemote::disconnect()` method disconnects ALL sessions sharing the same underlying protocol connection, rather than targeting a specific session by CID.

### Code Path

1. **Frontend**: `OrphanSessionsNavbar.tsx:299` calls `websocketService.disconnect(cid)`
2. **WASM Client**: Routes to internal service via `InternalServiceRequest::Disconnect`
3. **Internal Service**: `requests/peer/disconnect.rs:36-91` creates `ClientServerRemote` and calls `.disconnect()`
4. **SDK**: `ClientServerRemote::disconnect()` terminates the protocol connection
5. **Bug**: ALL sessions on that protocol connection receive disconnect events

### Why Multiple Sessions Share a Connection

In a multi-tab browser scenario:
- Tab 1: USER1 logged in
- Tab 2: USER2 logged in
- Both share the same WebSocket → Internal Service connection
- Internal Service may be multiplexing both through a single SDK connection to the server

## Investigation Status

### Current SDK Version

- **Before Update**: `89c18aa4ebed1a3be8f5adc953bf5c9bf51c0a16` (v0.13.0)
- **After Update**: `07d5fd22` (v0.13.1)

### SDK Commits Between Versions

```
07d5fd22 ci: Make Ratchet Stability Test non-blocking for CI
dc8f1374 ci: re-trigger pipeline after Ratchet Stability Test failure
73a54fcd ci: Skip stress tests in release mode
86f8e8cb fix(tests): Increase test timeouts for slow CI runners
9745d2d6 ci: Add memory monitoring and split stress tests in release job
e5aac9a4 fix(session): Prevent spurious C2S disconnect for sessions without CID ← RELEVANT
c0b909e6 feat(proto): Add diagnostic logging to disconnect signal call sites ← RELEVANT
baeca621 chore: bump all crate versions to 0.13.1
b3141c49 feat: migrate connection types to citadel_types with TypeScript CI ← BREAKING CHANGE
89c18aa4 feat(sdk): add reconnection test suite and fix version reset on session init
```

### Key Commits Analysis

#### `e5aac9a4` - Prevent spurious C2S disconnect for sessions without CID
```
Sessions without a valid CID were incorrectly sending NodeResult::Disconnect
signals when dropped or terminated. This caused reconnection tests to fail
because the test framework counted these as C2S disconnects.

Changes:
- Add guard in send_session_dc_signal to skip if session_cid is None
- Add additional check in Drop to not send disconnect for sessions without CID
```
**Impact**: May fix the spurious disconnect signals we're seeing.

#### `b3141c49` - Migrate connection types to citadel_types
This commit refactored the connection type system:
- `VirtualTargetType::LocalGroupServer` → `ClientConnectionType::Server`
- `VirtualTargetType::LocalGroupPeer` → `PeerConnectionType::LocalGroupPeer`
- `Disconnect.v_conn_type` renamed to `Disconnect.conn_type`

**Impact**: Required code changes in `responses/disconnect.rs`.

#### `9dcd4675` - Add bidirectional P2P disconnect propagation
P2P disconnects now properly notify both ends via `PeerSignal::Disconnect`.
P2P disconnect events now come through `NodeResult::PeerEvent` instead of `NodeResult::Disconnect`.

### Compilation Status

✅ **Compilation successful** after adapting to breaking changes:
- Updated `responses/disconnect.rs` to use `ClientConnectionType` enum
- Field `Disconnect.v_conn_type` → `Disconnect.conn_type`
- P2P disconnect handling now deferred to `PeerEvent` handler

## Findings

1. **SDK Update Applied**: Updated from commit `89c18aa4` to `07d5fd22`
2. **Breaking API Changes**: The SDK refactored connection types
3. **Key Fix Applied**: `e5aac9a4` prevents spurious disconnects from sessions without CID
4. **Architecture Change**: P2P disconnects now use `PeerEvent` mechanism, not `NodeResult::Disconnect`

## Next Steps

1. **Rebuild Docker containers** with `docker compose build --no-cache` (required for SDK changes)
2. **Run test:prev-sessions** to verify the fix
3. If still failing, investigate the `PeerSignal::Disconnect` event handler

---

## Files Involved

### Frontend
- `citadel-workspaces/src/components/OrphanSessionsNavbar.tsx` - Disconnect UI
- `citadel-workspaces/src/lib/server-auto-connect-service.ts` - Session tracking
- `citadel-workspaces/src/lib/websocket-service.ts` - WebSocket layer

### Backend
- `citadel-internal-service/citadel-internal-service/src/kernel/requests/peer/disconnect.rs` - Disconnect handler
- `citadel-internal-service/citadel-internal-service/src/kernel/responses/disconnect.rs` - Disconnect response

### SDK (Citadel Protocol)
- `citadel_sdk::remote::ClientServerRemote::disconnect()` - Protocol disconnect method

---

## Resolution ✅ FIXED

The cascading disconnect bug had **two root causes**, both now fixed:

### Root Cause 1: Frontend - `removeSession()` Cascading Disconnect

**Location**: `citadel-workspaces/src/lib/connection-manager.ts:1201-1205`

**Problem**: After explicitly disconnecting a session, `OrphanSessionsNavbar` calls `connectionManager.removeSession(username, serverAddress)` to clean up browser storage. However, `removeSession()` had this buggy code:

```typescript
// If this was the current session, disconnect
if (this.currentConnectionInfo &&
    this.currentConnectionInfo.serverAddress === serverAddress) {
  await this.disconnect();  // BUG: Disconnects currentConnectionInfo.cid!
}
```

This checked only `serverAddress`, but multiple users share the same server. It would then call `this.disconnect()` which disconnects `currentConnectionInfo.cid` - the CURRENT instance's session, not the one being removed!

**Fix**: Removed the automatic disconnect from `removeSession()`. The caller (OrphanSessionsNavbar) already explicitly disconnects with `websocketService.disconnect(cid)` before calling `removeSession()`. Storage cleanup should not trigger additional disconnects.

### Root Cause 2: Backend - RAII Drop During SDK Disconnect

**Location**: `citadel-internal-service/src/kernel/requests/peer/disconnect.rs`

**Problem**: When disconnecting a session, the Connection struct was dropped while the SDK disconnect was still in progress. The RAII Drop implementation triggered a redundant disconnect signal.

**Fix**: Created `DisconnectedConnection<R>` enum to hold the connection struct alive:

1. `cleanup_state()` removes from map but returns the struct wrapped in enum
2. `disconnect_removed()` calls SDK disconnect using the target-locked remote
3. Enum is dropped AFTER SDK disconnect completes (RAII is now harmless)

### Test Results After Fix

```
STEP 7: Test Disconnect Removes Session from Navbar
[OrphanSessionsNavbar] Disconnecting session: 7035559828185036480  ← USER2
[InstanceInboundRouter] Routing DisconnectNotification (CID: 7035559828185036480)
// ✅ NO cascading to USER1!

Disconnect Removes: PASS
```

### Remaining Issue: STEP 8 "Reconnect After Disconnect"

This is NOT the same bug. The login timeout in STEP 8 is a separate issue.

**Investigation Findings:**

1. **Session cache invalidation** - FIXED
   - Added `DisconnectNotification` handling in `connection-manager.ts:handleWebSocketMessage()`
   - Cache is now invalidated when a session is disconnected
   - Log confirms: `ConnectionManager: Received DisconnectNotification for CID: ...`

2. **userDisconnectedSessions clearing** - FIXED
   - Added `serverAutoConnectService.clearUserDisconnected()` call in `websocket-service.ts:connect()`
   - Explicit login attempts now clear the "user-disconnected" marking

3. **Connect request never reaches internal-service** - NEEDS INVESTIGATION
   - Internal-service logs show NO Connect request for prev_sess_b after STEP 8 login attempt
   - The timeout happens client-side waiting for ConnectSuccess response
   - Root cause: Connect request is blocked somewhere in frontend flow

**Possible causes for Connect request not being sent:**
- Double session check: Both Login.tsx and websocket-service.ts check for existing sessions
- Address mismatch: "localhost:12349" vs "127.0.0.1:12349" after DNS resolution
- Claim path taken: If session found as orphaned, claims instead of connecting
- WebSocket state: WASM client may not be in correct state to send

**Test Status:**
- STEP 7 (Disconnect): ✅ PASS - Only target session disconnected
- STEP 8 (Reconnect): ❌ FAIL - Connect request never sent to backend
